/**
 * Supabase Edge Function: news-generation
 *
 * Migrated from Groq (4 keys, 100k tokens/day each) to Google Gemini
 * (single GEMINI_API_KEY). Runs every 10 minutes via pg_cron. Includes
 * diagnostic logging to agent_debug_log.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.0-flash";
const DEDUP_LOOKBACK_DAYS = 5;
const DEDUP_OVERLAP_THRESHOLD = 0.55;
const POST_TTL_MS = 72 * 60 * 60 * 1000;
const DAILY_IMAGE_BUDGET = 500;

const AGENTS = [
  { name: "world_palestine", categories: ["World", "Palestine"], prompt: `You are a senior news writer for an Islamic news publication covering world affairs and Palestine.\nGenerate exactly 2 news articles in JSON format.\nCATEGORY RULE: You MUST use category "World" for global news and "Palestine" for Palestine/Gaza/Al-Aqsa news.\nUse ONLY these exact strings: "World" or "Palestine" — never any other value.` },
  { name: "south_asia", categories: ["South Asia"], prompt: `You are a senior news writer covering South Asia (Pakistan, Bangladesh, India, Afghanistan, etc.).\nGenerate exactly 2 news articles about significant events in South Asia in JSON format.\nCATEGORY RULE: You MUST use the exact string "South Asia" (with capital S and A, with a space) for ALL articles.\nNever use "Pakistan", "India", "Bangladesh", or any other value.` },
  { name: "economy", categories: ["Economy"], prompt: `You are a senior news writer covering the Islamic economy, halal finance, and trade in Muslim countries.\nGenerate exactly 2 news articles about economic events affecting Muslim countries in JSON format.\nCATEGORY RULE: You MUST use the exact string "Economy" for ALL articles. Never any other value.` },
  { name: "government", categories: ["Government"], prompt: `You are a senior news writer covering government and politics in Muslim-majority countries.\nGenerate exactly 2 news articles about governance events in JSON format.\nCATEGORY RULE: You MUST use the exact string "Government" for ALL articles. Never "Politics" or any other value.` },
  { name: "security", categories: ["Security"], prompt: `You are a senior news writer covering security, defence, and conflict in Muslim regions.\nGenerate exactly 2 news articles about security events in JSON format.\nCATEGORY RULE: You MUST use the exact string "Security" for ALL articles. Never "Defence", "Conflict", or any other value.` },
  { name: "scholars_mosques", categories: ["Scholars", "Mosques"], prompt: `You are a senior news writer covering Islamic scholars and mosques.\nGenerate exactly 2 news articles — one about Islamic scholars/fatwas and one about mosques/Friday prayers.\nCATEGORY RULE: Use ONLY "Scholars" (for scholars/fatwas/rulings) or "Mosques" (for mosques/prayer/masjid).\n"Scholars" and "Mosques" — these exact strings only. Never "Scholar" (no s), "Mosque" (no s), or anything else.` },
  { name: "madrassas", categories: ["Madrassas"], prompt: `You are a senior news writer covering Islamic education, darul ulooms, and madrassas.\nGenerate exactly 2 news articles about Islamic education events in JSON format.\nCATEGORY RULE: You MUST use the exact string "Madrassas" for ALL articles. Never "Madrassa", "Madrasa", or any other value.` },
  { name: "regional", categories: ["Africa", "Southeast Asia", "Turkey", "Community"], prompt: `You are a senior news writer covering Africa, Southeast Asia, Turkey, and Muslim communities worldwide.\nGenerate exactly 4 news articles — at least one per region: Africa, Southeast Asia, Turkey, Muslim communities in the West.\nCATEGORY RULE: Use ONLY these exact strings:\n  "Africa"         — for any African country (Nigeria, Kenya, Senegal, Ethiopia, Morocco, etc.)\n  "Southeast Asia" — for Indonesia, Malaysia, Philippines, Myanmar, Brunei, Thailand (capital S, capital A, with space)\n  "Turkey"         — for Turkey/Türkiye, Ottoman topics\n  "Community"      — for Muslim minorities in Western countries (UK, USA, Canada, France, Germany, Europe)\nNever use any other string for the category field.` },
];

const ARTICLE_SCHEMA = `[\n  {\n    "title_en": "English headline (max 15 words)",\n    "body_en": "English body (250-400 words)",\n    "title_ur": "Urdu headline in Nastaliq Arabic script only",\n    "body_ur": "Urdu body (250-400 words) in Nastaliq Arabic script only",\n    "title_ar": "Arabic headline in Arabic script only",\n    "body_ar": "Arabic body (250-400 words) in Arabic script only",\n    "category": "EXACT string from the CATEGORY RULE above",\n    "significance_score": 5,\n    "source_note": "Islam Nashra",\n    "is_breaking": false\n  }\n]`;

const VALID_CATEGORIES = new Set(["World", "Palestine", "South Asia", "Economy", "Government", "Security", "Scholars", "Mosques", "Madrassas", "Africa", "Southeast Asia", "Turkey", "Community"]);
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function containsForeignScript(text: string): boolean {
  if (/[\u0900-\u097F]/.test(text)) return true;
  if (/[\u0980-\u09FF]/.test(text)) return true;
  if (/[\u0A00-\u0A7F]/.test(text)) return true;
  if (/[\u0A80-\u0AFF]/.test(text)) return true;
  if (/[\u0B00-\u0BFF]/.test(text)) return true;
  if (/[\u0C00-\u0CFF]/.test(text)) return true;
  if (/[\u0D00-\u0D7F]/.test(text)) return true;
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return true;
  if (/[\u0400-\u04FF]/.test(text)) return true;
  if (/[\u0370-\u03FF]/.test(text)) return true;
  if (/[\u0E00-\u0E7F]/.test(text)) return true;
  if (/[\u0590-\u05FF]/.test(text)) return true;
  if (/[\uAC00-\uD7AF]/.test(text)) return true;
  if (/[\u3040-\u30FF]/.test(text)) return true;
  if (/[\u1000-\u109F]/.test(text)) return true;
  return false;
}

function isUrduArabicClean(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  if (containsForeignScript(text)) return false;
  if (!ARABIC_SCRIPT_RE.test(text)) return false;
  return true;
}

function hasGoodArabicScriptDensity(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  const arabicLetters = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = arabicLetters + latinLetters;
  if (total === 0) return false;
  return (arabicLetters / total) >= 0.65;
}

const DEDUP_STOP_WORDS = new Set(["the","a","an","in","of","for","by","to","at","is","are","was","were","has","have","had","on","with","from","and","or","but","not","as","its","this","that","will","amid","over","after","new","says","said","been","more"]);
function significantWords(title: string): Set<string> { return new Set(title.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !DEDUP_STOP_WORDS.has(w))); }
function isDuplicateTitle(newTitle: string, recentTitles: string[]): boolean {
  const newWords = significantWords(newTitle);
  if (newWords.size === 0) return false;
  for (const existing of recentTitles) {
    const existWords = significantWords(existing);
    if (existWords.size === 0) continue;
    const intersection = [...newWords].filter((w) => existWords.has(w)).length;
    const overlap = intersection / Math.min(newWords.size, existWords.size);
    if (overlap > DEDUP_OVERLAP_THRESHOLD) return true;
  }
  return false;
}

async function loadRecentTitles(supabase: ReturnType<typeof createClient>, categories: string[]): Promise<string[]> {
  try {
    const cutoff = new Date(Date.now() - DEDUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("posts").select("title_en").in("category", categories).gte("published_at", cutoff).order("published_at", { ascending: false }).limit(100);
    if (error) return [];
    return (data ?? []).map((r: { title_en: string | null }) => r.title_en).filter(Boolean) as string[];
  } catch { return []; }
}

interface GeneratedArticle { title_en: string; body_en: string; title_ur: string; body_ur: string; title_ar: string; body_ar: string; category: string; significance_score: number; source_note: string; is_breaking: boolean; }
interface AgentDebug { rawPreview: string; returned: number; dropReasons: string[]; }

async function callGemini(prompt: string): Promise<{ text: string; finishReason: string }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("NO_API_KEY: GEMINI_API_KEY is not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4000 },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GEMINI_API_ERROR ${res.status}: ${errText.slice(0, 400)}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const finishReason = candidate?.finishReason ?? "UNKNOWN";
  return { text, finishReason };
}

async function generateForAgent(agent: typeof AGENTS[0], recentTitles: string[]): Promise<{ validated: GeneratedArticle[]; debug: AgentDebug }> {
  const debug: AgentDebug = { rawPreview: "", returned: 0, dropReasons: [] };

  const avoidSection = recentTitles.length > 0 ? `\nDO NOT REPEAT — these stories were recently published; generate completely different news:\n${recentTitles.slice(0, 30).map((t, i) => `  ${i + 1}. ${t}`).join("\n")}\n` : "";
  const prompt = `${agent.prompt}\n${avoidSection}\nReturn ONLY a valid JSON array matching this schema — no markdown code fences, no commentary, just the raw JSON array:\n${ARTICLE_SCHEMA}\n\nWRITING STYLE (follow carefully):\n- Simple, everyday language — understandable from a schoolboy to an elderly villager.\n- No jargon or technical terms without explanation. Short sentences (≤ 20 words each).\n- Enough context so a reader unfamiliar with the topic understands the full story.\n- significance_score: 1–10 (10 = major breaking event).\n- is_breaking: true ONLY for genuinely breaking events (score ≥ 9).\n- source_note must always be exactly "Islam Nashra".\n\nCRITICAL LANGUAGE RULES (violation = article dropped):\n- title_ur and body_ur: EXCLUSIVELY Urdu in Nastaliq/Perso-Arabic script.\n  ✓ Allowed: Unicode Arabic block U+0600–U+06FF and extensions.\n  ✗ FORBIDDEN: Devanagari (Hindi), Bengali, Gujarati, Tamil, or ANY other non-Arabic script.\n  ✗ FORBIDDEN: Latin letters INSIDE Urdu sentences (acronyms like "UN", "IMF" are OK at word boundaries).\n  - At least 65% of identifiable letter characters must be Arabic script.\n- title_ar and body_ar: EXCLUSIVELY Modern Standard Arabic. Same script rules apply.\n- title_en and body_en: English only.`;

  let raw: string, finishReason: string;
  try {
    const result = await callGemini(prompt);
    raw = result.text;
    finishReason = result.finishReason;
  } catch (err) {
    debug.dropReasons.push(err instanceof Error ? err.message : String(err));
    return { validated: [], debug };
  }

  debug.rawPreview = raw.slice(0, 400);
  if (finishReason !== "STOP") {
    debug.dropReasons.push(`FINISH_REASON_NOT_STOP: "${finishReason}" — model may have been cut off or blocked`);
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    debug.dropReasons.push("NO_JSON_ARRAY_FOUND: model did not return a JSON array (possible refusal/safety block)");
    return { validated: [], debug };
  }

  let articles: GeneratedArticle[];
  try {
    articles = JSON.parse(match[0]);
  } catch (e) {
    debug.dropReasons.push("JSON_PARSE_ERROR: " + (e instanceof Error ? e.message : String(e)));
    return { validated: [], debug };
  }

  debug.returned = articles.length;
  const agentCategorySet = new Set(agent.categories);

  const validated = articles.filter((a) => {
    if (!a.title_en || !a.body_en || !a.title_ur || !a.body_ur || !a.title_ar || !a.body_ar) {
      debug.dropReasons.push(`MISSING_FIELDS: "${a.title_en ?? "(no title)"}"`); return false;
    }
    if (!VALID_CATEGORIES.has(a.category)) { debug.dropReasons.push(`INVALID_CATEGORY "${a.category}": "${a.title_en}"`); return false; }
    if (!agentCategorySet.has(a.category)) { debug.dropReasons.push(`CATEGORY_NOT_IN_AGENT_SET "${a.category}": "${a.title_en}"`); return false; }
    if (!isUrduArabicClean(a.title_ur) || !isUrduArabicClean(a.body_ur)) { debug.dropReasons.push(`FOREIGN_SCRIPT_URDU: "${a.title_en}"`); return false; }
    if (!isUrduArabicClean(a.title_ar) || !isUrduArabicClean(a.body_ar)) { debug.dropReasons.push(`FOREIGN_SCRIPT_ARABIC: "${a.title_en}"`); return false; }
    if (!hasGoodArabicScriptDensity(a.body_ur)) { debug.dropReasons.push(`LOW_URDU_DENSITY: "${a.title_en}"`); return false; }
    if (!hasGoodArabicScriptDensity(a.body_ar)) { debug.dropReasons.push(`LOW_ARABIC_DENSITY: "${a.title_en}"`); return false; }
    if (isDuplicateTitle(a.title_en, recentTitles)) { debug.dropReasons.push(`DUPLICATE_TITLE: "${a.title_en}"`); return false; }
    return true;
  });

  for (const a of validated) a.source_note = "Islam Nashra";
  return { validated, debug };
}

const STOP_WORDS_IMG = new Set(["the","a","an","in","of","for","by","to","at","is","are","was","were","has","have","had","on","with","from","and","or","but","not","as","its","this","that","he","she","they","we","it","his","her","their","be","been","will","would","could","should","may","might","also","over","new","say","says","said","more","than","about","after","amid"]);
const CATEGORY_ANCHORS: Record<string, string[]> = {
  Palestine: ["Palestine mosque Gaza", "Al-Aqsa mosque", "Palestine crowd"],
  World: ["Islamic summit world leaders", "mosque architecture skyline"],
  "South Asia": ["mosque Pakistan Lahore", "Bangladesh mosque", "Kabul mosque"],
  Economy: ["Islamic finance banking", "halal economy market"],
  Government: ["Muslim leaders parliament", "Islamic country government"],
  Security: ["military security Muslim country", "peacekeeping forces"],
  Scholars: ["Islamic scholars lecture", "Muslim conference scholars"],
  Mosques: ["grand mosque architecture", "Friday prayer mosque crowd"],
  Madrassas: ["Islamic school students", "madrassa education"],
  Africa: ["mosque Africa Nairobi", "African Muslim community"],
  "Southeast Asia": ["mosque Indonesia Malaysia", "Istiqlal mosque Jakarta"],
  Turkey: ["Blue Mosque Istanbul", "Turkey skyline Bosphorus"],
  Community: ["Muslim community gathering", "Islamic center community"],
};
function buildImageQueries(titleEn: string, bodyEn: string, category: string): string[] {
  const text = `${titleEn} ${bodyEn.slice(0, 300)}`;
  const properNouns = (text.match(/(?<=[a-z,;] )[A-Z][a-z]{2,}/g) ?? []).filter((w) => !STOP_WORDS_IMG.has(w.toLowerCase())).slice(0, 4);
  const titleWords = titleEn.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS_IMG.has(w)).slice(0, 5);
  const kw = [...new Set([...properNouns, ...titleWords])].slice(0, 6);
  const anchors = CATEGORY_ANCHORS[category] ?? [`${category} mosque Islamic`];
  const queries: string[] = [];
  if (kw.length >= 3) queries.push(kw.slice(0, 4).join(" "));
  if (kw.length >= 1) queries.push(`${kw.slice(0, 3).join(" ")} ${anchors[0].split(" ")[0]}`);
  queries.push(anchors[0]);
  if (anchors[1]) queries.push(anchors[1]);
  return queries;
}
async function fetchImage(titleEn: string, bodyEn: string, category: string, usedUrls: Set<string>): Promise<string | null> {
  const key = Deno.env.get("PEXELS_API_KEY");
  if (!key) return null;
  for (const rawQ of buildImageQueries(titleEn, bodyEn, category)) {
    const q = encodeURIComponent(rawQ);
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=15&orientation=landscape`, { headers: { Authorization: key } });
      if (!res.ok) continue;
      const json = await res.json();
      for (const photo of (json.photos ?? []) as Array<{ src: { medium: string; large: string } }>) {
        const url = photo.src.medium || photo.src.large;
        if (url && !usedUrls.has(url)) { usedUrls.add(url); return url; }
      }
    } catch { /* ignore */ }
  }
  return null;
}
async function loadRecentImageUrls(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  try {
    const { data } = await supabase.from("posts").select("image_url").eq("has_image", true).order("published_at", { ascending: false }).limit(50);
    return new Set<string>((data ?? []).map((r: { image_url: string | null }) => r.image_url).filter(Boolean) as string[]);
  } catch { return new Set(); }
}
const BLOCKLIST = ["hate", "terror", "bomb", "kill", "murder", "massacre", "genocide targeting"];
function isFlagged(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKLIST.some((w) => lower.includes(w) && !lower.includes("anti-" + w));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: stateRow } = await supabase.from("generation_state").select("current_agent_index").eq("id", 1).single();
  const agentIndex = stateRow?.current_agent_index ?? 0;
  const nextIndex = (agentIndex + 1) % AGENTS.length;
  const agent = AGENTS[agentIndex];

  await supabase.from("generation_state").upsert({ id: 1, current_agent_index: nextIndex, last_run_at: new Date().toISOString(), last_agent_name: agent.name });

  const [usedImageUrls, recentTitles] = await Promise.all([loadRecentImageUrls(supabase), loadRecentTitles(supabase, agent.categories)]);

  let published = 0, flagged = 0, imaged = 0;
  let debugInfo: AgentDebug = { rawPreview: "", returned: 0, dropReasons: [] };

  try {
    const { validated: articles, debug } = await generateForAgent(agent, recentTitles);
    debugInfo = debug;

    for (const article of articles) {
      if (isFlagged(article.title_en) || isFlagged(article.body_en)) {
        await supabase.from("flagged_posts").insert({ title: article.title_en, body: article.body_en, category: article.category, significance_score: article.significance_score, source_note: "Islam Nashra", flag_reason: "Automated content filter" });
        flagged++;
        continue;
      }
      const now = new Date();
      const expires_at = new Date(now.getTime() + POST_TTL_MS).toISOString();
      let image_url: string | null = null, has_image = false;
      if (imaged < DAILY_IMAGE_BUDGET) {
        image_url = await fetchImage(article.title_en, article.body_en, article.category, usedImageUrls);
        if (image_url) { has_image = true; imaged++; }
      }
      const { error: insertErr } = await supabase.from("posts").insert({
        title: article.title_en, body: article.body_en, category: article.category, image_url, has_image,
        significance_score: article.significance_score, source_note: "Islam Nashra", published_at: now.toISOString(), expires_at,
        is_breaking: article.is_breaking, title_en: article.title_en, body_en: article.body_en,
        title_ur: article.title_ur, body_ur: article.body_ur, title_ar: article.title_ar, body_ar: article.body_ar,
      });
      if (!insertErr) published++;
    }
  } catch (err) {
    debugInfo.dropReasons.push("FATAL_ERROR: " + (err instanceof Error ? err.message : String(err)));
  }

  await supabase.from("agent_debug_log").insert({
    agent_name: agent.name,
    raw_response_preview: debugInfo.rawPreview,
    articles_returned: debugInfo.returned,
    articles_validated: published,
    drop_reasons: debugInfo.dropReasons.slice(0, 20),
  });

  return new Response(JSON.stringify({ success: true, agent: agent.name, agent_index: agentIndex, next_agent: AGENTS[nextIndex].name, published, flagged, imaged, drop_reasons: debugInfo.dropReasons.slice(0, 5) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
