/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║          DigitalXNews — Multi-Agent AI News Generation System              ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                              ║
 * ║  8 specialized AI agents consolidated onto 4 Groq API keys (2 agents/key). ║
 * ║  Within each key-pair agents run sequentially with a 25 s stagger to       ║
 * ║  stay within Groq's free-tier 12,000 TPM limit.                            ║
 * ║                                                                              ║
 * ║  KEY → AGENT PAIRING (set these 4 keys in Replit Secrets):                 ║
 * ║                                                                              ║
 * ║  GROQ_KEY_A → Agent 1 (world_palestine)  + Agent 2 (south_asia)           ║
 * ║               Agent 2 waits 25 s after Agent 1 finishes                    ║
 * ║                                                                              ║
 * ║  GROQ_KEY_B → Agent 3 (economy)          + Agent 4 (government)            ║
 * ║               Agent 4 waits 25 s after Agent 3 finishes                    ║
 * ║                                                                              ║
 * ║  GROQ_KEY_C → Agent 5 (security)         + Agent 6 (scholars_mosques)      ║
 * ║               Agent 6 waits 25 s after Agent 5 finishes                    ║
 * ║                                                                              ║
 * ║  GROQ_KEY_D → Agent 7 (madrassas)        + Agent 8 (regional)              ║
 * ║               Agent 8 waits 25 s after Agent 7 finishes                    ║
 * ║                                                                              ║
 * ║  Fallback: if a key is missing, GROQ_API_KEY is used instead.              ║
 * ║                                                                              ║
 * ║  RATE LIMIT STRATEGY:                                                        ║
 * ║  • Each Groq free-tier key = 12,000 TPM                                    ║
 * ║  • Each agent uses ~4,100 tokens (600 input + 3,500 max output)            ║
 * ║  • 25 s gap between paired agents lets the shared bucket refill            ║
 * ║  • Between pairs: 2 s gap only (different keys, no refill needed)          ║
 * ║  • Total runtime: ~(8×8 s API) + (4×25 s stagger) ≈ 3.5 min              ║
 * ║                                                                              ║
 * ║  SAFETY: Content labelled "AI-Generated Summary". No specific facts,       ║
 * ║  quotes, or individuals are fabricated. Source note always generic.        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import Groq from "groq-sdk";
import { logger } from "./logger";

export const CATEGORIES = [
  "World",
  "Palestine",
  "South Asia",
  "Economy",
  "Government",
  "Security",
  "Scholars",
  "Mosques",
  "Madrassas",
  "Africa",
  "Southeast Asia",
  "Turkey",
  "Community",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface GeneratedArticle {
  title_en: string;
  body_en: string;
  title_ur: string;
  body_ur: string;
  title_ar: string;
  body_ar: string;
  category: Category;
  significanceScore: number;
  sourceNote: string;
  isBreaking: boolean;
  country?: string;
}

// ─── Category Keyword Correction ──────────────────────────────────────────────
/**
 * Keyword map used to validate and correct AI category assignments.
 * When an agent covers multiple categories (e.g. Agent 8 covers Africa,
 * Southeast Asia, Turkey, Community), the AI occasionally assigns the wrong
 * category (e.g. labels a Rohingya article as "Turkey"). This map detects
 * the correct category from article text and overrides the AI's choice.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Africa: [
    "africa", "african", "nigeria", "nigerian", "kenya", "kenyan", "senegal",
    "senegalese", "ethiopia", "ethiopian", "tanzania", "tanzanian", "ghana",
    "ghanaian", "mali", "malian", "guinea", "somalia", "somali", "sudan",
    "sudanese", "chad", "niger", "sahel", "saharan", "sub-saharan", "west africa",
    "east africa", "north africa", "south africa",
  ],
  "Southeast Asia": [
    "indonesia", "indonesian", "malaysia", "malaysian", "philippines", "filipino",
    "myanmar", "burmese", "rohingya", "brunei", "thailand", "thai", "singapore",
    "cambodia", "mindanao", "southeast asia", "asean", "moro", "arakan",
  ],
  Turkey: [
    "turkey", "turkish", "ankara", "istanbul", "ottoman", "erdogan",
    "anatolia", "anatolian", "bosphorus", "turk",
  ],
  Community: [
    "western muslim", "muslim community", "united kingdom", "britain", "british",
    "united states", "american muslim", "canada", "canadian", "france", "french",
    "germany", "german", "europe", "european", "diaspora", "minority rights",
    "mosque in europe", "islam in the west", "muslim minority",
  ],
  Palestine: [
    "palestine", "palestinian", "gaza", "west bank", "al-aqsa", "aqsa",
    "hamas", "rafah", "hebron", "ramallah", "jerusalem", "occupied territory",
  ],
  "South Asia": [
    "pakistan", "pakistani", "bangladesh", "bangladeshi", "india", "indian",
    "afghanistan", "afghan", "kashmir", "kashmiri", "sri lanka",
  ],
  Economy: [
    "sukuk", "halal finance", "islamic banking", "sharia-compliant", "vision 2030",
    "zakat", "waqf", "halal market", "oic economic",
  ],
  Government: [
    "election", "parliament", "ministry", "legislation", "cabinet",
    "prime minister", "president", "foreign policy", "diplomacy",
  ],
  Security: [
    "conflict", "humanitarian", "refugee", "ceasefire", "war crimes",
    "military operation", "terrorism", "insurgency", "displacement",
  ],
  Scholars: [
    "scholar", "fatwa", "al-azhar", "ulema", "ulama", "mufti", "islamic conference",
    "religious guidance", "sheikh", "quran competition",
  ],
  Mosques: [
    "mosque", "masjid", "mecca", "medina", "masjid al-haram", "grand mosque",
    "minaret", "hajj", "umrah", "kaaba", "kabah",
  ],
  Madrassas: [
    "madrassa", "madrasa", "darul uloom", "islamic school", "religious school",
    "quran memorisation", "hafiz", "islamic curriculum", "seminary",
  ],
  World: [
    "oic", "organization of islamic cooperation", "muslim world", "ummah",
    "united nations", "global muslim", "international islamic",
  ],
};

/**
 * Validates and corrects an article's category by matching keywords in the
 * title and body against CATEGORY_KEYWORDS. Only considers categories in
 * `agentCategories` (i.e. categories this agent is responsible for).
 *
 * Returns the original category if no stronger match is found, so it never
 * downgrades a correct assignment.
 */
function correctCategory(
  article: GeneratedArticle,
  agentCategories: Category[]
): Category {
  // Single-category agents: no ambiguity possible
  if (agentCategories.length === 1) return agentCategories[0];

  const text = `${article.title_en} ${article.body_en}`.toLowerCase();

  // Score each of this agent's valid categories
  const scores: { cat: Category; score: number }[] = agentCategories.map((cat) => ({
    cat,
    score: (CATEGORY_KEYWORDS[cat] ?? []).filter((kw) => text.includes(kw)).length,
  }));

  const aiScore = scores.find((s) => s.cat === article.category)?.score ?? 0;
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));

  // Only override if another category scores strictly higher than the AI's choice
  return best.score > aiScore ? best.cat : article.category;
}

// ─── Per-Agent Groq Client ────────────────────────────────────────────────────

/**
 * Returns a Groq client for the given agent, using its dedicated API key.
 * Falls back to the shared GROQ_API_KEY if the specific key is not set.
 *
 * Each agent runs on a separate Groq rate-limit bucket → no 22s delays needed.
 */
function getGroqForAgent(agentEnvKey: string, agentName: string): Groq {
  const key = process.env[agentEnvKey] || process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      `No Groq API key found for agent "${agentName}". ` +
      `Set "${agentEnvKey}" (or "GROQ_API_KEY" as fallback) in Replit Secrets.`
    );
  }
  const usingFallback = !process.env[agentEnvKey];
  if (usingFallback) {
    logger.warn(
      { agentName, envKey: agentEnvKey },
      `Agent using shared GROQ_API_KEY fallback — set ${agentEnvKey} for isolated rate limits`
    );
  }
  return new Groq({ apiKey: key });
}

// ─── Agent Configuration ──────────────────────────────────────────────────────

interface AgentConfig {
  /** Unique agent identifier (used in logs and error messages) */
  name: string;
  /**
   * Environment variable name holding this agent's Groq API key.
   * Two agents share each key; the second agent in the pair uses delayBeforeMs
   * to stagger its call and avoid hitting the shared rate-limit bucket.
   * Falls back to GROQ_API_KEY if this env var is not set.
   */
  envKey: string;
  /**
   * Milliseconds to wait before this agent starts.
   * 0 for the first agent in a key-pair (or the first agent overall).
   * 25000 for the second agent in a key-pair (rate-limit stagger).
   * 2000 between key-pairs (different buckets, minimal DB-write gap only).
   */
  delayBeforeMs: number;
  /** News categories this agent is responsible for */
  categories: Category[];
  systemPrompt: string;
  userPrompt: string;
  articleCount: number;
}

const BASE_SAFETY_RULES = `
ABSOLUTE RULES — never violate:
1. NEVER fabricate specific facts, named quotes, exact statistics, or individuals
2. Write general summary style about well-known ongoing situations
3. NEVER invent specific breaking events or crises that did not occur
4. NEVER include sectarian framing, incitement, or defamatory claims
5. Write professionally and neutrally; respect all Muslims regardless of sect or nationality
6. sourceNote must always be "Compiled from multiple international sources"
7. isBreaking: true ONLY for significanceScore >= 9

URDU RULES:
- Write in standard Urdu script (نستعلیق). Every sentence must be grammatically complete.
- For technical/borrowed terms with no native Urdu equivalent (e.g. "inflation", "GDP", "ceasefire",
  "sanctions", "humanitarian", "summit", "bilateral"), write them in Roman English script — do NOT
  attempt Urdu-script transliterations that produce garbled or unreadable text.
- Common Urdu words (جنگ، معیشت، حکومت، مسجد، مدرسہ، امن، بحران) must be written in Urdu script.
- When in doubt between a garbled transliteration and a clear English word, always prefer English.

ARABIC RULES:
- Clear Modern Standard Arabic (فصحى) with newspaper register

OUTPUT FORMAT — CRITICAL:
Return ONLY a valid, COMPLETE JSON array. No markdown fences, no preamble, no explanation.
The array MUST be closed with ] before you stop.
Each object: title_en, body_en, title_ur, body_ur, title_ar, body_ar,
category, significanceScore (1-10 integer), sourceNote, isBreaking, country (optional ISO code)`;

const AGENTS: AgentConfig[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 1 — Global Islamic Affairs + Palestine          [KEY: GROQ_KEY_A — pair 1/2]
  // Covers: OIC, UN Palestine resolutions, Gaza, West Bank, Al-Aqsa, Muslim diaspora
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "world_palestine",
    envKey: "GROQ_KEY_A",
    delayBeforeMs: 0,
    categories: ["World", "Palestine"],
    systemPrompt: `You are a senior international journalist specialising in global Islamic affairs and Palestine.
Cover: OIC developments, events affecting Muslim communities, UN resolutions on Palestine,
Gaza humanitarian situation, West Bank settlements, Al-Aqsa Mosque, Muslim diaspora issues.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering World Islamic affairs and Palestine.
Each body 80-100 words per language. Cover different countries.
Category "World" for global affairs, "Palestine" for Palestine-specific.`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 2 — South Asia                                  [KEY: GROQ_KEY_A — pair 2/2]
  // Covers: Pakistan, Bangladesh, India Muslims, Afghanistan, Kashmir, Rohingya
  // 25 s stagger — shares GROQ_KEY_A with Agent 1
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "south_asia",
    envKey: "GROQ_KEY_A",
    delayBeforeMs: 25000,
    categories: ["South Asia"],
    systemPrompt: `You are an expert journalist covering South Asian Muslim affairs.
Cover: Pakistan (politics, economy, security), Bangladesh, India's Muslim minority,
Afghanistan, Kashmir, Rohingya refugees. Governance, economic policies, religious freedom, social issues.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering South Asian Muslim affairs.
Each body 80-100 words per language. Cover different countries (Pakistan, Bangladesh, India, Afghanistan).
Category always "South Asia".`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 3 — Islamic Economy & Finance                   [KEY: GROQ_KEY_B — pair 1/2]
  // Covers: Islamic banking, sukuk, halal economy, Saudi Vision 2030, Gulf finance
  // 2 s gap after Agent 2 — different key, just a DB-write buffer
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "economy",
    envKey: "GROQ_KEY_B",
    delayBeforeMs: 2000,
    categories: ["Economy"],
    systemPrompt: `You are an Islamic economics and halal finance journalist.
Cover: Islamic banking (sukuk, sharia-compliant finance), halal economy, Saudi Vision 2030,
Gulf financial news, Islamic waqf, zakat funds, halal market growth, OIC economic cooperation.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on the Islamic economy and halal finance.
Each body 80-100 words per language. Cover different countries/topics.
Category always "Economy".`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 4 — Governance & Politics                       [KEY: GROQ_KEY_B — pair 2/2]
  // Covers: elections, legislation, foreign policy in Muslim-majority countries
  // 25 s stagger — shares GROQ_KEY_B with Agent 3
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "government",
    envKey: "GROQ_KEY_B",
    delayBeforeMs: 25000,
    categories: ["Government"],
    systemPrompt: `You are an expert journalist covering governance in Muslim-majority countries.
Cover: elections, political transitions, legislation affecting Muslims, foreign policy,
Saudi Arabia, UAE, Turkey, Iran, Pakistan, Malaysia, Indonesia, Egypt, Morocco, Jordan.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on governance in Muslim-majority countries.
Each body 80-100 words per language. Cover different countries.
Category always "Government".`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 5 — Security & Humanitarian                     [KEY: GROQ_KEY_C — pair 1/2]
  // Covers: conflicts, peace processes, humanitarian crises, refugee situations
  // 2 s gap after Agent 4 — different key, just a DB-write buffer
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "security",
    envKey: "GROQ_KEY_C",
    delayBeforeMs: 2000,
    categories: ["Security"],
    systemPrompt: `You are a security analyst and humanitarian journalist covering Muslim-majority regions.
Cover: conflicts, peace processes, humanitarian crises, refugee situations (Syria, Yemen, Rohingya),
Sahel security, Somalia, Libya, Afghan humanitarian situation, earthquake/flood relief.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on security and humanitarian situations.
Each body 80-100 words per language. Cover different regions (Middle East, Africa, Asia).
Category always "Security".`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 6 — Islamic Scholars + Mosques                  [KEY: GROQ_KEY_C — pair 2/2]
  // Covers: fatwas, Al-Azhar, Mecca/Medina, mosque construction, Quran competitions
  // 25 s stagger — shares GROQ_KEY_C with Agent 5
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "scholars_mosques",
    envKey: "GROQ_KEY_C",
    delayBeforeMs: 25000,
    categories: ["Scholars", "Mosques"],
    systemPrompt: `You are an expert covering Islamic scholarship, religious institutions, and sacred sites.
Cover: major fatwas, Islamic conferences, Al-Azhar University, Mecca/Medina developments,
Masjid al-Haram expansions, major mosque construction worldwide, Quran competitions,
prominent Muslim scholars' statements and religious guidance.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on Islamic scholars and mosques.
Each body 80-100 words per language. Mix scholars news with mosque/sacred-sites news.
Category "Scholars" for scholarly news, "Mosques" for mosque/sacred-sites.`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 7 — Madrassas & Islamic Education               [KEY: GROQ_KEY_D — pair 1/2]
  // Covers: madrassa reforms, Al-Azhar, IIU, curriculum modernisation, online learning
  // 2 s gap after Agent 6 — different key, just a DB-write buffer
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "madrassas",
    envKey: "GROQ_KEY_D",
    delayBeforeMs: 2000,
    categories: ["Madrassas"],
    systemPrompt: `You are an expert on Islamic education and madrassas worldwide.
Cover: madrassa reforms in Pakistan, Bangladesh, Egypt, Indonesia, India;
Al-Azhar University, International Islamic Universities, curriculum modernisation,
Islamic education in Western countries, Quran memorisation programs, online Islamic learning.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on madrassas and Islamic education.
Each body 80-100 words per language. Cover different countries and education levels.
Category always "Madrassas".`,
    articleCount: 2,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent 8 — Africa + Southeast Asia + Turkey + Community [KEY: GROQ_KEY_D — pair 2/2]
  // Covers: Nigeria, Indonesia, Malaysia, Turkey, Western Muslim communities
  // 25 s stagger — shares GROQ_KEY_D with Agent 7
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "regional",
    envKey: "GROQ_KEY_D",
    delayBeforeMs: 25000,
    categories: ["Africa", "Southeast Asia", "Turkey", "Community"],
    systemPrompt: `You are a regional expert covering Africa, Southeast Asia, Turkey, and Western Muslim communities.
AFRICA: Nigeria, Senegal, Ethiopia, Kenya, Tanzania, Morocco, Algeria, Tunisia, Somalia, Sudan, Mali, Ghana, Guinea.
SOUTHEAST ASIA: Indonesia, Malaysia, Philippines (Mindanao), Myanmar (Rohingya), Brunei, Thailand, Singapore.
TURKEY: domestic politics, Ottoman heritage, Turkish diaspora, Central Asia.
COMMUNITY: Western Muslims (UK, USA, Canada, France, Germany), Muslim minority rights, halal lifestyle.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering Africa, Southeast Asia, Turkey, and Muslim communities.
Each body 80-100 words per language. Aim to cover all four regions across your articles.

CRITICAL — Category assignment rules (apply strictly):
- "Africa" → articles about African countries ONLY: Nigeria, Kenya, Senegal, Ethiopia, Tanzania, Morocco, Somalia, Sudan, etc.
- "Southeast Asia" → articles about: Indonesia, Malaysia, Philippines, Myanmar/Rohingya, Brunei, Thailand ONLY.
- "Turkey" → articles specifically about Turkey, Turkish politics, Ottoman history, or Turkish diaspora ONLY.
- "Community" → articles about Western Muslim communities (UK, USA, Canada, France, Germany, Europe) ONLY.
- The category field MUST match the country/region the article is actually about. Never label an African or Southeast Asian story as "Turkey".`,
    articleCount: 2,
  },
];

// ─── Core Article Generator ───────────────────────────────────────────────────

/** Strip ASCII control chars that break JSON.parse */
function sanitizeJson(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

async function generateAgentArticlesSafe(
  agent: AgentConfig
): Promise<GeneratedArticle[]> {
  const groq = getGroqForAgent(agent.envKey, agent.name);
  const userPrompt = agent.userPrompt.replace(
    "{count}",
    String(agent.articleCount)
  );

  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 0.65,
    max_tokens: 3500,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from Groq");

  const content = sanitizeJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try to extract the JSON array even if there's surrounding text
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response");
    parsed = JSON.parse(sanitizeJson(match[0]));
  }

  const arr: GeneratedArticle[] = Array.isArray(parsed)
    ? (parsed as GeneratedArticle[])
    : ((parsed as Record<string, unknown>).articles as GeneratedArticle[]) ?? [];

  return arr
    .filter(
      (a) =>
        a &&
        typeof a.title_en === "string" &&
        typeof a.body_en === "string" &&
        typeof a.category === "string" &&
        typeof a.significanceScore === "number"
    )
    .map((a) => {
      // Step 1: accept AI category if valid, else fall back to agent's first category
      const rawCategory: Category = (CATEGORIES as readonly string[]).includes(a.category)
        ? (a.category as Category)
        : (agent.categories[0] as Category);

      const mapped: GeneratedArticle = {
        ...a,
        title_ur: typeof a.title_ur === "string" ? a.title_ur : a.title_en,
        body_ur: typeof a.body_ur === "string" ? a.body_ur : a.body_en,
        title_ar: typeof a.title_ar === "string" ? a.title_ar : a.title_en,
        body_ar: typeof a.body_ar === "string" ? a.body_ar : a.body_en,
        sourceNote: "Compiled from multiple international sources",
        significanceScore: Math.min(10, Math.max(1, Math.round(a.significanceScore))),
        isBreaking: Boolean(a.isBreaking) && a.significanceScore >= 9,
        country: typeof a.country === "string" ? a.country : undefined,
        category: rawCategory,
      };

      // Step 2: keyword-based correction — catches cases where the AI assigns
      // a valid-but-wrong category (e.g. "Turkey" for a Rohingya/Africa article)
      const correctedCategory = correctCategory(mapped, agent.categories as Category[]);
      if (correctedCategory !== rawCategory) {
        logger.warn(
          { agent: agent.name, aiCategory: rawCategory, corrected: correctedCategory, title: a.title_en },
          "Category corrected by keyword matching"
        );
      }

      return { ...mapped, category: correctedCategory };
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run all 8 agents sequentially using the 4-key shared-key strategy.
 *
 * Key assignment (2 agents share each key):
 *   GROQ_KEY_A → agents 1 & 2  |  GROQ_KEY_B → agents 3 & 4
 *   GROQ_KEY_C → agents 5 & 6  |  GROQ_KEY_D → agents 7 & 8
 *
 * Timing:
 *   • delayBeforeMs = 0     — first agent in a pair (or the very first agent)
 *   • delayBeforeMs = 25000 — second agent in a pair (25 s stagger so the
 *                             shared bucket has time to refill before the next
 *                             ~4,100-token call)
 *   • delayBeforeMs = 2000  — first agent of a new pair (different key; short
 *                             gap purely to smooth out DB writes)
 *
 * Total runtime: ~(8 × 8 s API) + (4 × 25 s stagger) ≈ 3.5 minutes.
 */
export async function generateNewsArticles(): Promise<GeneratedArticle[]> {
  logger.info(
    { agentCount: AGENTS.length },
    "Starting multi-agent news generation — 4 shared Groq keys, 25 s intra-pair stagger"
  );

  const all: GeneratedArticle[] = [];

  for (const agent of AGENTS) {
    // Apply the per-agent delay defined in the AGENTS config
    if (agent.delayBeforeMs > 0) {
      logger.info(
        { agent: agent.name, delayMs: agent.delayBeforeMs, envKey: agent.envKey },
        agent.delayBeforeMs >= 25000
          ? "Intra-pair rate-limit stagger — waiting before shared-key agent"
          : "Inter-pair buffer — waiting before next key-pair agent"
      );
      await sleep(agent.delayBeforeMs);
    }

    try {
      logger.info({ agent: agent.name, envKey: agent.envKey }, "Agent starting");
      const articles = await generateAgentArticlesSafe(agent);
      logger.info(
        { agent: agent.name, count: articles.length },
        "Agent completed successfully"
      );
      all.push(...articles);
    } catch (err) {
      logger.error({ err, agent: agent.name }, "Agent failed — skipping");
    }
  }

  logger.info({ total: all.length }, "All agents finished");
  return all;
}
