-- Migration: Schema reconciliation
-- Syncs the repo to match what is actually live on Supabase.
-- Safe to re-run (all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- Additions that were applied directly on Supabase but were never in the
-- migrations folder:
--   - generation_state table (tracks which news agent runs next)
--   - preferred_language column on user_preferences
--   - add_preferred_language.sql is superseded by this file

-- ── generation_state ─────────────────────────────────────────────────────────
-- Tracks the rotating agent index for sequential news generation.

CREATE TABLE IF NOT EXISTS public.generation_state (
  id                  INTEGER PRIMARY KEY,
  current_agent_index INTEGER NOT NULL DEFAULT 0,
  last_run_at         TIMESTAMPTZ,
  last_agent_name     TEXT
);

-- Seed the initial row (only if table was just created or is empty)
INSERT INTO public.generation_state (id, current_agent_index)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- ── preferred_language on user_preferences ────────────────────────────────────
-- Already handled by add_preferred_language.sql but repeated here with
-- IF NOT EXISTS so this file is safe to run on a clean DB.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'ur';

-- ── notified_at on posts ──────────────────────────────────────────────────────
-- Already handled by 20260801000000_add_notified_at_to_posts.sql but
-- repeated here for completeness on a fresh DB.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_notified_at
  ON public.posts (notified_at)
  WHERE notified_at IS NULL;
