-- pg_cron scheduling for DigitalXNews auto-delete job
-- Run this after enabling pg_cron in Supabase Dashboard:
--   Dashboard → Database → Extensions → pg_cron → Enable
--
-- Then connect to the postgres database and run:
--   psql "$DATABASE_URL" -f supabase/migrations/00002_pg_cron.sql

-- Auto-delete expired posts every 15 minutes (pure SQL — no edge function needed)
SELECT cron.schedule(
  'digitalxnews-auto-delete-expired-posts',
  '*/15 * * * *',
  $$DELETE FROM posts WHERE expires_at < NOW()$$
);

-- Verify it was scheduled:
-- SELECT * FROM cron.job WHERE jobname = 'digitalxnews-auto-delete-expired-posts';
