/**
 * News Generation Job
 *
 * Orchestrates the multi-agent news generation pipeline:
 * 1. Runs all 8 Gemini AI agents
 * 2. Content moderation
 * 3. Image fetching via Pexels for all articles
 * 4. Database insertion (Drizzle → Supabase PostgreSQL)
 * 5. Push notifications via Expo Push Service
 *
 * Push token source: Supabase REST API (service role key).
 * Tokens are stored by the Expo mobile app directly into Supabase.
 * Using the REST API avoids needing a direct DB password.
 */

import { db } from "@workspace/db";
import { postsTable, flaggedPostsTable } from "@workspace/db";
import { generateNewsArticles, generateSingleAgentArticles, AGENT_COUNT } from "../lib/newsGenerator";
import { moderateContent } from "../lib/contentModeration";
import { fetchImage } from "../lib/imageProvider";
import { sendPushNotifications } from "../lib/pushNotifications";
import { logger } from "../lib/logger";

// Re-export for the scheduler
export { AGENT_COUNT } from "../lib/newsGenerator";

// Daily image budget — Pexels free tier: 20,000/month → ~600/day safe
const DAILY_IMAGE_BUDGET = 580;
const IMAGE_SCORE_THRESHOLD = 1;
// 24-hour TTL for all posts
const POST_TTL_MS = 24 * 60 * 60 * 1000;

// Categories that always trigger push notifications to all users
const ALWAYS_NOTIFY_CATEGORIES = new Set([
  "Security",
  "Government",
  "Mosques",
  "Madrassas",
  "Palestine",
]);

let dailyImageCount = 0;
let imageCountDate = new Date().toDateString();

function resetDailyCountIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== imageCountDate) {
    dailyImageCount = 0;
    imageCountDate = today;
    logger.info("Daily image count reset for new UTC day");
  }
}

// ── Supabase push-token fetcher ────────────────────────────────────────────────
// The Expo app saves push tokens directly to Supabase via the JS SDK.
// We read them here using the service role key so we can reach ALL users,
// regardless of which PostgreSQL the Drizzle DB instance points to.

interface SupabasePref {
  push_token: string | null;
  notifications_enabled: boolean;
  followed_categories: string[] | null;
}

async function fetchPushTokensFromSupabase(
  category: string,
  isBreaking: boolean,
): Promise<string[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    logger.warn(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping push notifications",
    );
    return [];
  }

  try {
    const url =
      `${supabaseUrl}/rest/v1/user_preferences` +
      `?select=push_token,notifications_enabled,followed_categories` +
      `&notifications_enabled=eq.true` +
      `&push_token=not.is.null`;

    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Supabase push token fetch failed");
      return [];
    }

    const rows: SupabasePref[] = (await res.json()) as SupabasePref[];

    const tokens = rows
      .filter((p) => {
        if (!p.push_token) return false;
        if (isBreaking || ALWAYS_NOTIFY_CATEGORIES.has(category)) return true;
        const cats = p.followed_categories ?? [];
        if (cats.length === 0) return true;
        return cats.includes(category);
      })
      .map((p) => p.push_token as string);

    logger.info(
      { total: rows.length, eligible: tokens.length, category, isBreaking },
      "Push tokens fetched from Supabase",
    );

    return tokens;
  } catch (err) {
    logger.error({ err }, "Error fetching push tokens from Supabase");
    return [];
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runNewsGenerationJob(): Promise<void> {
  logger.info("News generation job: starting (Gemini multi-agent)");

  try {
    const articles = await generateNewsArticles();
    if (articles.length === 0) {
      logger.warn("News generation job: no articles returned from any agent");
      return;
    }

    logger.info({ count: articles.length }, "News generation job: articles generated");
    resetDailyCountIfNeeded();

    // Sort by significance descending — highest-scored articles get images first
    const sorted = [...articles].sort((a, b) => b.significanceScore - a.significanceScore);

    let published = 0;
    let flagged = 0;

    for (const article of sorted) {
      // Content moderation — checks English title + body
      const mod = moderateContent(article.title_en, article.body_en);

      if (mod.flagged) {
        await db.insert(flaggedPostsTable).values({
          title: article.title_en,
          body: article.body_en,
          category: article.category,
          significanceScore: article.significanceScore,
          sourceNote: article.sourceNote,
          flagReason: mod.reason ?? "Flagged by automated content filter",
        });
        logger.warn(
          { title: article.title_en, reason: mod.reason },
          "Article queued for moderation review",
        );
        flagged++;
        continue;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + POST_TTL_MS);

      // Image fetching — Pexels API
      let imageUrl: string | null = null;
      let hasImage = false;

      const eligible =
        dailyImageCount < DAILY_IMAGE_BUDGET &&
        article.significanceScore >= IMAGE_SCORE_THRESHOLD;

      if (eligible) {
        const img = await fetchImage({
          titleEn: article.title_en,
          category: article.category,
        });
        if (img) {
          imageUrl = img.url;
          hasImage = true;
          dailyImageCount++;
        } else {
          logger.warn(
            { title: article.title_en, score: article.significanceScore },
            "Image fetch returned null for eligible article",
          );
        }
      }

      const [post] = await db
        .insert(postsTable)
        .values({
          title: article.title_en,
          body: article.body_en,
          category: article.category,
          imageUrl,
          hasImage,
          significanceScore: article.significanceScore,
          sourceNote: article.sourceNote,
          publishedAt: now,
          expiresAt,
          isBreaking: article.isBreaking,
          titleEn: article.title_en,
          bodyEn: article.body_en,
          titleUr: article.title_ur,
          bodyUr: article.body_ur,
          titleAr: article.title_ar,
          bodyAr: article.body_ar,
        })
        .returning();

      published++;
      logger.info(
        { postId: post.id, category: post.category, score: post.significanceScore, hasImage },
        "Post published",
      );

      // Decide whether to push-notify for this article
      const shouldNotify =
        post.isBreaking ||
        ALWAYS_NOTIFY_CATEGORIES.has(post.category) ||
        post.significanceScore >= 8;

      if (shouldNotify) {
        await notifySubscribers(
          post.id,
          post.title,
          post.body ?? "",
          post.category,
          post.isBreaking ?? false,
          post.titleUr ?? undefined,
          post.bodyUr ?? undefined,
        );
      }
    }

    logger.info({ published, flagged }, "News generation job: completed");
  } catch (err) {
    logger.error({ err }, "News generation job: failed");
  }
}

async function notifySubscribers(
  postId: string,
  title: string,
  body: string,
  category: string,
  isBreaking: boolean,
  titleUr?: string,
  bodyUr?: string,
): Promise<void> {
  try {
    // Fetch tokens from Supabase (where the mobile app stores them)
    const tokens = await fetchPushTokensFromSupabase(category, isBreaking);

    if (tokens.length === 0) {
      logger.info({ category, isBreaking }, "No eligible push tokens — skipping notification");
      return;
    }

    // Prefer Urdu for notification display
    const displayTitle = titleUr?.trim() ? titleUr : title;
    const displayBody = bodyUr?.trim() ? bodyUr : body;

    // Category prefix emoji
    const prefix = isBreaking
      ? "🔴 بریکنگ:"
      : category === "Security"
        ? "🛡️ سیکیورٹی:"
        : category === "Government"
          ? "🏛️ حکومت:"
          : category === "Mosques"
            ? "🕌 مساجد:"
            : category === "Madrassas"
              ? "🎓 مدارس:"
              : category === "Palestine"
                ? "🇵🇸 فلسطین:"
                : "📰";

    const notifTitle = `${prefix} ${displayTitle}`;
    const notifBody =
      displayBody.substring(0, 120) + (displayBody.length > 120 ? "…" : "");

    await sendPushNotifications(tokens, notifTitle, notifBody, { postId });
    logger.info(
      { tokenCount: tokens.length, category, isBreaking },
      "Push notifications sent",
    );
  } catch (err) {
    logger.error({ err }, "Failed to send push notifications for post");
  }
}

/**
 * Run ONE specific agent (by index 0-7) and publish its articles.
 * Called by the rotating 5-minute scheduler.
 */
export async function runSingleAgentJob(agentIndex: number): Promise<void> {
  logger.info({ agentIndex }, "Single-agent job: starting");
  try {
    const articles = await generateSingleAgentArticles(agentIndex);
    if (articles.length === 0) {
      logger.warn({ agentIndex }, "Single-agent job: no articles generated");
      return;
    }

    resetDailyCountIfNeeded();
    const now = new Date();
    let published = 0;
    let flagged = 0;

    for (const article of articles) {
      // Content moderation
      const mod = moderateContent(article.title_en, article.body_en);
      if (mod.flagged) {
        await db.insert(flaggedPostsTable).values({
          title: article.title_en,
          body: article.body_en,
          category: article.category,
          significanceScore: article.significanceScore,
          sourceNote: article.sourceNote,
          flagReason: mod.reason ?? "Content moderation",
          flaggedAt: now,
        });
        flagged++;
        logger.warn({ title: article.title_en, reason: mod.reason }, "Article flagged");
        continue;
      }

      // Image fetch
      let imageUrl: string | null = null;
      let hasImage = false;
      resetDailyCountIfNeeded();
      if (dailyImageCount < DAILY_IMAGE_BUDGET && article.significanceScore >= IMAGE_SCORE_THRESHOLD) {
        const img = await fetchImage(article.title_en, article.category);
        if (img) {
          imageUrl = img;
          hasImage = true;
          dailyImageCount++;
        }
      }

      const expiresAt = new Date(now.getTime() + POST_TTL_MS);
      const [post] = await db
        .insert(postsTable)
        .values({
          title: article.title_en,
          body: article.body_en,
          category: article.category,
          imageUrl,
          hasImage,
          significanceScore: article.significanceScore,
          sourceNote: article.sourceNote,
          publishedAt: now,
          expiresAt,
          isBreaking: article.isBreaking,
          titleEn: article.title_en,
          bodyEn: article.body_en,
          titleUr: article.title_ur,
          bodyUr: article.body_ur,
          titleAr: article.title_ar,
          bodyAr: article.body_ar,
        })
        .returning();

      published++;
      logger.info({ postId: post.id, category: post.category, agentIndex, hasImage }, "Post published");

      const shouldNotify =
        post.isBreaking ||
        ALWAYS_NOTIFY_CATEGORIES.has(post.category) ||
        post.significanceScore >= 8;

      if (shouldNotify) {
        await notifySubscribers(
          post.id,
          post.title,
          post.body ?? "",
          post.category,
          post.isBreaking ?? false,
          post.titleUr ?? undefined,
          post.bodyUr ?? undefined,
        );
      }
    }

    logger.info({ agentIndex, published, flagged }, "Single-agent job: completed");
  } catch (err) {
    logger.error({ err, agentIndex }, "Single-agent job: failed");
  }
}
