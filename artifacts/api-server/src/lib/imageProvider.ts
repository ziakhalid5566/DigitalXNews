/**
 * Image provider — Google Custom Search Images
 *
 * Uses GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID (already in GitHub secrets).
 * Free quota: 100 queries/day. Sufficient for news generation jobs.
 *
 * DEDUPLICATION: Tracks last 40 used URLs to avoid repeats in a single run.
 * QUERY STRATEGY: Extracts specific nouns from English headline + category anchor.
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

// ---------------------------------------------------------------------------
// Deduplication — rolling window
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Stop words for query extraction
// ---------------------------------------------------------------------------
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

/** Category-specific visual anchor keywords for better image relevance */
const CATEGORY_ANCHORS: Record<string, string> = {
  Palestine:          "Palestine mosque Gaza",
  World:              "Islamic architecture mosque",
  "South Asia":       "Pakistan mosque Islamic",
  Scholars:           "Islamic scholar mosque university",
  Community:          "Muslim community mosque",
  Economy:            "Islamic banking finance",
  Government:         "parliament government building",
  Security:           "humanitarian relief conflict",
  Mosques:            "grand mosque mecca medina",
  Madrassas:          "Islamic school education students",
  Africa:             "Africa mosque Islamic",
  "Southeast Asia":   "Indonesia Malaysia mosque",
  Turkey:             "Turkey Istanbul mosque",
};

function buildSearchQuery(titleEn: string, category: string): string {
  const words = titleEn
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const keywords = words.slice(0, 4);
  const anchor = CATEGORY_ANCHORS[category] ?? "mosque Islamic";
  const anchorWords = anchor.toLowerCase().split(" ");
  const alreadyCovered = anchorWords.every((aw) =>
    keywords.some((k) => k.startsWith(aw.slice(0, 4))),
  );
  if (!alreadyCovered) keywords.push(anchor);

  return keywords.join(" ");
}

// ---------------------------------------------------------------------------
// Google Custom Search fetch helpers
// ---------------------------------------------------------------------------
interface GoogleImageItem {
  link: string;
  title: string;
  displayLink: string;
  image?: {
    thumbnailLink?: string;
    contextLink?: string;
  };
}

interface GoogleSearchResponse {
  items?: GoogleImageItem[];
  error?: { code: number; message: string };
}

async function searchGoogleImages(
  apiKey: string,
  searchEngineId: string,
  query: string,
  num = 10,
): Promise<GoogleSearchResponse | null> {
  const safeNum = Math.min(num, 10); // Google max is 10 per request
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(searchEngineId)}` +
    `&q=${encodeURIComponent(query)}` +
    `&searchType=image` +
    `&num=${safeNum}` +
    `&imgSize=large` +
    `&imgType=photo` +
    `&safe=active`;

  try {
    const res = await fetch(url);
    const json = (await res.json()) as GoogleSearchResponse;
    if (!res.ok || json.error) {
      logger.error(
        { status: res.status, error: json.error, query },
        "imageProvider: Google Search request failed",
      );
      return null;
    }
    return json;
  } catch (err) {
    logger.error({ err, query }, "imageProvider: unexpected error from Google Search");
    return null;
  }
}

/** Pick the first image URL not recently used and ensure it's a valid https image */
function pickFreshImage(items: GoogleImageItem[]): GoogleImageItem | null {
  for (const item of items) {
    const url = item.link;
    if (!url) continue;
    if (!url.startsWith("https://")) continue;
    // Skip SVGs and tiny images, prefer jpg/png/webp
    if (url.includes(".svg")) continue;
    if (recentlyUsedUrls.has(url)) continue;
    return item;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a relevant, deduplicated image for a news article via Google Custom Search.
 * Returns null if API keys are not set or no suitable image is found.
 */
export async function fetchImage(
  article: ImageArticleContext,
): Promise<ImageResult | null> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    logger.warn(
      "imageProvider: GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID not set — image fetching disabled",
    );
    return null;
  }

  const query = buildSearchQuery(article.titleEn, article.category);
  logger.debug({ query, title: article.titleEn }, "imageProvider: built search query");

  // --- Primary query: headline keywords + category anchor ---
  const primary = await searchGoogleImages(apiKey, searchEngineId, query, 10);
  if (primary?.items?.length) {
    const pick = pickFreshImage(primary.items);
    if (pick) {
      markUsed(pick.link);
      logger.debug({ url: pick.link, query }, "imageProvider: primary image found");
      return {
        url: pick.link,
        attribution: `Image: ${pick.displayLink}`,
      };
    }
    logger.debug({ query }, "imageProvider: all primary results used, trying broader query");
  }

  // --- Broader fallback: just category anchor ---
  const fallbackQuery = CATEGORY_ANCHORS[article.category] ?? "mosque Islamic architecture";
  if (fallbackQuery !== query) {
    const fallback = await searchGoogleImages(apiKey, searchEngineId, fallbackQuery, 10);
    if (fallback?.items?.length) {
      const pick = pickFreshImage(fallback.items);
      if (pick) {
        markUsed(pick.link);
        return { url: pick.link, attribution: `Image: ${pick.displayLink}` };
      }
    }
  }

  // --- Last resort: generic Islamic architecture ---
  const generic = await searchGoogleImages(apiKey, searchEngineId, "mosque Islamic architecture beautiful", 10);
  if (generic?.items?.length) {
    const pick = pickFreshImage(generic.items);
    if (pick) {
      markUsed(pick.link);
      return { url: pick.link, attribution: `Image: ${pick.displayLink}` };
    }
  }

  logger.warn({ title: article.titleEn }, "imageProvider: exhausted all query tiers, returning null");
  return null;
}
