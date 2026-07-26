/**
 * Supabase Edge Function: news-generation
 *
 * Sequential single-agent mode: each HTTP call runs exactly ONE agent, cycling
 * 0→1→2→…→7→0→… via the `generation_state` table.  pg_cron invokes this
 * function every 15 minutes so a fresh pair of articles arrives every 15 min
 * and the full 8-agent cycle completes in 2 hours before repeating.
 *
 * TOKEN BUDGET (Groq free tier = 100k TPD per key, 4 keys total):
 *   Each agent:  ~4,100 tokens (600 input + 3,500 max output)
 *   Agents/key:  2  (key A→agents 0&1, B→2&3, C→4&5, D→6&7)
 *   Calls/key/day: 12 cycles × 2 agents = 24 calls × 4,100 = 98,400/key ✓
 *   No intra-pair stagger needed — each agent gets its own 15-min window.
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
    delayBeforeMs: 0,
    categories: ["World", "Palestine"],
    prompt: `You are a senior Islamic news analyst covering world affairs and the Palestinian situation.
Generate exactly 2 news articles about significant world events or Palestine in JSON format.`,
  },
  {
    name: "south_asia",
    envKey: "GROQ_KEY_A",
    delayBeforeMs: 25000,
    categories: ["South Asia"],
    prompt: `You are a senior Islamic news analyst covering South Asia (Pakistan, Bangladesh, India, Afghanistan, etc.).
Generate exactly 2 news articles about significant South Asian events in JSON format.`,
  },
  {
    name: "economy",
    envKey: "GROQ_KEY_B",
    delayBeforeMs: 2000,
    categories: ["Economy"],
    prompt: `You are a senior Islamic news analyst covering Islamic economy and finance.
Generate exactly 2 news articles about significant economic events affecting Muslim countries in JSON format.`,
  },
  {
    name: "government",
    envKey: "GROQ_KEY_B",
    delayBeforeMs: 25000,
    categories: ["Government"],
    prompt: `You are a senior Islamic news analyst covering government and politics in Muslim-majority countries.
Generate exactly 2 news articles about significant governance events in JSON format.`,
  },
  {
    name: "security",
    envKey: "GROQ_KEY_C",
    delayBeforeMs: 2000,
    categories: ["Security"],
    prompt: `You are a senior Islamic news analyst covering security and conflict in Muslim regions.
Generate exactly 2 news articles about significant security events in JSON format.`,
  },
  {
    name: "scholars_mosques",
    envKey: "GROQ_KEY_C",
    delayBeforeMs: 25000,
    categories: ["Scholars", "Mosques"],
    prompt: `You are a senior Islamic news analyst covering Islamic scholars and mosque affairs.
Generate exactly 2 news articles — one about Islamic scholars/fatwas and one about mosques in JSON format.`,
  },
  {
    name: "madrassas",
    envKey: "GROQ_KEY_D",
    delayBeforeMs: 2000,
    categories: ["Madrassas"],
    prompt: `You are a senior Islamic news analyst covering Islamic education and madrassas.
Generate exactly 2 news articles about Islamic education events in JSON format.`,
  },
  {
    name: "regional",
    envKey: "GROQ_KEY_D",
    delayBeforeMs: 25000,
    categories: ["Africa", "Southeast Asia", "Turkey", "Community"],
    prompt: `You are a senior Islamic news analyst covering Africa, Southeast Asia, Turkey, and Muslim communities worldwide.
Generate exactly 2 news articles — one about Africa/Turkey/Southeast Asia and one about Muslim communities in JSON format.`,
  },
];

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
    "source_note": "AI-Generated Summary",
    "is_breaking": false
  }
]`;

const VALID_CATEGORIES = new Set([
  "World", "Palestine", "South Asia", "Economy", "Government",
  "Security", "Scholars", "Mosques", "Madrassas", "Africa",
  "Southeast Asia", "Turkey", "Community",
]);

// ─── Language validation ───────────────────────────────────────────────────────

/**
 * Unicode ranges for Urdu/Arabic script characters.
 * Urdu is written in Nastaliq (a variant of Arabic script), so valid
 * characters include Arabic block + Arabic Extended + Arabic Presentation Forms.
 */
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Detect non-Urdu/Arabic/Latin characters in supposedly Urdu text.
 * Returns true if the text contains Devanagari (Hindi), CJK (Chinese/Japanese/Korean),
 * Cyrillic, Greek, or any other script that should not appear in Urdu content.
 */
function containsForeignScript(text: string): boolean {
  // Devanagari (Hindi): U+0900–U+097F
  if (/[\u0900-\u097F]/.test(text)) return true;
  // CJK Unified Ideographs (Chinese/Japanese): U+4E00–U+9FFF + extensions
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF]/.test(text)) return true;
  // Cyrillic: U+0400–U+04FF
  if (/[\u0400-\u04FF]/.test(text)) return true;
  // Greek: U+0370–U+03FF
  if (/[\u0370-\u03FF]/.test(text)) return true;
  // Thai: U+0E00–U+0E7F
  if (/[\u0E00-\u0E7F]/.test(text)) return true;
  // Hebrew: U+0590–U+05FF
  if (/[\u0590-\u05FF]/.test(text)) return true;
  // Hangul (Korean): U+AC00–U+D7AF
  if (/[\uAC00-\uD7AF]/.test(text)) return true;
  // Katakana/Hiragana (Japanese): U+3040–U+30FF
  if (/[\u3040-\u30FF]/.test(text)) return true;
  return false;
}

/**
 * Validate that Arabic text doesn't contain foreign scripts.
 * Arabic content may legitimately contain some Latin (proper nouns), but
 * should not contain Devanagari, CJK, etc.
 */
function isUrduArabicClean(text: string): boolean {
  if (!text) return false;
  if (containsForeignScript(text)) return false;
  // Ensure the text actually contains Urdu/Arabic script characters
  // (not just Latin/numbers, which would indicate wrong language)
  if (!ARABIC_SCRIPT_REGEX.test(text)) return false;
  return true;
}

// ─── Groq call ────────────────────────────────────────────────────────────────

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
  const apiKey = Deno.env.get(agent.envKey) ?? Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    console.warn(`[${agent.name}] No API key found, skipping`);
    return [];
  }

  const groq = new Groq({ apiKey });
  const systemPrompt = `${agent.prompt}

Return ONLY a valid JSON array matching this schema:
${ARTICLE_SCHEMA}

Rules:
- All articles must be factual-style summaries (AI-generated, no specific quotes or fabricated individuals)
- significance_score: 1-10 (10 = breaking/major international event)
- is_breaking: true only for genuinely major breaking events (score >= 9)
- source_note must always be "AI-Generated Summary"
- Include all 3 languages for every article

CRITICAL LANGUAGE RULES — you MUST follow these exactly:
- title_ur and body_ur: Write EXCLUSIVELY in Urdu using the Nastaliq/Perso-Arabic script (Unicode block U+0600–U+06FF). Do NOT use Devanagari (Hindi script), Chinese/CJK characters, Latin letters, Cyrillic, Greek, or any other script. Every word must be authentic Urdu vocabulary in Arabic script. If you are unsure of an Urdu word, use a common Urdu paraphrase — never substitute Hindi words written in Devanagari.
- title_ar and body_ar: Write EXCLUSIVELY in Modern Standard Arabic using Arabic script. Do NOT mix in any other scripts.
- title_en and body_en: Write in English only.
- Mixed-script output will be rejected. Produce clean, pure Urdu and Arabic text.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: systemPrompt }],
    max_tokens: 3500,
    temperature: 0.7,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`[${agent.name}] No JSON array found in response`);
    return [];
  }

  const articles: GeneratedArticle[] = JSON.parse(match[0]);

  const validated = articles.filter((a) => {
    if (!a.title_en || !a.body_en || !a.title_ur || !a.body_ur || !a.title_ar || !a.body_ar) {
      console.warn(`[${agent.name}] Skipping article missing required fields: "${a.title_en}"`);
      return false;
    }
    if (!VALID_CATEGORIES.has(a.category)) {
      console.warn(`[${agent.name}] Skipping article with invalid category: "${a.category}"`);
      return false;
    }
    // Validate Urdu text is clean (no foreign scripts mixed in)
    if (!isUrduArabicClean(a.title_ur) || !isUrduArabicClean(a.body_ur)) {
      console.warn(`[${agent.name}] Skipping article with mixed/foreign-script Urdu: "${a.title_en}"`);
      return false;
    }
    // Validate Arabic text is clean
    if (!isUrduArabicClean(a.title_ar) || !isUrduArabicClean(a.body_ar)) {
      console.warn(`[${agent.name}] Skipping article with mixed/foreign-script Arabic: "${a.title_en}"`);
      return false;
    }
    return true;
  });

  if (validated.length < articles.length) {
    console.log(`[${agent.name}] Language validation: ${articles.length - validated.length} article(s) dropped for mixed-script content`);
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

/**
 * Category-specific anchor queries — used as the final fallback if specific
 * title-based queries return no new (non-duplicate) image.
 */
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

/**
 * Extract meaningful keywords from the article title and body.
 * Prioritises proper nouns, countries, and domain-specific terms.
 */
function extractKeywords(titleEn: string, bodyEn: string, category: string): string[] {
  const text = `${titleEn} ${bodyEn.slice(0, 300)}`;

  // Proper nouns — capitalised words that aren't sentence-starters
  const properNouns = (text.match(/(?<=[a-z,;] )[A-Z][a-z]{2,}/g) ?? [])
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4);

  // Common content words from title
  const titleWords = titleEn.toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 5);

  // Merge, deduplicate, prioritise proper nouns first
  const merged = [...new Set([...properNouns, ...titleWords])];
  return merged.slice(0, 6);
}

/**
 * Build a ranked list of queries to try, from most-specific to broadest.
 */
function buildQueryCandidates(titleEn: string, bodyEn: string, category: string): string[] {
  const kw = extractKeywords(titleEn, bodyEn, category);
  const anchors = CATEGORY_ANCHORS[category] ?? [`${category} mosque Islamic`];
  const queries: string[] = [];

  // 1. Very specific: top proper-noun keywords only (most relevant, most unique)
  if (kw.length >= 3) {
    queries.push(kw.slice(0, 4).join(" "));
  }

  // 2. Medium: top keywords + first category anchor word
  if (kw.length >= 1) {
    const anchorWord = anchors[0].split(" ")[0];
    queries.push(`${kw.slice(0, 3).join(" ")} ${anchorWord}`);
  }

  // 3. Broad: full first anchor phrase (e.g. "Palestine mosque Gaza")
  queries.push(anchors[0]);

  // 4. Broadest: second anchor phrase (if available) — last resort
  if (anchors[1]) queries.push(anchors[1]);

  return queries;
}

/**
 * Fetch an image from Pexels for an article.
 *
 * Uses src.medium (1200px wide) instead of src.large (1880px) for better
 * mobile performance and faster loading on Android devices.
 *
 * Strategy:
 *  • Tries queries from most-specific → broadest.
 *  • For each query, fetches 15 results and picks the first URL that is NOT
 *    already in `usedImageUrls`.
 *  • Adds the chosen URL to `usedImageUrls` before returning so the same URL
 *    isn't reused within this run.
 *  • Returns null only when every query returns zero results or only duplicates.
 */
async function fetchImage(
  titleEn: string,
  bodyEn: string,
  category: string,
  usedImageUrls: Set<string>,
): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) {
    console.warn("[Image] PEXELS_API_KEY not set — images skipped");
    return null;
  }

  const queries = buildQueryCandidates(titleEn, bodyEn, category);

  for (const rawQuery of queries) {
    const q = encodeURIComponent(rawQuery);
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${q}&per_page=15&orientation=landscape`,
        { headers: { Authorization: pexelsKey } },
      );

      if (!res.ok) {
        console.warn(`[Image] Pexels API error ${res.status} for query "${rawQuery}"`);
        continue;
      }

      const json = await res.json();
      // Use src.medium (1200px wide) — better for mobile than src.large (1880px).
      // Falls back to src.large if medium is missing for any photo.
      const photos: Array<{ src: { medium: string; large: string } }> = json.photos ?? [];

      // Pick first non-duplicate photo
      for (const photo of photos) {
        const url = photo.src.medium || photo.src.large;
        if (!url) continue;
        if (!usedImageUrls.has(url)) {
          usedImageUrls.add(url);
          console.log(`[Image] Found image via query "${rawQuery}": ${url.slice(0, 80)}`);
          return url;
        }
      }
      console.log(`[Image] Query "${rawQuery}" — all ${photos.length} results were duplicates, trying next query`);
    } catch (err) {
      console.warn(`[Image] Fetch error for query "${rawQuery}":`, err);
    }
  }

  console.warn(`[Image] No unique image found for: "${titleEn}"`);
  return null;
}

/**
 * Load image URLs from the last N published posts to seed the deduplication set.
 * This prevents reusing images that appeared in recent runs.
 */
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

    if (error) {
      console.warn("[Image] Could not load recent image URLs:", error.message);
      return new Set();
    }

    const urls = new Set<string>(
      (data ?? [])
        .map((r: { image_url: string | null }) => r.image_url)
        .filter(Boolean) as string[],
    );
    console.log(`[Image] Seeded ${urls.size} recently-used image URLs (dedup set)`);
    return urls;
  } catch {
    return new Set();
  }
}

// ─── Content moderation (basic) ───────────────────────────────────────────────

const BLOCKLIST = ["hate", "terror", "bomb", "kill", "murder", "massacre", "genocide targeting"];

function isFlagged(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKLIST.some((word) => lower.includes(word) && !lower.includes("anti-" + word));
}

// ─── Push notifications ───────────────────────────────────────────────────────

async function sendPushNotification(tokens: string[], title: string, body: string, postId: string) {
  const messages = tokens.filter((t) => t.startsWith("ExponentPushToken[")).map((to) => ({
    to, sound: "default", title, body, data: { postId },
  }));
  if (messages.length === 0) return;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
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

  // ── Sequential single-agent mode ──────────────────────────────────────────
  // Read the current agent index from generation_state, advance it immediately
  // (prevents duplicate runs if pg_cron fires twice), then run exactly ONE agent.

  // 1. Read current index
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

  // 2. Advance the index before running (idempotent on concurrent calls)
  await supabase
    .from("generation_state")
    .upsert({
      id: 1,
      current_agent_index: nextIndex,
      last_run_at: new Date().toISOString(),
      last_agent_name: agent.name,
    });

  console.log(
    `Sequential run: agent ${agentIndex}/${AGENTS.length - 1} (${agent.name})` +
    ` → next will be ${nextIndex} (${AGENTS[nextIndex].name})`,
  );

  // 3. Seed image deduplication set from recent posts
  const usedImageUrls = await loadRecentImageUrls(supabase, 50);

  let published = 0;
  let flagged = 0;
  let imagedCount = 0;

  // 4. Run only the selected agent — no delay needed (its own 15-min window)
  try {
    const articles = await generateForAgent(agent);
    console.log(`[${agent.name}] Generated ${articles.length} articles`);

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

      // Fetch an image for every post (single-agent run stays well within budget).
      let image_url: string | null = null;
      let has_image = false;
      if (imagedCount < DAILY_IMAGE_BUDGET) {
        image_url = await fetchImage(article.title_en, article.body_en, article.category, usedImageUrls);
        if (image_url) {
          has_image = true;
          imagedCount++;
          console.log(`[${agent.name}] Image attached (${imagedCount}/${DAILY_IMAGE_BUDGET})`);
        } else {
          console.warn(`[${agent.name}] No image found for: "${article.title_en}"`);
        }
      }

      const { data: post, error } = await supabase.from("posts").insert({
        title: article.title_en,
        body: article.body_en,
        category: article.category,
        image_url, has_image,
        significance_score: article.significance_score,
        source_note: article.source_note,
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
          const notifTitle = post.is_breaking ? `🔴 بریکنگ: ${post.title}` : `📰 ${post.title}`;
          await sendPushNotification(tokens, notifTitle, post.body.substring(0, 120), post.id);
        }
      }
    }
  } catch (err) {
    console.error(`[${agent.name}] Error:`, err);
  }

  console.log(
    `[${agent.name}] Complete: ${published} published, ${flagged} flagged, ${imagedCount} with images`,
  );

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
