/**
 * Supabase Edge Function: news-generation
 *
 * Sequential single-agent mode: each HTTP call runs exactly ONE agent, cycling
 * 0→1→2→…→7→0→… via the `generation_state` table.
 *
 * Items implemented:
 *   Item 7:  Groq-only (Llama) — no Gemini or other providers anywhere.
 *   Item 8:  Removed AI branding from source_note and UI-facing fields.
 *   Item 9:  Strengthened pure-Urdu enforcement in prompts + validation.
 *   Item 10: Clearer, simpler writing style — accessible to all readers.
 *
 * Scheduling (Item 6): pg_cron calls this every 5 minutes so agents run
 * sequentially with 5-minute gaps. See migrations/00002_pg_cron.sql.
 *
 * Required secrets (set via `supabase secrets set`):
 *   GROQ_KEY_A   → agents: world_palestine + south_asia
 *   GROQ_KEY_B   → agents: economy        + government
 *   GROQ_KEY_C   → agents: security       + scholars_mosques
 *   GROQ_KEY_D   → agents: madrassas      + regional
 *   GROQ_API_KEY              (fallback key)
 *   PEXELS_API_KEY            (image fetching)
 *   SUPABASE_URL              (auto-injected by Supabase)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import Groq from "npm:groq-sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Config ───────────────────────────────────────────────────────────────────

const POST_TTL_MS = 72 * 60 * 60 * 1000;
const DAILY_IMAGE_BUDGET = 500;

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  {
    name: "world_palestine",
    envKey: "GROQ_KEY_A",
    categories: ["World", "Palestine"],
    prompt: `You are a senior news writer for an Islamic news publication covering world affairs and Palestine.
Generate exactly 2 news articles in JSON format.`,
  },
  {
    name: "south_asia",
    envKey: "GROQ_KEY_A",
    categories: ["South Asia"],
    prompt: `You are a senior news writer covering South Asia (Pakistan, Bangladesh, India, Afghanistan, etc.).
Generate exactly 2 news articles about significant events in South Asia in JSON format.`,
  },
  {
    name: "economy",
    envKey: "GROQ_KEY_B",
    categories: ["Economy"],
    prompt: `You are a senior news writer covering Islamic economy and finance.
Generate exactly 2 news articles about economic events affecting Muslim countries in JSON format.`,
  },
  {
    name: "government",
    envKey: "GROQ_KEY_B",
    categories: ["Government"],
    prompt: `You are a senior news writer covering government and politics in Muslim-majority countries.
Generate exactly 2 news articles about governance events in JSON format.`,
  },
  {
    name: "security",
    envKey: "GROQ_KEY_C",
    categories: ["Security"],
    prompt: `You are a senior news writer covering security and conflict in Muslim regions.
Generate exactly 2 news articles about security events in JSON format.`,
  },
  {
    name: "scholars_mosques",
    envKey: "GROQ_KEY_C",
    categories: ["Scholars", "Mosques"],
    prompt: `You are a senior news writer covering Islamic scholars and mosque affairs.
Generate exactly 2 news articles — one about Islamic scholars/fatwas and one about mosques in JSON format.`,
  },
  {
    name: "madrassas",
    envKey: "GROQ_KEY_D",
    categories: ["Madrassas"],
    prompt: `You are a senior news writer covering Islamic education and madrassas.
Generate exactly 2 news articles about Islamic education events in JSON format.`,
  },
  {
    name: "regional",
    envKey: "GROQ_KEY_D",
    categories: ["Africa", "Southeast Asia", "Turkey", "Community"],
    prompt: `You are a senior news writer covering Africa, Southeast Asia, Turkey, and Muslim communities worldwide.
Generate exactly 2 news articles — one about Africa/Turkey/Southeast Asia and one about Muslim communities in JSON format.`,
  },
];

// Item 8: source_note is now neutral (no "AI-Generated" branding)
const ARTICLE_SCHEMA = `[
  {
    "title_en": "English headline (max 15 words)",
    "body_en": "English body (250-400 words)",
    "title_ur": "Urdu headline",
    "body_ur": "Urdu body (250-400 words)",
    "title_ar": "Arabic headline",
    "body_ar": "Arabic body (250-400 words)",
    "category": "one of: World, Palestine, South Asia, Economy, Government, Security, Scholars, Mosques, Madrassas, Africa, Southeast Asia, Turkey, Community",
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

// ─── Language validation (Item 9: strengthened) ───────────────────────────────

const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Returns true if text contains any non-Urdu/non-Arabic foreign script.
 * Item 9: Extended blocklist — catches more mixed-script combinations.
 */
function containsForeignScript(text: string): boolean {
  if (/[\u0900-\u097F]/.test(text)) return true;   // Devanagari (Hindi)
  if (/[\u0980-\u09FF]/.test(text)) return true;   // Bengali
  if (/[\u0A00-\u0A7F]/.test(text)) return true;   // Gurmukhi (Punjabi)
  if (/[\u0A80-\u0AFF]/.test(text)) return true;   // Gujarati
  if (/[\u0B00-\u0B7F]/.test(text)) return true;   // Odia
  if (/[\u0B80-\u0BFF]/.test(text)) return true;   // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return true;   // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return true;   // Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return true;   // Malayalam
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return true; // CJK (Chinese/Japanese)
  if (/[\u0400-\u04FF]/.test(text)) return true;   // Cyrillic
  if (/[\u0370-\u03FF]/.test(text)) return true;   // Greek
  if (/[\u0E00-\u0E7F]/.test(text)) return true;   // Thai
  if (/[\u0590-\u05FF]/.test(text)) return true;   // Hebrew
  if (/[\uAC00-\uD7AF]/.test(text)) return true;   // Hangul (Korean)
  if (/[\u3040-\u30FF]/.test(text)) return true;   // Hiragana/Katakana
  if (/[\u0E80-\u0EFF]/.test(text)) return true;   // Lao
  if (/[\u1000-\u109F]/.test(text)) return true;   // Myanmar/Burmese
  return false;
}

function isUrduArabicClean(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  if (containsForeignScript(text)) return false;
  if (!ARABIC_SCRIPT_REGEX.test(text)) return false;
  return true;
}

/**
 * Item 9: Count the ratio of Arabic-script characters to total word characters.
 * Reject if less than 70% of word characters are Arabic script — catches
 * articles where most of the text is Latin or numbers, not Urdu.
 */
function hasGoodUrduDensity(text: string): boolean {
  const wordChars = text.replace(/[\s\d\W]/g, '');
  if (wordChars.length === 0) return false;
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  return (arabicChars / wordChars.length) >= 0.7;
}

// ─── Groq call (Items 7, 9, 10) ───────────────────────────────────────────────

interface GeneratedArticle {
  title_en: string; body_en: string;
  title_ur: string; body_ur: string;
  title_ar: string; body_ar: string;
  category: string;
  significance_score: number;
  source_note: string;
  is_breaking: boolean;
}

async function generateForAgent(agent: typeof AGENTS[0]): Promise<GeneratedArticle[]> {
  // Item 7: Only Groq/Llama — no Gemini or other providers
  const apiKey = Deno.env.get(agent.envKey) ?? Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    console.warn(`[${agent.name}] No Groq API key found, skipping`);
    return [];
  }

  const groq = new Groq({ apiKey });

  // Item 10: Writing style — simple, clear, accessible to all readers
  // Item 9: Strengthened Urdu language instructions
  const systemPrompt = `${agent.prompt}

Return ONLY a valid JSON array matching this schema:
${ARTICLE_SCHEMA}

WRITING STYLE RULES (Item 10 — very important):
- Write in simple, everyday language that anyone can understand — from a schoolboy to an elderly villager.
- Avoid complex vocabulary, jargon, or technical terms. If you must use a technical word, explain it simply in the same sentence.
- Each sentence should be short and clear — no more than 20 words per sentence.
- Give enough background context so a reader unfamiliar with the topic can understand the full story.
- Do NOT use overly formal or bureaucratic language.
- The Urdu body (body_ur) must be especially simple — use vocabulary understood by madrasa students and ordinary village readers.
- significance_score: 1-10 (10 = major breaking event)
- is_breaking: true ONLY for genuinely major breaking events (score >= 9)
- source_note must always be "Islam Nashra"

CRITICAL URDU LANGUAGE RULES (Item 9 — failure to follow = article will be deleted):
- title_ur and body_ur: Write EXCLUSIVELY in authentic Urdu using Nastaliq/Perso-Arabic script.
  ✓ Allowed characters: Arabic block (U+0600–U+06FF), Arabic Extended (U+0750–U+077F), Arabic Presentation Forms (U+FB50–U+FDFF, U+FE70–U+FEFF).
  ✗ STRICTLY FORBIDDEN: Devanagari (Hindi script U+0900–U+097F), CJK (Chinese/Japanese), Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam, Cyrillic, Greek, Korean, Thai, Hebrew, or ANY other non-Arabic script.
  ✗ FORBIDDEN: Hindi words written in Devanagari script (like से, का, के, में, है, को, पर, etc.)
  ✗ FORBIDDEN: English words or Latin letters inside Urdu text.
  - Every single word in body_ur and title_ur must be pure Urdu in Arabic script. When in doubt about an Urdu word, use a common Urdu paraphrase — never use the Hindi equivalent.
  - At least 70% of word characters must be Arabic script characters.
- title_ar and body_ar: Write EXCLUSIVELY in Modern Standard Arabic. Same script rules apply.
- title_en and body_en: Write in English only.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: systemPrompt }],
    max_tokens: 3500,
    temperature: 0.65, // Slightly lower for more consistent output quality
  });

  const raw = response.choices[0]?.message?.content ?? "[]";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`[${agent.name}] No JSON array found in response`);
    return [];
  }

  let articles: GeneratedArticle[];
  try {
    articles = JSON.parse(match[0]);
  } catch (e) {
    console.error(`[${agent.name}] JSON parse error:`, e);
    return [];
  }

  // Item 9: Validate + enforce Urdu/Arabic cleanliness
  const validated = articles.filter((a) => {
    if (!a.title_en || !a.body_en || !a.title_ur || !a.body_ur || !a.title_ar || !a.body_ar) {
      console.warn(`[${agent.name}] Skipping — missing required fields: "${a.title_en}"`);
      return false;
    }
    if (!VALID_CATEGORIES.has(a.category)) {
      console.warn(`[${agent.name}] Skipping — invalid category "${a.category}": "${a.title_en}"`);
      return false;
    }
    // Script check
    if (!isUrduArabicClean(a.title_ur) || !isUrduArabicClean(a.body_ur)) {
      console.warn(`[${agent.name}] Skipping — mixed/foreign-script Urdu: "${a.title_en}"`);
      return false;
    }
    if (!isUrduArabicClean(a.title_ar) || !isUrduArabicClean(a.body_ar)) {
      console.warn(`[${agent.name}] Skipping — mixed/foreign-script Arabic: "${a.title_en}"`);
      return false;
    }
    // Density check (Item 9: at least 70% Arabic-script characters)
    if (!hasGoodUrduDensity(a.body_ur)) {
      console.warn(`[${agent.name}] Skipping — low Urdu density in body_ur: "${a.title_en}"`);
      return false;
    }
    if (!hasGoodUrduDensity(a.body_ar)) {
      console.warn(`[${agent.name}] Skipping — low Arabic density in body_ar: "${a.title_en}"`);
      return false;
    }
    return true;
  });

  if (validated.length < articles.length) {
    console.log(`[${agent.name}] Validation: dropped ${articles.length - validated.length} article(s) for language issues`);
  }

  // Item 8: Always override source_note to neutral value (no AI branding)
  for (const a of validated) {
    a.source_note = "Islam Nashra";
  }

  return validated;
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","in","of","for","by","to","at","is","are","was","were",
  "has","have","had","on","with","from","and","or","but","not","as","its",
  "this","that","he","she","they","we","it","his","her","their","be",
  "been","will","would","could","should","may","might","also","over",
  "new","say","says","said","more","than","about","after","amid",
]);

const CATEGORY_ANCHORS: Record<string, string[]> = {
  Palestine: ["Palestine mosque Gaza", "Al-Aqsa mosque", "Palestine crowd"],
  World:     ["Islamic summit world leaders", "mosque architecture skyline"],
  "South Asia": ["mosque Pakistan Lahore", "Bangladesh mosque", "Kabul mosque"],
  Economy:   ["Islamic finance banking", "halal economy market"],
  Government: ["Muslim leaders parliament", "Islamic country government"],
  Security:  ["military security Muslim country", "peacekeeping forces"],
  Scholars:  ["Islamic scholars lecture", "Muslim conference scholars"],
  Mosques:   ["grand mosque architecture", "Friday prayer mosque crowd"],
  Madrassas: ["Islamic school students", "madrassa education"],
  Africa:    ["mosque Africa Nairobi", "African Muslim community"],
  "Southeast Asia": ["mosque Indonesia Malaysia", "Istiqlal mosque Jakarta"],
  Turkey:    ["Blue Mosque Istanbul", "Turkey skyline Bosphorus"],
  Community: ["Muslim community gathering", "Islamic center community"],
};

function extractKeywords(titleEn: string, bodyEn: string, category: string): string[] {
  const text = `${titleEn} ${bodyEn.slice(0, 300)}`;
  const properNouns = (text.match(/(?<=[a-z,;] )[A-Z][a-z]{2,}/g) ?? [])
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4);
  const titleWords = titleEn.toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 5);
  const merged = [...new Set([...properNouns, ...titleWords])];
  return merged.slice(0, 6);
}

function buildQueryCandidates(titleEn: string, bodyEn: string, category: string): string[] {
  const kw = extractKeywords(titleEn, bodyEn, category);
  const anchors = CATEGORY_ANCHORS[category] ?? [`${category} mosque Islamic`];
  const queries: string[] = [];
  if (kw.length >= 3) queries.push(kw.slice(0, 4).join(" "));
  if (kw.length >= 1) {
    const anchorWord = anchors[0].split(" ")[0];
    queries.push(`${kw.slice(0, 3).join(" ")} ${anchorWord}`);
  }
  queries.push(anchors[0]);
  if (anchors[1]) queries.push(anchors[1]);
  return queries;
}

async function fetchImage(
  titleEn: string,
  bodyEn: string,
  category: string,
  usedImageUrls: Set<string>,
): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) return null;

  const queries = buildQueryCandidates(titleEn, bodyEn, category);

  for (const rawQuery of queries) {
    const q = encodeURIComponent(rawQuery);
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${q}&per_page=15&orientation=landscape`,
        { headers: { Authorization: pexelsKey } },
      );
      if (!res.ok) continue;
      const json = await res.json();
      const photos: Array<{ src: { medium: string; large: string } }> = json.photos ?? [];
      for (const photo of photos) {
        const url = photo.src.medium || photo.src.large;
        if (!url) continue;
        if (!usedImageUrls.has(url)) {
          usedImageUrls.add(url);
          return url;
        }
      }
    } catch (err) {
      console.warn(`[Image] Fetch error for "${rawQuery}":`, err);
    }
  }
  return null;
}

async function loadRecentImageUrls(
  supabase: ReturnType<typeof createClient>,
  limit = 50,
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("posts")
      .select("image_url")
      .eq("has_image", true)
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) return new Set();
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
  return BLOCKLIST.some((word) => lower.includes(word) && !lower.includes("anti-" + word));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("News generation started");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Read current agent index
  const { data: stateRow, error: stateReadErr } = await supabase
    .from("generation_state")
    .select("current_agent_index")
    .eq("id", 1)
    .single();

  if (stateReadErr && stateReadErr.code !== "PGRST116") {
    console.error("Failed to read generation_state:", stateReadErr);
  }

  const agentIndex = stateRow?.current_agent_index ?? 0;
  const nextIndex = (agentIndex + 1) % AGENTS.length;
  const agent = AGENTS[agentIndex];

  // Advance index before running (prevents duplicate runs on concurrent calls)
  await supabase.from("generation_state").upsert({
    id: 1,
    current_agent_index: nextIndex,
    last_run_at: new Date().toISOString(),
    last_agent_name: agent.name,
  });

  console.log(
    `Sequential run: agent ${agentIndex}/${AGENTS.length - 1} (${agent.name})` +
    ` → next: ${nextIndex} (${AGENTS[nextIndex].name})`,
  );

  const usedImageUrls = await loadRecentImageUrls(supabase, 50);
  let published = 0;
  let flagged = 0;
  let imagedCount = 0;

  try {
    const articles = await generateForAgent(agent);
    console.log(`[${agent.name}] Generated ${articles.length} valid articles`);

    for (const article of articles) {
      if (isFlagged(article.title_en) || isFlagged(article.body_en)) {
        await supabase.from("flagged_posts").insert({
          title: article.title_en, body: article.body_en,
          category: article.category, significance_score: article.significance_score,
          source_note: article.source_note, flag_reason: "Automated content filter",
        });
        flagged++;
        continue;
      }

      const now = new Date();
      const expires_at = new Date(now.getTime() + POST_TTL_MS).toISOString();

      let image_url: string | null = null;
      let has_image = false;
      if (imagedCount < DAILY_IMAGE_BUDGET) {
        image_url = await fetchImage(article.title_en, article.body_en, article.category, usedImageUrls);
        if (image_url) { has_image = true; imagedCount++; }
      }

      const { data: post, error } = await supabase.from("posts").insert({
        title: article.title_en,
        body: article.body_en,
        category: article.category,
        image_url, has_image,
        significance_score: article.significance_score,
        // Item 8: source_note is "Islam Nashra" — no AI branding
        source_note: "Islam Nashra",
        published_at: now.toISOString(),
        expires_at,
        is_breaking: article.is_breaking,
        title_en: article.title_en, body_en: article.body_en,
        title_ur: article.title_ur, body_ur: article.body_ur,
        title_ar: article.title_ar, body_ar: article.body_ar,
      }).select().single();

      if (error) { console.error("Insert error:", error); continue; }
      published++;

      // Push notifications for breaking/high-significance posts
      // (Separate dedicated push-notifications function handles broader sends)
      if (post && (post.is_breaking || post.significance_score >= 8)) {
        const { data: prefs } = await supabase
          .from("user_preferences")
          .select("push_token, followed_categories, notifications_enabled")
          .eq("notifications_enabled", true);

        const tokens = (prefs ?? [])
          .filter((p: { push_token: string | null; followed_categories: string[] }) => {
            if (!p.push_token) return false;
            if (post.is_breaking) return true;
            if (!p.followed_categories?.length) return true;
            return p.followed_categories.includes(post.category);
          })
          .map((p: { push_token: string }) => p.push_token);

        if (tokens.length > 0) {
          const messages = tokens
            .filter((t: string) => t.startsWith("ExponentPushToken["))
            .map((to: string) => ({
              to, sound: "default",
              title: post.is_breaking ? `🔴 ${post.title}` : `📰 ${post.title}`,
              body: post.body.substring(0, 120),
              data: { postId: post.id },
            }));
          if (messages.length > 0) {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(messages),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[${agent.name}] Error:`, err);
  }

  console.log(`[${agent.name}] Done: ${published} published, ${flagged} flagged, ${imagedCount} with images`);

  return new Response(
    JSON.stringify({
      success: true,
      agent: agent.name,
      agent_index: agentIndex,
      next_agent: AGENTS[nextIndex].name,
      published,
      flagged,
      imaged: imagedCount,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
