/**
 * Supabase Edge Function: push-notifications
 *
 * Item 5: Dedicated notification agent — separate from news writing agents.
 * Sends push notifications to all subscribed users for breaking or
 * high-significance news published in the last 10 minutes.
 *
 * Called by pg_cron after each news-generation run (every 5 minutes).
 * See migrations/00002_pg_cron.sql for scheduling.
 *
 * Item 6: Part of the strict sequential agent chain:
 *   news-generation runs at :00, :05, :10 … (each call = 1 news agent)
 *   push-notifications runs at :02, :07, :12 … (2 min after each news agent)
 *   This ensures no overlap and gives the news agent time to finish.
 *
 * Item 8: Notification titles use no AI branding — just the news headline.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** How far back to look for new posts to notify about (in minutes). */
const LOOKBACK_MINUTES = 10;

/** Only notify for posts with significance >= this threshold (or is_breaking). */
const MIN_SIGNIFICANCE = 7;

/** Maximum batch size for Expo push API (limit: 100 per request). */
const EXPO_BATCH_SIZE = 100;

interface PushToken {
  push_token: string;
  followed_categories: string[] | null;
  notifications_enabled: boolean;
}

interface Post {
  id: string;
  title: string;
  body: string;
  title_ur: string | null;
  title_ar: string | null;
  category: string;
  is_breaking: boolean;
  significance_score: number;
  published_at: string;
}

async function sendExpoBatch(messages: object[]): Promise<void> {
  if (messages.length === 0) return;

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
      } else {
        const result = await res.json();
        const errCount = result.data?.filter((r: { status: string }) => r.status === 'error').length ?? 0;
        if (errCount > 0) {
          console.warn(`[PushAgent] ${errCount}/${batch.length} messages had errors`);
        }
        console.log(`[PushAgent] Batch sent: ${batch.length} messages, ${errCount} errors`);
      }
    } catch (err) {
      console.error("[PushAgent] Network error sending batch:", err);
    }
  }
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

  // Step 1: Find recent breaking/significant posts
  const cutoff = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const { data: recentPosts, error: postsError } = await supabase
    .from("posts")
    .select("id, title, body, title_ur, title_ar, category, is_breaking, significance_score, published_at")
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
    .select("push_token, followed_categories, notifications_enabled")
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

  // Step 3: Build notification messages
  // Send one notification per qualifying post (most recent first)
  // Each user gets at most one notification in this run (for the most important post)
  const allMessages: object[] = [];
  let totalNotified = 0;

  for (const post of posts) {
    // Build title: use plain news headline — no AI branding (Item 8)
    const title = post.is_breaking
      ? `🔴 ${post.title}`
      : `📰 ${post.title}`;

    const bodySnippet = post.body.substring(0, 120);

    // Filter tokens that should receive this notification
    const eligibleTokens = prefs
      .filter((p) => {
        if (post.is_breaking) return true; // Breaking goes to everyone
        const cats = p.followed_categories;
        if (!cats || cats.length === 0) return true; // No preference = receives all
        return cats.includes(post.category);
      })
      .map((p) => p.push_token);

    const messages = eligibleTokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body: bodySnippet,
      data: { postId: post.id, category: post.category },
      channelId: "default",
    }));

    allMessages.push(...messages);
    totalNotified += messages.length;

    console.log(
      `[PushAgent] Post "${post.title.slice(0, 50)}" → ${messages.length} recipients` +
      ` (breaking: ${post.is_breaking}, score: ${post.significance_score})`,
    );
  }

  // Step 4: Send all messages in batches
  if (allMessages.length > 0) {
    await sendExpoBatch(allMessages);
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
