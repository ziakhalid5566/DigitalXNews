/**
 * Supabase Edge Function: news-generation
 *
 * Sequential single-agent mode: each HTTP call runs exactly ONE agent,
 * cycling 0→1→2→…→7→0→… via the `generation_state` table.
 *
 * ── NOTE: Groq vs Gemini ─────────────────────────────────────────────────────
 * This function uses Groq (Llama 3.3 70B) exclusively. A separate Gemini-based
 * implementation exists in artifacts/api-server (Node.js) but was NEVER
 * deployed to Supabase — it was a parallel development build. The live system
 * has always been Groq. If Urdu output quality needs improvement, migrate to
 * the Gemini version by replacing this file with a Gemini SDK equivalent.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Fixes in this version:
 *  1. hasGoodUrduDensity: the previous \W regex silently removed ALL Arabic
 *     characters before counting them (because \W = not [A-Za-z0-9_], which
 *     includes Arabic script). This caused agents 1,3,5,7 to silently drop
 *     every article. Fixed to count Arabic + Latin letters directly.
 *  2. Content deduplication: loads recent titles for the agent's categories
 *     (last 5 days), injects them as an "avoid" list into the prompt, and
 *     hard-rejects any generated article whose title has >55% significant-word
 *     overlap with a recent one.
 *  3. Redundant push removed: the inline push-send block inside this function
 *     caused every high-significance post to be notified TWICE (immediately in
 *     English only, then again via push-notifications in the user's language).
 *     The push-notifications Edge Function is now the single source of truth.
 *  4. Category prompts: each agent now explicitly states the exact category
 *     string(s) to use and validates that the model honoured them.
 *
 * Required secrets (set via `supabase secrets set`):
 *   GROQ_KEY_A   → agents: world_palestine + south_asia
 *   GROQ_KEY_B   → agents: economy        + government
 *   GROQ_KEY_C   → agents: security       + scholars_mosques
 *   GROQ_KEY_D   → agents: madrassas      + regional
 *   GROQ_API_KEY              (fallback key)
 *   PEXELS_API_KEY            (image fetching)
 *   SUPABASE_URL              (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import Groq from "npm:groq-sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Config ───────────────────────────────────────────────────────────────────

const POST_TTL_MS        = 72 * 60 * 60 * 1000;
const DAILY_IMAGE_BUDGET = 500;
/** Look back this many days when loading titles to deduplicate against. */
const DEDUP_LOOKBACK_DAYS = 5;
/** Title overlap ratio above which we consider an article a duplicate. */
const DEDUP_OVERLAP_THRESHOLD = 0.55;

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  {
    name: "world_palestine",
    envKey: "GROQ_KEY_A",
    categories: ["World", "Palestine"],
    prompt: `You are a senior news writer for an Islamic news publication covering world affairs and Palestine.
Generate exactly 2 news articles in JSON format.
CATEGORY RULE: You MUST use category "World" for global news and "Palestine" for Palestine/Gaza/Al-Aqsa news.
Use ONLY these exact strings: "World" or "Palestine" — never any other value.`,
  },
  {
    name: "south_asia",
    envKey: "GROQ_KEY_A",
    categories: ["South Asia"],
    prompt: `You are a senior news writer covering South Asia (Pakistan, Bangladesh, India, Afghanistan, etc.).
Generate exactly 2 news articles about significant events in South Asia in JSON format.
CATEGORY RULE: You MUST use the exact string "South Asia" (with capital S and A, with a space) for ALL articles.
Never use "Pakistan", "India", "Bangladesh", or any other value.`,
  },
  {
    name: "economy",
    envKey: "GROQ_KEY_B",
    categories: ["Economy"],
    prompt: `You are a senior news writer covering the Islamic economy, halal finance, and trade in Muslim countries.
Generate exactly 2 news articles about economic events affecting Muslim countries in JSON format.
CATEGORY RULE: You MUST use the exact string "Economy" for ALL articles. Never any other value.`,
  },
  {
    name: "government",
    envKey: "GROQ_KEY_B",
    categories: ["Government"],
    prompt: `You are a senior news writer covering government and politics in Muslim-majority countries.
Generate exactly 2 news articles about governance events in JSON format.
CATEGORY RULE: You MUST use the exact string "Government" for ALL articles. Never "Politics" or any other value.`,
  },
  {
    name: "security",
    envKey: "GROQ_KEY_C",
    categories: ["Security"],
    prompt: `You are a senior news writer covering security, defence, and conflict in Muslim regions.
Generate exactly 2 news articles about security events in JSON format.
CATEGORY RULE: You MUST use the exact string "Security" for ALL articles. Never "Defence", "Conflict", or any other value.`,
  },
  {
    name: "scholars_mosques",
    envKey: "GROQ_KEY_C",
    categories: ["Scholars", "Mosques"],
    prompt: `You are a senior news writer covering Islamic scholars and mosques.
Generate exactly 2 news articles — one about Islamic scholars/fatwas and one about mosques/Friday prayers.
CATEGORY RULE: Use ONLY "Scholars" (for scholars/fatwas/rulings) or "Mosques" (for mosques/prayer/masjid).
"Scholars" and "Mosques" — these exact strings only. Never "Scholar" (no s), "Mosque" (no s), or anything else.`,
  },
  {
    name: "madrassas",
    envKey: "GROQ_KEY_D",
    categories: ["Madrassas"],
    prompt: `You are a senior news writer covering Islamic education, darul ulooms, and madrassas.
Generate exactly 2 news articles about Islamic education events in JSON format.
CATEGORY RULE: You MUST use the exact string "Madrassas" for ALL articles. Never "Madrassa", "Madrasa", or any other value.`,
  },
  {
    name: "regional",
    envKey: "GROQ_KEY_D",
    categories: ["Africa", "Southeast Asia", "Turkey", "Community"],
    prompt: `You are a senior news writer covering Africa, Southeast Asia, Turkey, and Muslim communities worldwide.
Generate exactly 4 news articles — at least one per region: Africa, Southeast Asia, Turkey, Muslim communities in the West.
CATEGORY RULE: Use ONLY these exact strings:
  "Africa"         — for any African country (Nigeria, Kenya, Senegal, Ethiopia, Morocco, etc.)
  "Southeast Asia" — for Indonesia, Malaysia, Philippines, Myanmar, Brunei, Thailand (capital S, capital A, with space)
  "Turkey"         — for Turkey/Türkiye, Ottoman topics
  "Community"      — for Muslim minorities in Western countries (UK, USA, Canada, France, Germany, Europe)
Never use any other string for the category field.`,
  },
];

const ARTICLE_SCHEMA = `[
  {
    "title_en": "English headline (max 15 words)",
    "body_en": "English body (250-400 words)",
    "title_ur": "Urdu headline in Nastaliq Arabic script only",
    "body_ur": "Urdu body (250-400 words) in Nastaliq Arabic script only",
    "title_ar": "Arabic headline in Arabic script only",
    "body_ar": "Arabic body (250-400 words) in Arabic script only",
    "category": "EXACT string from the CATEGORY RULE above",
    "significance_score": 5,
    "source_note": "Islam Nashra",
    "is_breaking": false
  }
]`;

const VALID_CATEGORIES = new Set([
  "World", "Palestine", "South Asia", "Economy", "Government",
  "Security", "Scholars", "Mosques", "Madrassas", "Africa",
  "Southeast Asia", "Turkey", "Community",
]);

// ─── Language validation ───────────────────────────────────────────────────────

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function containsForeignScript(text: string): boolean {
  if (/[\u0900-\u097F]/.test(text)) return true; // Devanagari
  if (/[\u0980-\u09FF]/.test(text)) return true; // Bengali
  if (/[\u0A00-\u0A7F]/.test(text)) return true; // Gurmukhi
  if (/[\u0A80-\u0AFF]/.test(text)) return true; // Gujarati
  if (/[\u0B00-\u0BFF]/.test(text)) return true; // Odia / Tamil
  if (/[\u0C00-\u0CFF]/.test(text)) return true; // Telugu / Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return true; // Malayalam
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return true; // CJK
  if (/[\u0400-\u04FF]/.test(text)) return true; // Cyrillic
  if (/[\u0370-\u03FF]/.test(text)) return true; // Greek
  if (/[\u0E00-\u0E7F]/.test(text)) return true; // Thai
  if (/[\u0590-\u05FF]/.test(text)) return true; // Hebrew
  if (/[\uAC00-\uD7AF]/.test(text)) return true; // Hangul
  if (/[\u3040-\u30FF]/.test(text)) return true; // Hiragana/Katakana
  if (/[\u1000-\u109F]/.test(text)) return true; // Myanmar
  return false;
}

function isUrduArabicClean(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  if (containsForeignScript(text)) return false;
  if (!ARABIC_SCRIPT_RE.test(text)) return false;
  return true;
}

/**
 * FIX (was broken): the previous version used \W which in JavaScript matches
 * everything that is NOT [A-Za-z0-9_] — this INCLUDES Arabic characters,
 * so the regex stripped ALL Arabic letters out of `wordChars` before counting
 * them, making the ratio always 0 for purely-Urdu text (returns false, drops
 * the article silently). This caused agents 1, 3, 5, 7 to produce zero posts.
 *
 * Fix: count Arabic-script letters and Latin letters separately and directly,
 * with no intermediate transformation that could accidentally remove them.
 */
function hasGoodArabicScriptDensity(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  const arabicLetters = (
    text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []
  ).length;
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = arabicLetters + latinLetters;
  if (total === 0) return false;
  // At least 65% of identifiable letters must be Arabic/Urdu script.
  // (Threshold relaxed slightly from 70% to 65% to tolerate proper nouns /
  //  acronyms like "UN", "IMF", "NATO", "ASEAN" that legitimately appear in
  //  Urdu news text, while still rejecting Latin-dominant hallucinations.)
  return (arabicLetters / total) >= 0.65;
}

// ─── Content deduplication ───────────────────────────────────────────────────

const DEDUP_STOP_WORDS = new Set([
  "the","a","an","in","of","for","by","to","at","is","are","was","were",
  "has","have","had","on","with","from","and","or","but","not","as","its",
  "this","that","will","amid","over","after","new","says","said","been","more",
]);

function significantWords(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !DEDUP_STOP_WORDS.has(w)),
  );
}

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

async function loadRecentTitles(
  supabase: ReturnType<typeof createClient>,
  categories: string[],
): Promise<string[]> {
  try {
    const cutoff = new Date(
      Date.now() - DEDUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("posts")
      .select("title_en")
      .in("category", categories)
      .gte("published_at", cutoff)
      .order("published_at", { ascending: false })
      .limit(100);
    if (error) {
      console.warn("[dedup] Could not load recent titles:", error.message);
      return [];
    }
    return (data ?? [])
      .map((r: { title_en: string | null }) => r.title_en)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

// ─── Groq generation ──────────────────────────────────────────────────────────

interface GeneratedArticle {
  title_en: string; body_en: string;
  title_ur: string; body_ur: string;
  title_ar: string; body_ar: string;
  category: string;
  significance_score: number;
  source_note: string;
  is_breaking: boolean;
}

async function generateForAgent(
  agent: typeof AGENTS[0],
  recentTitles: string[],
): Promise<GeneratedArticle[]> {
  const apiKey = Deno.env.get(agent.envKey) ?? Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    console.warn(`[${agent.name}] No Groq API key — skipping`);
    return [];
  }

  const groq = new Groq({ apiKey });

  // Build the "avoid" list from recent titles (dedup injection into prompt)
  const avoidSection = recentTitles.length > 0
    ? `\nDO NOT REPEAT — these stories were recently published; generate completely different news:\n${
        recentTitles.slice(0, 30).map((t, i) => `  ${i + 1}. ${t}`).join("\n")
      }\n`
    : "";

  const systemPrompt = `${agent.prompt}
${avoidSection}
Return ONLY a valid JSON array matching this schema:
${ARTICLE_SCHEMA}

WRITING STYLE (follow carefully):
- Simple, everyday language — understandable from a schoolboy to an elderly villager.
- No jargon or technical terms without explanation. Short sentences (≤ 20 words each).
- Enough context so a reader unfamiliar with the topic understands the full story.
- significance_score: 1–10 (10 = major breaking event).
- is_breaking: true ONLY for genuinely breaking events (score ≥ 9).
- source_note must always be exactly "Islam Nashra".

CRITICAL LANGUAGE RULES (violation = article dropped):
- title_ur and body_ur: EXCLUSIVELY Urdu in Nastaliq/Perso-Arabic script.
  ✓ Allowed: Unicode Arabic block U+0600–U+06FF and extensions.
  ✗ FORBIDDEN: Devanagari (Hindi), Bengali, Gujarati, Tamil, or ANY other non-Arabic script.
  ✗ FORBIDDEN: Latin letters INSIDE Urdu sentences (acronyms like "UN", "IMF" are OK at word boundaries).
  - At least 65% of identifiable letter characters must be Arabic script.
- title_ar and body_ar: EXCLUSIVELY Modern Standard Arabic. Same script rules apply.
- title_en and body_en: English only.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: systemPrompt }],
    max_tokens: 4000,
    temperature: 0.6,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`[${agent.name}] No JSON array in response`);
    return [];
  }

  let articles: GeneratedArticle[];
  try {
    articles = JSON.parse(match[0]);
  } catch (e) {
    console.error(`[${agent.name}] JSON parse error:`, e);
    return [];
  }

  const agentCategorySet = new Set(agent.categories);

  const validated = articles.filter((a) => {
    if (!a.title_en || !a.body_en || !a.title_ur || !a.body_ur || !a.title_ar || !a.body_ar) {
      console.warn(`[${agent.name}] Drop — missing fields: "${a.title_en}"`);
      return false;
    }

    // Category must be in the master list
    if (!VALID_CATEGORIES.has(a.category)) {
      console.warn(`[${agent.name}] Drop — invalid category "${a.category}": "${a.title_en}"`);
      return false;
    }

    // Category must also belong to THIS agent's assigned set
    if (!agentCategorySet.has(a.category)) {
      console.warn(
        `[${agent.name}] Drop — category "${a.category}" not in agent's set [${agent.categories.join(", ")}]: "${a.title_en}"`,
      );
      return false;
    }

    // Foreign-script check
    if (!isUrduArabicClean(a.title_ur) || !isUrduArabicClean(a.body_ur)) {
      console.warn(`[${agent.name}] Drop — mixed/foreign-script Urdu: "${a.title_en}"`);
      return false;
    }
    if (!isUrduArabicClean(a.title_ar) || !isUrduArabicClean(a.body_ar)) {
      console.warn(`[${agent.name}] Drop — mixed/foreign-script Arabic: "${a.title_en}"`);
      return false;
    }

    // Arabic-script density check (FIXED — was using broken \W regex before)
    if (!hasGoodArabicScriptDensity(a.body_ur)) {
      console.warn(`[${agent.name}] Drop — low Urdu density in body_ur: "${a.title_en}"`);
      return false;
    }
    if (!hasGoodArabicScriptDensity(a.body_ar)) {
      console.warn(`[${agent.name}] Drop — low Arabic density in body_ar: "${a.title_en}"`);
      return false;
    }

    // Content deduplication — hard reject if too similar to a recent title
    if (isDuplicateTitle(a.title_en, recentTitles)) {
      console.warn(`[${agent.name}] Drop — duplicate title detected: "${a.title_en}"`);
      return false;
    }

    return true;
  });

  const dropped = articles.length - validated.length;
  if (dropped > 0) {
    console.log(`[${agent.name}] Validation: dropped ${dropped}/${articles.length} article(s)`);
  }

  // Always override source_note
  for (const a of validated) {
    a.source_note = "Islam Nashra";
  }

  return validated;
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

const STOP_WORDS_IMG = new Set([
  "the","a","an","in","of","for","by","to","at","is","are","was","were",
  "has","have","had","on","with","from","and","or","but","not","as","its",
  "this","that","he","she","they","we","it","his","her","their","be",
  "been","will","would","could","should","may","might","also","over",
  "new","say","says","said","more","than","about","after","amid",
]);

const CATEGORY_ANCHORS: Record<string, string[]> = {
  Palestine:        ["Palestine mosque Gaza", "Al-Aqsa mosque", "Palestine crowd"],
  World:            ["Islamic summit world leaders", "mosque architecture skyline"],
  "South Asia":     ["mosque Pakistan Lahore", "Bangladesh mosque", "Kabul mosque"],
  Economy:          ["Islamic finance banking", "halal economy market"],
  Government:       ["Muslim leaders parliament", "Islamic country government"],
  Security:         ["military security Muslim country", "peacekeeping forces"],
  Scholars:         ["Islamic scholars lecture", "Muslim conference scholars"],
  Mosques:          ["grand mosque architecture", "Friday prayer mosque crowd"],
  Madrassas:        ["Islamic school students", "madrassa education"],
  Africa:           ["mosque Africa Nairobi", "African Muslim community"],
  "Southeast Asia": ["mosque Indonesia Malaysia", "Istiqlal mosque Jakarta"],
  Turkey:           ["Blue Mosque Istanbul", "Turkey skyline Bosphorus"],
  Community:        ["Muslim community gathering", "Islamic center community"],
};

function buildImageQueries(titleEn: string, bodyEn: string, category: string): string[] {
  const text = `${titleEn} ${bodyEn.slice(0, 300)}`;
  const properNouns = (text.match(/(?<=[a-z,;] )[A-Z][a-z]{2,}/g) ?? [])
    .filter((w) => !STOP_WORDS_IMG.has(w.toLowerCase()))
    .slice(0, 4);
  const titleWords = titleEn.toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS_IMG.has(w))
    .slice(0, 5);
  const kw = [...new Set([...properNouns, ...titleWords])].slice(0, 6);
  const anchors = CATEGORY_ANCHORS[category] ?? [`${category} mosque Islamic`];
  const queries: string[] = [];
  if (kw.length >= 3) queries.push(kw.slice(0, 4).join(" "));
  if (kw.length >= 1) queries.push(`${kw.slice(0, 3).join(" ")} ${anchors[0].split(" ")[0]}`);
  queries.push(anchors[0]);
  if (anchors[1]) queries.push(anchors[1]);
  return queries;
}

async function fetchImage(
  titleEn: string,
  bodyEn: string,
  category: string,
  usedUrls: Set<string>,
): Promise<string | null> {
  const key = Deno.env.get("PEXELS_API_KEY");
  if (!key) return null;
  for (const rawQ of buildImageQueries(titleEn, bodyEn, category)) {
    const q = encodeURIComponent(rawQ);
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${q}&per_page=15&orientation=landscape`,
        { headers: { Authorization: key } },
      );
      if (!res.ok) continue;
      const json = await res.json();
      for (const photo of (json.photos ?? []) as Array<{ src: { medium: string; large: string } }>) {
        const url = photo.src.medium || photo.src.large;
        if (url && !usedUrls.has(url)) { usedUrls.add(url); return url; }
      }
    } catch (err) {
      console.warn(`[image] Error for "${rawQ}":`, err);
    }
  }
  return null;
}

async function loadRecentImageUrls(
  supabase: ReturnType<typeof createClient>,
): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("posts")
      .select("image_url")
      .eq("has_image", true)
      .order("published_at", { ascending: false })
      .limit(50);
    return new Set<string>(
      (data ?? []).map((r: { image_url: string | null }) => r.image_url).filter(Boolean) as string[],
    );
  } catch {
    return new Set();
  }
}

// ─── Content moderation ───────────────────────────────────────────────────────

const BLOCKLIST = ["hate", "terror", "bomb", "kill", "murder", "massacre", "genocide targeting"];
function isFlagged(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKLIST.some((w) => lower.includes(w) && !lower.includes("anti-" + w));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("[news-gen] Starting");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Read and advance agent index ──────────────────────────────────────────
  const { data: stateRow, error: stateErr } = await supabase
    .from("generation_state")
    .select("current_agent_index")
    .eq("id", 1)
    .single();

  if (stateErr && stateErr.code !== "PGRST116") {
    console.error("[news-gen] Failed to read generation_state:", stateErr.message);
  }

  const agentIndex = stateRow?.current_agent_index ?? 0;
  const nextIndex  = (agentIndex + 1) % AGENTS.length;
  const agent      = AGENTS[agentIndex];

  // Advance BEFORE running to prevent duplicate runs on concurrent calls
  await supabase.from("generation_state").upsert({
    id: 1,
    current_agent_index: nextIndex,
    last_run_at: new Date().toISOString(),
    last_agent_name: agent.name,
  });

  console.log(
    `[news-gen] Agent ${agentIndex}/${AGENTS.length - 1} (${agent.name}) → next: ${AGENTS[nextIndex].name}`,
  );

  // ── Load context for this run ─────────────────────────────────────────────
  const [usedImageUrls, recentTitles] = await Promise.all([
    loadRecentImageUrls(supabase),
    loadRecentTitles(supabase, agent.categories),
  ]);

  console.log(
    `[${agent.name}] Dedup context: ${recentTitles.length} recent title(s) to avoid`,
  );

  let published = 0;
  let flagged   = 0;
  let imaged    = 0;

  try {
    const articles = await generateForAgent(agent, recentTitles);
    console.log(`[${agent.name}] Generated ${articles.length} valid article(s)`);

    for (const article of articles) {
      if (isFlagged(article.title_en) || isFlagged(article.body_en)) {
        await supabase.from("flagged_posts").insert({
          title: article.title_en, body: article.body_en,
          category: article.category,
          significance_score: article.significance_score,
          source_note: "Islam Nashra",
          flag_reason: "Automated content filter",
        });
        flagged++;
        continue;
      }

      const now        = new Date();
      const expires_at = new Date(now.getTime() + POST_TTL_MS).toISOString();

      let image_url: string | null = null;
      let has_image = false;
      if (imaged < DAILY_IMAGE_BUDGET) {
        image_url = await fetchImage(article.title_en, article.body_en, article.category, usedImageUrls);
        if (image_url) { has_image = true; imaged++; }
      }

      const { error: insertErr } = await supabase.from("posts").insert({
        title:            article.title_en,
        body:             article.body_en,
        category:         article.category,
        image_url,        has_image,
        significance_score: article.significance_score,
        source_note:      "Islam Nashra",
        published_at:     now.toISOString(),
        expires_at,
        is_breaking:      article.is_breaking,
        title_en:         article.title_en,  body_en: article.body_en,
        title_ur:         article.title_ur,  body_ur: article.body_ur,
        title_ar:         article.title_ar,  body_ar: article.body_ar,
        // notified_at intentionally null — push-notifications function stamps
        // it after sending so the same post is never notified twice.
      });

      if (insertErr) {
        console.error(`[${agent.name}] Insert error:`, insertErr.message);
        continue;
      }
      published++;
    }
  } catch (err) {
    console.error(`[${agent.name}] Fatal error:`, err);
  }

  // NOTE: Push notifications are handled exclusively by the push-notifications
  // Edge Function (runs 2 minutes after each news-generation call via pg_cron).
  // There is NO inline push send here — removing it eliminated duplicate
  // notifications (once in English only, then once in the user's language).

  console.log(`[${agent.name}] Done: ${published} published, ${flagged} flagged, ${imaged} with images`);

  return new Response(
    JSON.stringify({
      success: true,
      agent:       agent.name,
      agent_index: agentIndex,
      next_agent:  AGENTS[nextIndex].name,
      published,
      flagged,
      imaged,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
