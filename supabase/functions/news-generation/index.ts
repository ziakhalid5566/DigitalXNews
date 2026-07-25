/**
 * Supabase Edge Function: news-generation
 *
 * Ports the 8-agent AI news generation pipeline from the Express server to Deno.
 * Each agent uses its own Groq API key to maximize rate-limit headroom.
 *
 * Required secrets (set via `supabase secrets set`):
 *   GROQ_KEY_1_WORLD_PALESTINE, GROQ_KEY_2_SOUTH_ASIA, ..., GROQ_KEY_8_REGIONAL
 *   GROQ_API_KEY           (fallback key)
 *   PEXELS_API_KEY         (image fetching)
 *   SUPABASE_URL           (auto-injected by Supabase)
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
const IMAGE_SCORE_THRESHOLD = 6;

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  {
    name: "world_palestine",
    envKey: "GROQ_KEY_1_WORLD_PALESTINE",
    categories: ["World", "Palestine"],
    prompt: `You are a senior Islamic news analyst covering world affairs and the Palestinian situation.
Generate exactly 2 news articles about significant world events or Palestine in JSON format.`,
  },
  {
    name: "south_asia",
    envKey: "GROQ_KEY_2_SOUTH_ASIA",
    categories: ["South Asia"],
    prompt: `You are a senior Islamic news analyst covering South Asia (Pakistan, Bangladesh, India, Afghanistan, etc.).
Generate exactly 2 news articles about significant South Asian events in JSON format.`,
  },
  {
    name: "economy",
    envKey: "GROQ_KEY_3_ECONOMY",
    categories: ["Economy"],
    prompt: `You are a senior Islamic news analyst covering Islamic economy and finance.
Generate exactly 2 news articles about significant economic events affecting Muslim countries in JSON format.`,
  },
  {
    name: "government",
    envKey: "GROQ_KEY_4_GOVERNMENT",
    categories: ["Government"],
    prompt: `You are a senior Islamic news analyst covering government and politics in Muslim-majority countries.
Generate exactly 2 news articles about significant governance events in JSON format.`,
  },
  {
    name: "security",
    envKey: "GROQ_KEY_5_SECURITY",
    categories: ["Security"],
    prompt: `You are a senior Islamic news analyst covering security and conflict in Muslim regions.
Generate exactly 2 news articles about significant security events in JSON format.`,
  },
  {
    name: "scholars_mosques",
    envKey: "GROQ_KEY_6_SCHOLARS_MOSQUES",
    categories: ["Scholars", "Mosques"],
    prompt: `You are a senior Islamic news analyst covering Islamic scholars and mosque affairs.
Generate exactly 2 news articles — one about Islamic scholars/fatwas and one about mosques in JSON format.`,
  },
  {
    name: "madrassas",
    envKey: "GROQ_KEY_7_MADRASSAS",
    categories: ["Madrassas"],
    prompt: `You are a senior Islamic news analyst covering Islamic education and madrassas.
Generate exactly 2 news articles about Islamic education events in JSON format.`,
  },
  {
    name: "regional",
    envKey: "GROQ_KEY_8_REGIONAL",
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
- Include all 3 languages for every article`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: systemPrompt }],
    max_tokens: 3500,
    temperature: 0.7,
  });

  const raw = response.choices[0]?.message?.content ?? "[]";

  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`[${agent.name}] No JSON array found in response`);
    return [];
  }

  const articles: GeneratedArticle[] = JSON.parse(match[0]);
  return articles.filter(
    (a) =>
      a.title_en && a.body_en && a.title_ur && a.body_ur && a.title_ar && a.body_ar &&
      VALID_CATEGORIES.has(a.category),
  );
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","in","of","for","by","to","at","is","are","was","were",
  "has","have","had","on","with","from","and","or","but","not","as","its",
]);

function buildSearchQuery(titleEn: string, category: string): string {
  const words = titleEn.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 4);
  const anchor = { Palestine: "Palestine mosque", World: "Islamic architecture" }[category] ?? "mosque Islamic";
  if (!words.some((w) => anchor.toLowerCase().includes(w.slice(0, 4)))) words.push(anchor);
  return words.join(" ");
}

async function fetchImage(titleEn: string, category: string): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) return null;

  const q = encodeURIComponent(buildSearchQuery(titleEn, category));
  const res = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=5&orientation=landscape`, {
    headers: { Authorization: pexelsKey },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const photos: Array<{ src: { large: string } }> = json.photos ?? [];
  return photos[0]?.src?.large ?? null;
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

  let published = 0;
  let flagged = 0;
  let imagedCount = 0;

  for (let i = 0; i < AGENTS.length; i++) {
    const agent = AGENTS[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));

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

        // Fetch image for high-significance articles
        let image_url: string | null = null;
        let has_image = false;
        if (imagedCount < DAILY_IMAGE_BUDGET && article.significance_score >= IMAGE_SCORE_THRESHOLD) {
          image_url = await fetchImage(article.title_en, article.category);
          if (image_url) { has_image = true; imagedCount++; }
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

        // Send push notifications for breaking/high-significance posts
        if (post && (post.is_breaking || post.significance_score >= 8)) {
          const { data: prefs } = await supabase
            .from("user_preferences")
            .select("push_token, followed_categories, notifications_enabled")
            .eq("notifications_enabled", true);

          const tokens = (prefs ?? [])
            .filter((p: { push_token: string | null; followed_categories: string[]; is_breaking?: boolean }) => {
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
  }

  console.log(`News generation complete: ${published} published, ${flagged} flagged`);

  return new Response(
    JSON.stringify({ success: true, published, flagged }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
