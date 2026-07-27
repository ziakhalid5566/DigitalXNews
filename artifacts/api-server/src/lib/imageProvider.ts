/**
 * Image provider — Pexels Photos API
 *
 * Uses PEXELS_API_KEY (set in environment / GitHub secrets / Supabase secrets).
 * Free quota: 200 req/hr, 20,000 req/month — ample for news generation.
 *
 * DEDUPLICATION: Rolling window of last 40 used URLs to avoid repeats per run.
 * QUERY STRATEGY: Extracts nouns from English headline + per-category anchor.
 */

import { logger } from "./logger";

export interface ImageArticleContext {
  titleEn: string;
  category: string;
}

export interface ImageResult {
  url: string;
  attribution: string;
}

// ─── Deduplication ────────────────────────────────────────────────────────────
const RECENT_MAX = 40;
const recentlyUsedUrls = new Set<string>();
const recentlyUsedQueue: string[] = [];

function markUsed(url: string): void {
  if (recentlyUsedUrls.has(url)) return;
  recentlyUsedUrls.add(url);
  recentlyUsedQueue.push(url);
  if (recentlyUsedQueue.length > RECENT_MAX) {
    const evicted = recentlyUsedQueue.shift()!;
    recentlyUsedUrls.delete(evicted);
  }
}

// ─── Stop words ───────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the","a","an","in","of","for","by","to","at","is","are","was","were",
  "has","have","had","on","with","from","and","or","but","not","as","its",
  "be","been","that","this","their","it","will","amid","after","over","new",
  "more","calls","marks","hosts","holds","opens","set","gets","faces","makes",
  "draws","sees","urges","joins","says","two","three","four","five","first",
  "last","next","into","onto","upon","about","between","among","across",
  "during","within","against","toward","while","than","such","own","other",
  "major","key","top","wide","high","low","large","small","great","local",
  "global","national","international","annual","monthly","weekly","daily",
]);

// ─── Category anchors ─────────────────────────────────────────────────────────
const CATEGORY_ANCHORS: Record<string, string> = {
  Palestine:          "Palestine mosque Gaza",
  World:              "Islamic architecture mosque",
  "South Asia":       "Pakistan mosque Islamic",
  Scholars:           "Islamic scholar lecture",
  Community:          "Muslim community gathering",
  Economy:            "Islamic banking business",
  Government:         "parliament government",
  Security:           "humanitarian conflict",
  Mosques:            "grand mosque mecca medina",
  Madrassas:          "Islamic school students",
  Africa:             "Africa mosque Islamic",
  "Southeast Asia":   "Indonesia Malaysia mosque",
  Turkey:             "Istanbul mosque Turkey",
};

function buildSearchQuery(titleEn: string, category: string): string {
  const words = titleEn
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const keywords = words.slice(0, 4);
  const anchor = CATEGORY_ANCHORS[category] ?? "mosque Islamic";
  // Append anchor if its first word isn't already covered
  const firstAnchorWord = anchor.split(" ")[0].toLowerCase();
  if (!keywords.some((k) => k.startsWith(firstAnchorWord.slice(0, 4)))) {
    keywords.push(anchor);
  }
  return keywords.join(" ");
}

// ─── Pexels API types ─────────────────────────────────────────────────────────
interface PexelsPhoto {
  id: number;
  url: string;
  photographer: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
}

interface PexelsSearchResponse {
  photos?: PexelsPhoto[];
  error?: string;
}

async function searchPexels(
  apiKey: string,
  query: string,
  perPage = 10,
): Promise<PexelsPhoto[]> {
  const url =
    `https://api.pexels.com/v1/search` +
    `?query=${encodeURIComponent(query)}` +
    `&per_page=${perPage}` +
    `&orientation=landscape`;
  try {
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) {
      logger.error({ status: res.status, query }, "imageProvider: Pexels request failed");
      return [];
    }
    const json = (await res.json()) as PexelsSearchResponse;
    if (json.error) {
      logger.error({ error: json.error, query }, "imageProvider: Pexels API error");
      return [];
    }
    return json.photos ?? [];
  } catch (err) {
    logger.error({ err, query }, "imageProvider: unexpected Pexels error");
    return [];
  }
}

function pickFreshPhoto(photos: PexelsPhoto[]): PexelsPhoto | null {
  for (const photo of photos) {
    const url = photo.src.large2x || photo.src.large || photo.src.medium;
    if (!url) continue;
    if (recentlyUsedUrls.has(url)) continue;
    return photo;
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function fetchImage(
  article: ImageArticleContext,
): Promise<ImageResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;

  if (!apiKey) {
    logger.warn("imageProvider: PEXELS_API_KEY not set — image fetching disabled");
    return null;
  }

  const query = buildSearchQuery(article.titleEn, article.category);
  logger.debug({ query, title: article.titleEn }, "imageProvider: built Pexels query");

  // Primary: headline keywords + category anchor
  const primary = await searchPexels(apiKey, query, 10);
  const pick1 = pickFreshPhoto(primary);
  if (pick1) {
    const url = pick1.src.large2x || pick1.src.large || pick1.src.medium;
    markUsed(url);
    logger.debug({ url, query }, "imageProvider: primary photo found");
    return { url, attribution: `Photo by ${pick1.photographer} on Pexels` };
  }

  // Fallback: category anchor only
  const anchor = CATEGORY_ANCHORS[article.category] ?? "mosque Islamic architecture";
  if (anchor !== query) {
    const fallback = await searchPexels(apiKey, anchor, 10);
    const pick2 = pickFreshPhoto(fallback);
    if (pick2) {
      const url = pick2.src.large2x || pick2.src.large || pick2.src.medium;
      markUsed(url);
      return { url, attribution: `Photo by ${pick2.photographer} on Pexels` };
    }
  }

  // Last resort: generic
  const generic = await searchPexels(apiKey, "mosque Islamic architecture beautiful", 10);
  const pick3 = pickFreshPhoto(generic);
  if (pick3) {
    const url = pick3.src.large2x || pick3.src.large || pick3.src.medium;
    markUsed(url);
    return { url, attribution: `Photo by ${pick3.photographer} on Pexels` };
  }

  logger.warn({ title: article.titleEn }, "imageProvider: all queries exhausted, returning null");
  return null;
}
