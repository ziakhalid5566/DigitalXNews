/**
 * Supabase Edge Function: auto-delete
 *
 * Deletes all posts where expires_at < NOW().
 * Should be called by pg_cron every 15 minutes.
 * See supabase/migrations/00002_pg_cron.sql for scheduling setup.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Require service role key in Authorization header (set by pg_cron call)
  const authHeader = req.headers.get("Authorization");
  const expectedKey = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (authHeader !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("posts")
    .delete()
    .lt("expires_at", now)
    .select("id");

  if (error) {
    console.error("Auto-delete error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const deletedCount = data?.length ?? 0;
  console.log(`Auto-delete: removed ${deletedCount} expired posts`);

  return new Response(
    JSON.stringify({ success: true, deletedCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
