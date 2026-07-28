/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║          DigitalXNews — Multi-Agent AI News Generation (Gemini)            ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                              ║
 * ║  8 specialized AI agents powered by Google Gemini (gemini-2.0-flash-lite). ║
 * ║  Cheapest / free-tier Gemini model — replaces Groq.                        ║
 * ║  Single GEMINI_API_KEY required (set in Replit Secrets).                   ║
 * ║                                                                              ║
 * ║  Rate limit: gemini-2.0-flash-lite = 30 RPM free tier.                    ║
 * ║  8 agents with 2.5s gap each = ~20s total, well within 30 RPM.            ║
 * ║                                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
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

// ─── News Sources by Category ─────────────────────────────────────────────────
const SOURCES_BY_CATEGORY: Record<string, string[]> = {
  World: ["Al Jazeera", "Reuters", "BBC News", "AFP", "AP News", "The Guardian", "Middle East Eye"],
  Palestine: ["Al Jazeera", "Middle East Eye", "AFP", "Reuters", "UN OCHA", "Al-Monitor"],
  "South Asia": ["Dawn News", "The News International", "GEO News", "ARY News", "BBC Urdu", "Aaj TV", "The Daily Star", "Prothom Alo", "Khabar"],
  Economy: ["Arab News", "Saudi Gazette", "Gulf News", "Reuters", "Bloomberg", "Islamic Finance News", "Al Jazeera Economy"],
  Government: ["Al Jazeera", "Reuters", "Middle East Eye", "Arab News", "Turkey's TRT World", "Anadolu Agency"],
  Security: ["Reuters", "AP News", "BBC News", "Al Jazeera", "UN News", "Amnesty International"],
  Scholars: ["Muslim World League", "Al-Azhar Official", "Dar al-Ifta Egypt", "IslamWeb", "Anadolu Agency"],
  Mosques: ["Saudi Gazette", "Haramain Info", "Islamic News Agency", "Muslim World League", "Arab News"],
  Madrassas: ["Dawn News", "The News International", "Al-Azhar Official", "Muslim World League", "UNESCO"],
  Africa: ["Daily Trust Nigeria", "Premium Times Nigeria", "The East African", "Al Jazeera Africa", "Reuters Africa"],
  "Southeast Asia": ["The Straits Times", "Berita Harian", "Kompas Indonesia", "Al Jazeera", "Anadolu Agency"],
  Turkey: ["TRT World", "Daily Sabah", "Anadolu Agency", "Hurriyet Daily News", "Al Jazeera"],
  Community: ["Islam Channel UK", "Muslim News UK", "IslamiCity", "Al Jazeera English", "Reuters"],
};

function getSourceForCategory(category: string): string {
  const sources = SOURCES_BY_CATEGORY[category] ?? ["Al Jazeera", "Reuters", "BBC News"];
  return sources[Math.floor(Math.random() * sources.length)];
}

// ─── Gemini Client ─────────────────────────────────────────────────────────────
let _gemini: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (_gemini) return _gemini;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. " +
      "Get a free key at https://aistudio.google.com/app/apikey and add it to Replit Secrets."
    );
  }
  _gemini = new GoogleGenerativeAI(apiKey);
  return _gemini;
}

// ─── Category Keyword Correction ──────────────────────────────────────────────
const CATEGORY_KEYWORDS: Partial<Record<Category, string[]>> = {
  Palestine: ["palestine", "gaza", "west bank", "al-aqsa", "hamas", "fatah", "ramallah", "hebron"],
  "South Asia": ["pakistan", "bangladesh", "kashmir", "rohingya", "afghan", "india muslim", "sri lanka"],
  Turkey: ["turkey", "türkiye", "erdogan", "istanbul", "ankara", "ottoman", "turkish"],
  Africa: ["nigeria", "senegal", "mali", "kenya", "ethiopia", "ghana", "somalia", "morocco", "sudan", "tanzania"],
  "Southeast Asia": ["indonesia", "malaysia", "brunei", "myanmar", "philippines", "thailand", "singapore"],
  Community: ["uk muslim", "france muslim", "germany muslim", "western muslim", "europe muslim", "usa muslim", "canada muslim"],
};

function correctCategory(article: GeneratedArticle, agentCategories: Category[]): Category {
  const text = `${article.title_en} ${article.body_en}`.toLowerCase();
  // Check if keyword-based detection overrides AI's category
  for (const cat of agentCategories) {
    const keywords = CATEGORY_KEYWORDS[cat];
    if (keywords?.some((kw) => text.includes(kw))) {
      return cat;
    }
  }
  // Validate AI's category is in agent's scope
  if ((CATEGORIES as readonly string[]).includes(article.category)) {
    return article.category as Category;
  }
  return agentCategories[0];
}

// ─── Sanitize Urdu Script ──────────────────────────────────────────────────────
function sanitizeUrduScript(text: string, field: string, agentName: string): string {
  const FOREIGN =
    /[一-鿿㐀-䶿　-〿＀-￯ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿЀ-ӿͰ-Ͽ฀-๿豈-﫿]/g;
  const hits = text.match(FOREIGN);
  if (hits && hits.length > 0) {
    const unique = [...new Set(hits)].join('');
    logger.warn(
      { agent: agentName, field, chars: unique, count: hits.length, preview: text.slice(0, 120) },
      "sanitizeUrduScript: foreign script characters stripped from Urdu field",
    );
    return text.replace(FOREIGN, ' ').replace(/  +/g, ' ').trim();
  }
  return text;
}

/** Strip ASCII control chars that break JSON.parse */
function sanitizeJson(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Agent Configuration ──────────────────────────────────────────────────────

interface AgentConfig {
  name: string;
  /** Milliseconds to wait before this agent starts (rate limit buffer) */
  delayBeforeMs: number;
  categories: Category[];
  systemPrompt: string;
  userPrompt: string;
  articleCount: number;
}

const BASE_SAFETY_RULES = `
ABSOLUTE RULES — never violate:
1. NEVER fabricate specific facts, named quotes, exact statistics, or individuals
2. Write general summary style about well-known ongoing situations
3. NEVER invent specific breaking events that did not occur
4. NEVER include sectarian framing, incitement, or defamatory claims
5. Write professionally and neutrally; respect all Muslims regardless of sect or nationality
6. isBreaking: true ONLY for significanceScore >= 9
7. sourceNote: MUST be a real-sounding news agency (e.g. "Al Jazeera", "Dawn News", "Reuters")
8. NEVER mention AI, algorithms, machine learning, or automated generation anywhere in the content
9. NEVER add disclaimers like "as reported by AI", "AI analysis", "this is AI-generated", "based on AI research"
10. Write EXACTLY as a professional human journalist would — factual, confident, authoritative
11. Do NOT write "according to sources", "unverified reports", or any hedging that implies fabrication
12. Every article must read as a legitimate professional news report — no meta-commentary about the content

URDU RULES — PRIMARY GOAL: Write 90%+ in authentic Urdu script (نستعلیق):
- Every sentence must end with Urdu punctuation (۔) and be grammatically complete.
- Write in natural, flowing Urdu that a Pakistani newspaper reader would find easy and pleasant.
- body_ur length: 100-130 Urdu words minimum. Do NOT write short stubs.

URDU VOCABULARY — ALWAYS use these exact Urdu words:
  حکومت (government) · معیشت (economy) · مسجد (mosque) · مدرسہ (madrassa) · علماء (scholars)
  فلسطین (Palestine) · امریکہ (America) · اسرائیل (Israel) · جنگ (war) · امن (peace)
  پاکستان (Pakistan) · بھارت (India) · بنگلہ دیش (Bangladesh) · افغانستان (Afghanistan)
  ترکی (Turkey) · سعودی عرب (Saudi Arabia) · ایران (Iran) · مصر (Egypt)
  نائیجیریا (Nigeria) · اقوام متحدہ (United Nations) · آزادی (freedom) · انصاف (justice)
  تعلیم (education) · صحت (health) · امداد (aid) · پناہ گزین (refugee) · قرارداد (resolution)
  سفارتکاری (diplomacy) · انتخابات (elections) · اتحاد (alliance) · مذاکرات (negotiations)
  بحران (crisis) · خطہ (region) · ترقی (development) · مجلس (council/assembly)

ENGLISH FALLBACK — LAST RESORT ONLY:
- Use English ONLY for highly technical terms with no standard Urdu equivalent.
- NEVER do phonetic transliteration of English (e.g. do NOT write سیزفائر — write جنگ بندی).

URDU SCRIPT ENFORCEMENT — ZERO TOLERANCE:
- FORBIDDEN in title_ur and body_ur: Chinese/CJK, Devanagari/Hindi, Cyrillic, Greek, Bengali, Tamil.
- A single foreign-script character is a CRITICAL failure — remove and rephrase.

ARABIC RULES:
- Clear Modern Standard Arabic (فصحى) with newspaper register. 100-130 words minimum.

OUTPUT FORMAT — CRITICAL:
Return ONLY a valid, COMPLETE JSON array. No markdown fences, no preamble, no explanation.
The array MUST be closed with ] before you stop.
Each object MUST have: title_en, body_en, title_ur, body_ur, title_ar, body_ar,
category, significanceScore (1-10 integer), sourceNote (news agency name), isBreaking (bool), country (optional ISO code)`;

const AGENTS: AgentConfig[] = [
  {
    name: "world_palestine",
    delayBeforeMs: 0,
    categories: ["World", "Palestine"],
    systemPrompt: `You are a senior international journalist specialising in global Islamic affairs and Palestine.
Cover: OIC developments, events affecting Muslim communities, UN resolutions on Palestine,
Gaza humanitarian situation, West Bank settlements, Al-Aqsa Mosque, Muslim diaspora issues.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering World Islamic affairs and Palestine.
Each body 150-200 words per language. Cover different countries.
For sourceNote, use ONE real news agency that would cover this story (e.g. "Al Jazeera", "Reuters", "AFP", "Middle East Eye").
Category "World" for global affairs, "Palestine" for Palestine-specific.`,
    articleCount: 2,
  },
  {
    name: "south_asia",
    delayBeforeMs: 2500,
    categories: ["South Asia"],
    systemPrompt: `You are an expert journalist covering South Asian Muslim affairs.
Cover: Pakistan (politics, economy, security), Bangladesh, India's Muslim minority,
Afghanistan, Kashmir, Rohingya refugees. Governance, economic policies, religious freedom, social issues.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering South Asian Muslim affairs.
Each body 150-200 words per language. Cover different countries (Pakistan, Bangladesh, India, Afghanistan).
For sourceNote, use ONE real South Asian news outlet (e.g. "Dawn News", "GEO News", "ARY News", "BBC Urdu", "Aaj TV", "The Daily Star BD").
Category always "South Asia".`,
    articleCount: 2,
  },
  {
    name: "economy",
    delayBeforeMs: 2500,
    categories: ["Economy"],
    systemPrompt: `You are an Islamic economics and halal finance journalist.
Cover: Islamic banking (sukuk, sharia-compliant finance), halal economy, Saudi Vision 2030,
Gulf financial news, Islamic waqf, zakat funds, halal market growth, OIC economic cooperation.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on the Islamic economy and halal finance.
Each body 150-200 words per language. Cover different countries/topics.
For sourceNote, use ONE real outlet (e.g. "Arab News", "Saudi Gazette", "Gulf News", "Reuters", "Islamic Finance News").
Category always "Economy".`,
    articleCount: 2,
  },
  {
    name: "government",
    delayBeforeMs: 2500,
    categories: ["Government"],
    systemPrompt: `You are an expert journalist covering governance in Muslim-majority countries.
Cover: elections, political transitions, legislation affecting Muslims, foreign policy,
Saudi Arabia, UAE, Turkey, Iran, Pakistan, Malaysia, Indonesia, Egypt, Morocco, Jordan.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on governance in Muslim-majority countries.
Each body 150-200 words per language. Cover different countries.
For sourceNote, use ONE real outlet (e.g. "Al Jazeera", "Reuters", "Anadolu Agency", "TRT World", "Arab News").
Category always "Government".`,
    articleCount: 2,
  },
  {
    name: "security",
    delayBeforeMs: 2500,
    categories: ["Security"],
    systemPrompt: `You are a security analyst and humanitarian journalist covering Muslim-majority regions.
Cover: conflicts, peace processes, humanitarian crises, refugee situations (Syria, Yemen, Rohingya),
Sahel security, Somalia, Libya, Afghan humanitarian situation, earthquake/flood relief.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on security and humanitarian situations.
Each body 150-200 words per language. Cover different regions (Middle East, Africa, Asia).
For sourceNote, use ONE real outlet (e.g. "Reuters", "AP News", "BBC News", "Al Jazeera", "UN News").
Category always "Security".`,
    articleCount: 2,
  },
  {
    name: "scholars_mosques",
    delayBeforeMs: 2500,
    categories: ["Scholars", "Mosques"],
    systemPrompt: `You are an expert covering Islamic scholarship, religious institutions, and sacred sites.
Cover: major fatwas, Islamic conferences, Al-Azhar University, Mecca/Medina developments,
Masjid al-Haram expansions, major mosque construction worldwide, Quran competitions,
prominent Muslim scholars' statements and religious guidance.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on Islamic scholars and mosques.
Each body 150-200 words per language. Mix scholars news with mosque/sacred-sites news.
For sourceNote, use ONE real outlet (e.g. "Saudi Gazette", "Al-Azhar Official", "Muslim World League", "Anadolu Agency").
Category "Scholars" for scholarly news, "Mosques" for mosque/sacred-sites.`,
    articleCount: 2,
  },
  {
    name: "madrassas",
    delayBeforeMs: 2500,
    categories: ["Madrassas"],
    systemPrompt: `You are an expert on Islamic education and madrassas worldwide.
Cover: madrassa reforms in Pakistan, Bangladesh, Egypt, Indonesia, India;
Al-Azhar University, International Islamic Universities, curriculum modernisation,
Islamic education in Western countries, Quran memorisation programs, online Islamic learning.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries on madrassas and Islamic education.
Each body 150-200 words per language. Cover different countries and education levels.
For sourceNote, use ONE real outlet (e.g. "Dawn News", "The News International", "Al-Azhar Official", "Muslim World League").
Category always "Madrassas".`,
    articleCount: 2,
  },
  {
    name: "regional",
    delayBeforeMs: 2500,
    categories: ["Africa", "Southeast Asia", "Turkey", "Community"],
    systemPrompt: `You are a regional expert covering Africa, Southeast Asia, Turkey, and Western Muslim communities.
AFRICA: Nigeria, Senegal, Ethiopia, Kenya, Tanzania, Morocco, Algeria, Tunisia, Somalia, Sudan, Mali, Ghana, Guinea.
SOUTHEAST ASIA: Indonesia, Malaysia, Philippines (Mindanao), Myanmar (Rohingya), Brunei, Thailand, Singapore.
TURKEY: domestic politics, Ottoman heritage, Turkish diaspora, Central Asia.
COMMUNITY: Western Muslims (UK, USA, Canada, France, Germany), Muslim minority rights, halal lifestyle.
${BASE_SAFETY_RULES}`,
    userPrompt: `Generate {count} distinct news summaries covering Africa, Southeast Asia, Turkey, and Muslim communities.
Each body 150-200 words per language. Cover all four regions across your articles.
For sourceNote, use ONE real outlet appropriate to the region.
CRITICAL — Category assignment:
- "Africa" → African countries ONLY (Nigeria, Kenya, Senegal, Ethiopia, Tanzania, Morocco, Somalia, Sudan)
- "Southeast Asia" → Indonesia, Malaysia, Philippines, Myanmar, Brunei, Thailand ONLY
- "Turkey" → Turkey/Türkiye, Turkish politics, Ottoman history ONLY
- "Community" → Western Muslim communities (UK, USA, Canada, France, Germany, Europe) ONLY`,
    articleCount: 2,
  },
];

// ─── Article Generator ────────────────────────────────────────────────────────

async function generateAgentArticlesSafe(
  agent: AgentConfig
): Promise<GeneratedArticle[]> {
  const gemini = getGeminiClient();
  const model = gemini.getGenerativeModel({
    model: "gemini-2.0-flash-lite",
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 4500,
    },
  });

  const userPrompt = agent.userPrompt.replace("{count}", String(agent.articleCount));
  const fullPrompt = `${agent.systemPrompt}\n\n${userPrompt}`;

  const result = await model.generateContent(fullPrompt);
  const raw = result.response.text();
  if (!raw) throw new Error("Empty response from Gemini");

  const content = sanitizeJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try to extract the JSON array even if there's surrounding text/markdown
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in Gemini response");
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
      const correctedCategory = correctCategory(a, agent.categories);

      // Use AI's sourceNote if it looks like a real news agency, otherwise pick one
      const sourceNote = (typeof a.sourceNote === "string" && a.sourceNote.length > 3 && a.sourceNote.length < 80)
        ? a.sourceNote
        : getSourceForCategory(correctedCategory);

      const mapped: GeneratedArticle = {
        ...a,
        title_ur: sanitizeUrduScript(
          typeof a.title_ur === "string" ? a.title_ur : a.title_en,
          "title_ur", agent.name,
        ),
        body_ur: sanitizeUrduScript(
          typeof a.body_ur === "string" ? a.body_ur : a.body_en,
          "body_ur", agent.name,
        ),
        title_ar: typeof a.title_ar === "string" ? a.title_ar : a.title_en,
        body_ar: typeof a.body_ar === "string" ? a.body_ar : a.body_en,
        sourceNote,
        category: correctedCategory,
        significanceScore: Math.min(10, Math.max(1, Math.round(Number(a.significanceScore) || 5))),
        isBreaking: Boolean(a.isBreaking) && (a.significanceScore >= 9),
      };
      return mapped;
    });
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/** Total number of agents available for rotation */
export const AGENT_COUNT = AGENTS.length;

/**
 * Run a SINGLE agent by index (0 to AGENT_COUNT-1) and return its articles.
 * Used by the rotating 5-minute scheduler.
 */
export async function generateSingleAgentArticles(agentIndex: number): Promise<GeneratedArticle[]> {
  const agent = AGENTS[agentIndex % AGENTS.length];
  if (!agent) {
    throw new Error(\`Invalid agent index: \${agentIndex}\`);
  }
  logger.info({ agent: agent.name, agentIndex }, "Single agent starting");
  const articles = await generateAgentArticlesSafe(agent);
  logger.info({ agent: agent.name, count: articles.length }, "Single agent completed");
  return articles;
}

/**
 * Run all 8 specialized agents to generate Islamic news articles.
 * Uses Gemini 2.0 Flash Lite (cheapest Gemini model — nearly free).
 * Kept for the manual admin trigger endpoint.
 */
export async function generateNewsArticles(): Promise<GeneratedArticle[]> {
  logger.info(
    { agentCount: AGENTS.length, model: "gemini-2.0-flash-lite" },
    "Starting multi-agent news generation — Gemini"
  );

  const all: GeneratedArticle[] = [];

  for (const agent of AGENTS) {
    if (agent.delayBeforeMs > 0) {
      logger.info(
        { agent: agent.name, delayMs: agent.delayBeforeMs },
        "Rate-limit buffer — waiting before next agent"
      );
      await sleep(agent.delayBeforeMs);
    }

    try {
      logger.info({ agent: agent.name }, "Agent starting");
      const articles = await generateAgentArticlesSafe(agent);
      logger.info({ agent: agent.name, count: articles.length }, "Agent completed");
      all.push(...articles);
    } catch (err) {
      logger.error({ err, agent: agent.name }, "Agent failed — skipping");
    }
  }

  logger.info({ total: all.length }, "All agents finished");
  return all;
}
