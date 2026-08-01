/**
 * Supabase Edge Function: push-notifications
 *
 * Item 5: Dedicated notification agent — separate from news writing agents.
 * Sends push notifications to all subscribed users for breaking or
 * high-significance news published in the last LOOKBACK_MINUTES minutes.
 *
 * Called by pg_cron after each news-generation run (every 5 minutes).
 * See migrations/00002_pg_cron.sql for scheduling.
 *
 * Item 6: Part of the strict sequential agent chain:
 * news-generation runs at :00, :05, :10 … (each call = 1 news agent)
 * push-notifications runs at :02, :07, :12 … (2 min after each news agent)
 * This ensures no overlap and gives the news agent time to finish.
 *
 * Item 8: Notification titles use no AI branding — just the news headline.
 *
 * Item 9 (fix): Dedup + per-user language.
 * - LOOKBACK_MINUTES (30) is intentionally wider than the 5-minute cron
 *   interval so a missed/late run doesn't skip a post. Duplicate sends
 *   across overlapping windows are prevented by `posts.notified_at`:
 *   a post is only ever picked up once (`notified_at is null`), and is
 *   stamped immediately after processing.
 * - Each subscriber is sent the notification in their own
 *   `preferred_language` (title_ur / title_ar / title), instead of
 *   always sending the English title to everyone.
 *
 * Item 10 (fix): Delivery error tracking.
 * - Every per-message error returned by the Expo push API is now logged
 *   into `notification_errors` (post_id, push_token, error_code,
 *   error_message) instead of only appearing in function console logs.
 * - Tokens that Expo reports as "DeviceNotRegistered" (app uninstalled /
 *   token permanently invalid) have their `push_token` cleared on the
 *   matching `user_preferences` row so we stop wasting sends on dead
 *   tokens and the row falls out of future `prefs` queries automatically.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * How far back to look for new posts to notify about (in minutes).
 * Wider than the 5-minute cron cadence on purpose — `notified_at` (not
 * this window) is what prevents duplicate sends, so it's safe to widen
 * this as a safety net for delayed cron runs.
 */
const LOOKBACK_MINUTES = 30;

/** Only notify for posts with significance >= this threshold (or is_breaking). */
const MIN_SIGNIFICANCE = 7;

/** Maximum batch size for Expo push API (limit: 100 per request). */
const EXPO_BATCH_SIZE = 100;

type Lang = "ur" | "en" | "ar";

interface PushToken {
  push_token: string;
  followed_categories: string[] | null;
  notifications_enabled: boolean;
  preferred_language: Lang | null;
}

interface Post {
  id: string;
  title: string;
  body: string;
  title_ur: string | null;
  title_ar: string | null;
  body_ur: string | null;
  body_ar: string | null;
  category: string;
  is_breaking: boolean;
  significance_score: number;
  published_at: string;
}

/** Pick the title/body for a given language, falling back to English. */
function localize(post: Post, lang: Lang): { title: string; body: string } {
  if (lang === "ur") {
    return { title: post.title_ur ?? post.title, body: post.body_ur ?? post.body };
  }
  if (lang === "ar") {
    return { title: post.title_ar ?? post.title, body: post.body_ar ?? post.body };
  }
  return { title: post.title, body: post.body };
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface SentMessage {
  to: string;
  postId: string;
}

/**
 * Send a batch of Expo push messages and return the (message, ticket)
 * pairs so the caller can log errors and deactivate dead tokens.
 */
async function sendExpoBatch(
  messages: (object & SentMessage)[],
): Promise<{ message: SentMessage; ticket: ExpoTicket }[]> {
  const results: { message: SentMessage; ticket: ExpoTicket }[] = [];
  if (messages.length === 0) return results;

  // Split into batches of EXPO_BATCH_SIZE
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[PushAgent] Expo API error ${res.status}: ${errText}`);
        // Whole batch failed at the transport level — record a generic
        // error against every message in this batch so it's still visible
        // in notification_errors instead of only in function logs.
        for (const m of batch) {
          results.push({
            message: m,
            ticket: { status: "error", message: `HTTP ${res.status}: ${errText.slice(0, 300)}` },
          });
        }
      } else {
        const result = await res.json();
        const tickets: ExpoTicket[] = result.data ?? [];
        const errCount = tickets.filter((r) => r.status === "error").length;
        if (errCount > 0) {
          console.warn(`[PushAgent] ${errCount}/${batch.length} messages had errors`);
        }
        console.log(`[PushAgent] Batch sent: ${batch.length} messages, ${errCount} errors`);
        // Zip tickets back up with the messages that produced them —
        // Expo returns tickets in the same order as the request array.
        batch.forEach((m, idx) => {
          const ticket = tickets[idx] ?? { status: "ok" as const };
          results.push({ message: m, ticket });
        });
      }
    } catch (err) {
      console.error("[PushAgent] Network error sending batch:", err);
      for (const m of batch) {
        results.push({
          message: m,
          ticket: { status: "error", message: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("[PushAgent] Push notification agent started");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Step 1: Find recent breaking/significant posts that have NOT been
  // notified yet (notified_at is null). This is what actually prevents
  // duplicate sends — the time window above is just a safety net.
  const cutoff = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const { data: recentPosts, error: postsError } = await supabase
    .from("posts")
    .select(
      "id, title, body, title_ur, title_ar, body_ur, body_ar, category, is_breaking, significance_score, published_at",
    )
    .is("notified_at", null)
    .gte("published_at", cutoff)
    .or(`is_breaking.eq.true,significance_score.gte.${MIN_SIGNIFICANCE}`)
    .order("published_at", { ascending: false });

  if (postsError) {
    console.error("[PushAgent] Error fetching recent posts:", postsError.message);
    return new Response(JSON.stringify({ success: false, error: postsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const posts: Post[] = recentPosts ?? [];
  if (posts.length === 0) {
    console.log("[PushAgent] No qualifying posts in the last", LOOKBACK_MINUTES, "minutes — nothing to send");
    return new Response(
      JSON.stringify({ success: true, notified: 0, posts: 0, message: "No qualifying posts" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log(`[PushAgent] Found ${posts.length} qualifying post(s) to notify about`);

  // Step 2: Load all subscribed user tokens
  const { data: prefRows, error: prefsError } = await supabase
    .from("user_preferences")
    .select("push_token, followed_categories, notifications_enabled, preferred_language")
    .eq("notifications_enabled", true)
    .not("push_token", "is", null);

  if (prefsError) {
    console.error("[PushAgent] Error fetching user prefs:", prefsError.message);
    return new Response(JSON.stringify({ success: false, error: prefsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const prefs: PushToken[] = (prefRows ?? []).filter(
    (p: { push_token: string | null }) =>
      p.push_token && p.push_token.startsWith("ExponentPushToken["),
  );

  if (prefs.length === 0) {
    console.log("[PushAgent] No subscribed users with valid Expo tokens");
    return new Response(
      JSON.stringify({ success: true, notified: 0, posts: posts.length, message: "No subscribers" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Step 3: Build notification messages — one per (post, subscriber),
  // localized to each subscriber's preferred_language (default Urdu,
  // matching the app's default).
  const allMessages: (object & SentMessage)[] = [];
  let totalNotified = 0;
  const processedPostIds: string[] = [];

  for (const post of posts) {
    // Filter tokens that should receive this notification
    const eligiblePrefs = prefs.filter((p) => {
      if (post.is_breaking) return true; // Breaking goes to everyone
      const cats = p.followed_categories;
      if (!cats || cats.length === 0) return true; // No preference = receives all
      return cats.includes(post.category);
    });

    for (const pref of eligiblePrefs) {
      const lang: Lang = pref.preferred_language ?? "ur";
      const { title: localizedTitle, body: localizedBody } = localize(post, lang);
      const title = post.is_breaking ? `🔴 ${localizedTitle}` : `📰 ${localizedTitle}`;

      allMessages.push({
        to: pref.push_token,
        postId: post.id,
        sound: "default",
        title,
        body: localizedBody.substring(0, 120),
        data: { postId: post.id, category: post.category },
        channelId: "default",
      });
    }

    totalNotified += eligiblePrefs.length;
    processedPostIds.push(post.id);
    console.log(
      `[PushAgent] Post "${post.title.slice(0, 50)}" → ${eligiblePrefs.length} recipients` +
        ` (breaking: ${post.is_breaking}, score: ${post.significance_score})`,
    );
  }

  // Step 4: Send all messages in batches, then process delivery results —
  // log every error and deactivate permanently-invalid tokens.
  if (allMessages.length > 0) {
    const results = await sendExpoBatch(allMessages);

    const errorRows: {
      post_id: string;
      push_token: string;
      error_code: string | null;
      error_message: string | null;
    }[] = [];
    const deadTokens = new Set<string>();

    for (const { message, ticket } of results) {
      if (ticket.status === "error") {
        const errorCode = ticket.details?.error ?? null;
        errorRows.push({
          post_id: message.postId,
          push_token: message.to,
          error_code: errorCode,
          error_message: ticket.message ?? null,
        });
        if (errorCode === "DeviceNotRegistered") {
          deadTokens.add(message.to);
        }
      }
    }

    if (errorRows.length > 0) {
      const { error: logError } = await supabase.from("notification_errors").insert(errorRows);
      if (logError) {
        console.error("[PushAgent] Failed to log notification_errors:", logError.message);
      } else {
        console.log(`[PushAgent] Logged ${errorRows.length} delivery error(s)`);
      }
    }

    if (deadTokens.size > 0) {
      const { error: clearError } = await supabase
        .from("user_preferences")
        .update({ push_token: null })
        .in("push_token", Array.from(deadTokens));
      if (clearError) {
        console.error("[PushAgent] Failed to clear dead push tokens:", clearError.message);
      } else {
        console.log(`[PushAgent] Cleared ${deadTokens.size} dead push token(s)`);
      }
    }
  }

  // Step 5: Stamp every processed post as notified — even if it had 0
  // eligible recipients — so it is never picked up again on a later run.
  if (processedPostIds.length > 0) {
    const { error: stampError } = await supabase
      .from("posts")
      .update({ notified_at: new Date().toISOString() })
      .in("id", processedPostIds);
    if (stampError) {
      console.error("[PushAgent] Failed to stamp notified_at:", stampError.message);
    }
  }

  console.log(`[PushAgent] Complete: ${totalNotified} total notifications sent for ${posts.length} post(s)`);

  return new Response(
    JSON.stringify({
      success: true,
      notified: totalNotified,
      posts: posts.length,
      subscribers: prefs.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
