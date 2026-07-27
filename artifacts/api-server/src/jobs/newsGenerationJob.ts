/**
 * News Generation Job
 *
 * Orchestrates the multi-agent news generation pipeline:
 * 1. Runs all 8 Gemini AI agents
 * 2. Content moderation
 * 3. Image fetching via Pexels for all articles
 * 4. Database insertion
 * 5. Push notifications for:
 *    - Breaking news → ALL users
 *    - Security, Government, Mosques, Madrassas → all users with notifications enabled
 *    - High significance (score >= 8) → all users with notifications enabled
 */

import { db } from "@workspace/db";
import { postsTable, flaggedPostsTable, userPreferencesTable } from "@workspace/db";
import { generateNewsArticles } from "../lib/newsGenerator";
import { moderateContent } from "../lib/contentModeration";
import { fetchImage } from "../lib/imageProvider";
import { sendPushNotifications } from "../lib/pushNotifications";
import { logger } from "../lib/logger";
import { eq } from "drizzle-orm";

// Daily image budget — Pexels free tier: 20,000/month → 600/day safe
const DAILY_IMAGE_BUDGET = 580;
// Fetch images for ALL articles
const IMAGE_SCORE_THRESHOLD = 1;
// 72-hour TTL for all posts
const POST_TTL_MS = 72 * 60 * 60 * 1000;

// Categories that always trigger push notifications to all users
const ALWAYS_NOTIFY_CATEGORIES = new Set(["Security", "Government", "Mosques", "Madrassas", "Palestine"]);

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
      // Run content moderation using English title + body
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

      // ── Push notification logic ────────────────────────────────────────────
      // Send notifications for:
      //   • Breaking news → all users with notifications enabled
      //   • Security / Government / Mosques / Madrassas / Palestine → all users
      //   • High significance (>=8) → all users
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
    const prefs = await db
      .select()
      .from(userPreferencesTable)
      .where(eq(userPreferencesTable.notificationsEnabled, true));

    const tokens = prefs
      .filter((p) => {
        if (!p.pushToken) return false;
        // Breaking news OR always-notify categories → notify EVERYONE with notifications on
        if (isBreaking || ALWAYS_NOTIFY_CATEGORIES.has(category)) return true;
        // Other categories: respect followed_categories (empty means "all")
        if (p.followedCategories.length === 0) return true;
        return p.followedCategories.includes(category);
      })
      .map((p) => p.pushToken as string);

    if (tokens.length === 0) return;

    // Prefer Urdu for notification title/body
    const displayTitle = (titleUr && titleUr.trim()) ? titleUr : title;
    const displayBody  = (bodyUr  && bodyUr.trim())  ? bodyUr  : body;

    // Category-specific notification prefix
    const prefix = isBreaking
      ? "🔴 بریکنگ:"
      : category === "Security" ? "🛡️ سیکیورٹی:"
      : category === "Government" ? "🏛️ حکومت:"
      : category === "Mosques" ? "🕌 مساجد:"
      : category === "Madrassas" ? "🎓 مدارس:"
      : category === "Palestine" ? "🇵🇸 فلسطین:"
      : "📰";

    const notifTitle = `${prefix} ${displayTitle}`;
    const notifBody = displayBody.substring(0, 120) + (displayBody.length > 120 ? "…" : "");

    await sendPushNotifications(tokens, notifTitle, notifBody, { postId });
    logger.info({ tokenCount: tokens.length, category, isBreaking }, "Push notifications sent");
  } catch (err) {
    logger.error({ err }, "Failed to send push notifications for post");
  }
}
