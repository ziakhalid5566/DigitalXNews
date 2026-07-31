/**
 * News Generation Job
 *
 * Orchestrates the multi-agent news generation pipeline:
 * 1. Runs all 8 Gemini AI agents
 * 2. Content moderation
 * 3. Image fetching via Pexels for all articles
 * 4. Database insertion (Drizzle → Supabase PostgreSQL)
 * 5. Push notifications via Expo Push Service (per-user language)
 *
 * Push notifications are sent in the user's preferred language
 * (stored in user_preferences.preferred_language).
 */

import { db, userPreferencesTable } from "@workspace/db";
import { isNotNull, and } from "drizzle-orm";
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

// ── Push-token fetcher with language preference ────────────────────────────────
interface TokenWithLang {
  token: string;
  language: string; // "ur" | "ar" | "en"
}

async function fetchTokensWithLanguage(
  category: string,
  isBreaking: boolean,
): Promise<TokenWithLang[]> {
  try {
    const rows = await db
      .select({
        pushToken: userPreferencesTable.pushToken,
        notificationsEnabled: userPreferencesTable.notificationsEnabled,
        followedCategories: userPreferencesTable.followedCategories,
        preferredLanguage: userPreferencesTable.preferredLanguage,
      })
      .from(userPreferencesTable)
      .where(
        and(
          isNotNull(userPreferencesTable.pushToken),
        )
      );

    const eligible: TokenWithLang[] = rows
      .filter((p) => {
        if (!p.pushToken) return false;
        if (!p.notificationsEnabled) return false;
        if (isBreaking || ALWAYS_NOTIFY_CATEGORIES.has(category)) return true;
        const cats = (p.followedCategories as string[] | null) ?? [];
        if (cats.length === 0) return true;
        return cats.includes(category);
      })
      .map((p) => ({
        token: p.pushToken as string,
        language: (p.preferredLanguage as string | null) ?? "ur",
      }));

    logger.info(
      { total: rows.length, eligible: eligible.length, category, isBreaking },
      "Push tokens fetched",
    );

    return eligible;
  } catch (err) {
    logger.error({ err }, "Error fetching push tokens");
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

    const sorted = [...articles].sort((a, b) => b.significanceScore - a.significanceScore);

    let published = 0;
    let flagged = 0;

    for (const article of sorted) {
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

      const shouldNotify =
        post.isBreaking ||
        ALWAYS_NOTIFY_CATEGORIES.has(post.category) ||
        post.significanceScore >= 8;

      if (shouldNotify) {
        await notifySubscribers(
          post.id,
          post.category,
          post.isBreaking ?? false,
          {
            en: { title: post.title, body: post.body ?? "" },
            ur: { title: post.titleUr ?? post.title, body: post.bodyUr ?? post.body ?? "" },
            ar: { title: post.titleAr ?? post.title, body: post.bodyAr ?? post.body ?? "" },
          },
        );
      }
    }

    logger.info({ published, flagged }, "News generation job: completed");
  } catch (err) {
    logger.error({ err }, "News generation job: failed");
  }
}

/** Category prefix emoji per language */
function getCategoryPrefix(category: string, isBreaking: boolean, lang: string): string {
  if (isBreaking) {
    return lang === "ar" ? "🔴 عاجل:" : lang === "en" ? "🔴 BREAKING:" : "🔴 بریکنگ:";
  }
  if (lang === "ar") {
    return category === "Security" ? "🛡️ أمن:" :
           category === "Government" ? "🏛️ حكومة:" :
           category === "Mosques" ? "🕌 مساجد:" :
           category === "Madrassas" ? "🎓 مدارس:" :
           category === "Palestine" ? "🇵🇸 فلسطين:" : "📰";
  }
  if (lang === "en") {
    return category === "Security" ? "🛡️ Security:" :
           category === "Government" ? "🏛️ Government:" :
           category === "Mosques" ? "🕌 Mosques:" :
           category === "Madrassas" ? "🎓 Madrassas:" :
           category === "Palestine" ? "🇵🇸 Palestine:" : "📰";
  }
  // Urdu (default)
  return category === "Security" ? "🛡️ سیکیورٹی:" :
         category === "Government" ? "🏛️ حکومت:" :
         category === "Mosques" ? "🕌 مساجد:" :
         category === "Madrassas" ? "🎓 مدارس:" :
         category === "Palestine" ? "🇵🇸 فلسطین:" : "📰";
}

async function notifySubscribers(
  postId: string,
  category: string,
  isBreaking: boolean,
  content: Record<string, { title: string; body: string }>,
): Promise<void> {
  try {
    const tokensWithLang = await fetchTokensWithLanguage(category, isBreaking);
    if (tokensWithLang.length === 0) {
      logger.info({ category, isBreaking }, "No eligible push tokens — skipping notification");
      return;
    }

    // Group tokens by language
    const byLang = new Map<string, string[]>();
    for (const { token, language } of tokensWithLang) {
      const lang = ["ur", "ar", "en"].includes(language) ? language : "ur";
      const arr = byLang.get(lang) ?? [];
      arr.push(token);
      byLang.set(lang, arr);
    }

    // Send one batch per language
    let totalSent = 0;
    for (const [lang, tokens] of byLang) {
      const c = content[lang] ?? content["ur"] ?? content["en"];
      const prefix = getCategoryPrefix(category, isBreaking, lang);
      const notifTitle = `${prefix} ${c.title}`;
      const notifBody = c.body.substring(0, 120) + (c.body.length > 120 ? "…" : "");
      await sendPushNotifications(tokens, notifTitle, notifBody, { postId });
      totalSent += tokens.length;
      logger.info({ lang, tokenCount: tokens.length, category }, "Push batch sent");
    }

    logger.info({ totalSent, category, isBreaking }, "Push notifications sent");
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

    logger.info({ agentIndex, count: articles.length }, "Single-agent job: articles generated");
    resetDailyCountIfNeeded();

    const sorted = [...articles].sort((a, b) => b.significanceScore - a.significanceScore);

    let published = 0;
    let flagged = 0;

    for (const article of sorted) {
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
        flagged++;
        continue;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + POST_TTL_MS);

      let imageUrl: string | null = null;
      let hasImage = false;

      const imgEligible =
        dailyImageCount < DAILY_IMAGE_BUDGET &&
        article.significanceScore >= IMAGE_SCORE_THRESHOLD;

      if (imgEligible) {
        const img = await fetchImage({ titleEn: article.title_en, category: article.category });
        if (img) {
          imageUrl = img.url;
          hasImage = true;
          dailyImageCount++;
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

      const shouldNotify =
        post.isBreaking ||
        ALWAYS_NOTIFY_CATEGORIES.has(post.category) ||
        post.significanceScore >= 8;

      if (shouldNotify) {
        await notifySubscribers(
          post.id,
          post.category,
          post.isBreaking ?? false,
          {
            en: { title: post.title, body: post.body ?? "" },
            ur: { title: post.titleUr ?? post.title, body: post.bodyUr ?? post.body ?? "" },
            ar: { title: post.titleAr ?? post.title, body: post.bodyAr ?? post.body ?? "" },
          },
        );
      }
    }

    logger.info({ agentIndex, published, flagged }, "Single-agent job: completed");
  } catch (err) {
    logger.error({ err, agentIndex }, "Single-agent job: failed");
  }
}
