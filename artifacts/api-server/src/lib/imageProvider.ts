/**
 * Swappable image provider module.
 *
 * Uses the Pexels API (free tier: 200 req/hour, 20,000/month).
 * No billing required — free key from pexels.com/api.
 *
 * To swap providers later, replace the body of `fetchImage`.
 * The interface stays the same: fetchImage(article) → { url, attribution } | null
 *
 * DEDUPLICATION: Tracks the last 20 used image URLs in memory and skips
 * already-used ones when Pexels returns repeats. Fetches up to 5 candidates
 * per query so there's a pool to pick from.
 *
 * QUERY STRATEGY: Extracts the most specific nouns from the English headline
 * (dropping stop words) then appends a relevant visual anchor word so Pexels
 * returns Islamic-context imagery rather than generic results.
 */

import { logger } from "./logger";

export interface ImageArticleContext {
  /** English headline — used to extract specific search keywords */
  titleEn: string;
  /** Article category — used as a fallback keyword anchor */
  category: string;
}

export interface ImageResult {
  url: string;
  attribution: string;
}

// ---------------------------------------------------------------------------
// Deduplication — rolling window of the last RECENT_MAX image URLs used
// ---------------------------------------------------------------------------
const RECENT_MAX = 20;
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
// Keyword extraction from headline
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

/** Visual anchor words mapped from category — ensures Pexels returns Islamic imagery */
const CATEGORY_ANCHORS: Record<string, string> = {
  Palestine:   "Palestine mosque",
  World:       "Islamic architecture",
  "South Asia":"mosque Islamic",
  Scholars:    "Islamic scholars mosque",
  Community:   "Muslim community",
};

function buildSearchQuery(titleEn: string, category: string): string {
  const words = titleEn
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Take up to 4 of the most specific words from the headline
  const keywords = words.slice(0, 4);

  // Append the category visual anchor if it's not already well-represented
  const anchor = CATEGORY_ANCHORS[category] ?? "mosque Islamic";
  const anchorWords = anchor.toLowerCase().split(" ");
  const alreadyCovered = anchorWords.every((aw) =>
    keywords.some((k) => k.startsWith(aw.slice(0, 4))),
  );
  if (!alreadyCovered) {
    keywords.push(anchor);
  }

  return keywords.join(" ");
}

// ---------------------------------------------------------------------------
// Pexels fetch helpers
// ---------------------------------------------------------------------------
interface PexelsPhoto {
  src: { large: string; medium: string };
  photographer: string;
  photographer_url: string;
}

interface PexelsResponse {
  photos?: PexelsPhoto[];
  total_results?: number;
}

async function searchPexels(
  apiKey: string,
  query: string,
  perPage = 5,
): Promise<PexelsResponse | null> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  try {
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      logger.error(
        { status: res.status, body, query },
        "imageProvider: Pexels request failed",
      );
      return null;
    }
    return (await res.json()) as PexelsResponse;
  } catch (err) {
    logger.error({ err, query }, "imageProvider: unexpected error fetching from Pexels");
    return null;
  }
}

/** Pick the first photo whose URL hasn't been used recently. */
function pickFreshPhoto(photos: PexelsPhoto[]): PexelsPhoto | null {
  for (const photo of photos) {
    if (!recentlyUsedUrls.has(photo.src.large)) return photo;
  }
  return null; // all 5 are repeats — caller will try a broader query
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a relevant, deduplicated image for a news article.
 * Returns null if no image is found or PEXELS_API_KEY is not set.
 */
export async function fetchImage(
  article: ImageArticleContext,
): Promise<ImageResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    logger.warn("imageProvider: PEXELS_API_KEY not set — image fetching disabled");
    return null;
  }

  const query = buildSearchQuery(article.titleEn, article.category);
  logger.debug({ query, title: article.titleEn }, "imageProvider: built search query");

  // --- Primary query: headline keywords + category anchor, 5 candidates ---
  const primary = await searchPexels(apiKey, query, 5);
  if (primary?.photos?.length) {
    logger.debug(
      { totalResults: primary.total_results, query },
      "imageProvider: Pexels total_results for query",
    );
    const pick = pickFreshPhoto(primary.photos);
    if (pick) {
      markUsed(pick.src.large);
      return { url: pick.src.large, attribution: `Photo by ${pick.photographer} on Pexels` };
    }
    logger.debug({ query }, "imageProvider: all 5 primary results already used, trying broader query");
  }

  // --- Broader fallback: just category anchor + "Islamic" ---
  const fallbackQuery = (CATEGORY_ANCHORS[article.category] ?? "mosque") + " Islamic";
  if (fallbackQuery !== query) {
    const fallback = await searchPexels(apiKey, fallbackQuery, 10);
    if (fallback?.photos?.length) {
      const pick = pickFreshPhoto(fallback.photos);
      if (pick) {
        markUsed(pick.src.large);
        return { url: pick.src.large, attribution: `Photo by ${pick.photographer} on Pexels` };
      }
    }
  }

  // --- Last resort: generic "mosque" pool, 10 results ---
  const generic = await searchPexels(apiKey, "mosque architecture", 10);
  if (generic?.photos?.length) {
    const pick = pickFreshPhoto(generic.photos);
    if (pick) {
      markUsed(pick.src.large);
      return { url: pick.src.large, attribution: `Photo by ${pick.photographer} on Pexels` };
    }
  }

  logger.warn(
    { title: article.titleEn },
    "imageProvider: exhausted all query tiers, returning null",
  );
  return null;
}
