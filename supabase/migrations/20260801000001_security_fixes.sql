-- Migration: Security fixes (Supabase advisor recommendations)
-- Run once in Supabase SQL Editor.
--
-- Fixes:
--   1. generation_state — RLS disabled entirely (anyone with anon key could
--      read/modify it). Enable RLS + restrict to service_role.
--   2. increment_post_likes / increment_post_views — mutable search_path
--      advisory. Recreate with explicit SET search_path = public.
--   3. Drop dead `language` column from user_preferences (superseded by
--      `preferred_language`; keeping both causes confusion).
--
-- NOTE on prefs_anon_all (USING(true) for ALL commands):
--   This policy lets any anon caller read/write any user's push token.
--   The ideal fix is to authenticate each device with a signed JWT so RLS
--   can filter USING (device_id = current_setting('app.device_id')). That
--   requires an app change (pass device_id as a JWT claim or custom header).
--   For now the policy stays as-is because the app uses the anon key for
--   upserts and we cannot restrict by device_id without server-side auth.
--   Tracked for a future authenticated-device migration.

-- ── 1. generation_state — enable RLS, restrict to service_role ────────────────

ALTER TABLE public.generation_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_state_service_only" ON public.generation_state;
CREATE POLICY "generation_state_service_only" ON public.generation_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Fix mutable search_path on RPC functions ───────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_post_likes(post_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE posts
  SET likes_count = likes_count + 1
  WHERE id = post_id
  RETURNING likes_count;
$$;

CREATE OR REPLACE FUNCTION public.increment_post_views(post_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE posts
  SET views_count = views_count + 1
  WHERE id = post_id
  RETURNING views_count;
$$;

-- Re-grant execute (SECURITY DEFINER means the function runs as owner;
-- anon still needs EXECUTE permission to call it via PostgREST/RPC).
GRANT EXECUTE ON FUNCTION public.increment_post_likes(UUID)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_views(UUID) TO anon, authenticated;

-- ── 3. Drop dead `language` column ───────────────────────────────────────────
-- `preferred_language` (TEXT, NOT NULL, DEFAULT 'ur') is the one actually
-- used by the push-notifications function and the mobile app.
-- The plain `language` column was added earlier and never used anywhere.

ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS language;
