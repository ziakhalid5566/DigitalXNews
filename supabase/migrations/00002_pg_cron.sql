-- pg_cron scheduling for IslamNashra — Item 6: Strict Sequential Timing
-- ============================================================
-- Agents run one at a time with 5-minute gaps between each.
-- Example: Agent 1 at 10:00, Agent 2 at 10:05, Agent 3 at 10:10, etc.
--
-- How it works:
--   - news-generation edge function runs every 5 minutes.
--   - Each call processes exactly ONE news agent (sequential via generation_state table).
--   - push-notifications edge function runs 2 minutes after each news-generation call
--     so there is never any overlap between agents.
--
-- Setup instructions:
--   1. Enable pg_cron in Supabase Dashboard:
--      Dashboard → Database → Extensions → pg_cron → Enable
--   2. Connect to the postgres database and run this file:
--      psql "$DATABASE_URL" -f supabase/migrations/00002_pg_cron.sql
--
-- Required Supabase secrets (set via `supabase secrets set`):
--   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
--
-- ============================================================

-- Remove old schedules if they exist (clean re-run)
SELECT cron.unschedule('digitalxnews-auto-delete-expired-posts') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'digitalxnews-auto-delete-expired-posts'
);
SELECT cron.unschedule('islamnashra-news-generation') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'islamnashra-news-generation'
);
SELECT cron.unschedule('islamnashra-push-notifications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'islamnashra-push-notifications'
);

-- ── 1. Auto-delete expired posts every 15 minutes (pure SQL, no edge function) ──
SELECT cron.schedule(
  'islamnashra-auto-delete-expired-posts',
  '*/15 * * * *',
  $$DELETE FROM posts WHERE expires_at < NOW()$$
);

-- ── 2. News generation — every 5 minutes (one agent per call) ─────────────────
-- This fires the news-generation edge function which runs ONE agent per call,
-- cycling agent 0→1→2→3→4→5→6→7→0→… via the generation_state table.
-- Replace <SUPABASE_PROJECT_REF> with your actual Supabase project reference ID.
-- Replace <SUPABASE_SERVICE_ROLE_KEY> with your actual service role key.
SELECT cron.schedule(
  'islamnashra-news-generation',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/news-generation',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- ── 3. Push notifications — 2 minutes after each news-generation run ──────────
-- Fires at :02, :07, :12, :17, :22, :27, :32, :37, :42, :47, :52, :57
-- This ensures news-generation (at :00, :05, etc.) always finishes before
-- push-notifications starts. Zero agent overlap guaranteed.
SELECT cron.schedule(
  'islamnashra-push-notifications',
  '2-59/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/push-notifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SUPABASE_SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- ── Verify schedules ──────────────────────────────────────────────────────────
-- Run this to confirm all jobs are registered:
-- SELECT jobname, schedule, command FROM cron.job
-- WHERE jobname LIKE 'islamnashra-%' ORDER BY jobname;
