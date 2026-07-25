-- DigitalXNews — Supabase schema migration
-- Creates all tables and RPC functions needed by the app.
-- Run with: psql "$DATABASE_URL" -f supabase/migrations/00001_init.sql
--       or: supabase db push

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  category          TEXT NOT NULL,
  image_url         TEXT,
  has_image         BOOLEAN NOT NULL DEFAULT FALSE,
  significance_score INTEGER NOT NULL DEFAULT 5,
  source_note       TEXT NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  is_breaking       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Multi-language fields
  title_en          TEXT,
  body_en           TEXT,
  title_ur          TEXT,
  body_ur           TEXT,
  title_ar          TEXT,
  body_ar           TEXT,
  -- Engagement counters
  likes_count       INTEGER NOT NULL DEFAULT 0,
  views_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_expires_at
  ON posts (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_published_at
  ON posts (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category
  ON posts (category);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_preferences (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id               TEXT NOT NULL UNIQUE,
  push_token              TEXT,
  followed_categories     TEXT[] NOT NULL DEFAULT '{}',
  notifications_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_device_id
  ON user_preferences (device_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flagged_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  category          TEXT NOT NULL,
  significance_score INTEGER NOT NULL DEFAULT 5,
  source_note       TEXT NOT NULL,
  flag_reason       TEXT NOT NULL,
  flagged_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RPC functions (atomic engagement counters) ───────────────────────────────

CREATE OR REPLACE FUNCTION increment_post_likes(post_id UUID)
RETURNS INTEGER
LANGUAGE sql
AS $$
  UPDATE posts
  SET likes_count = likes_count + 1
  WHERE id = post_id
  RETURNING likes_count;
$$;

CREATE OR REPLACE FUNCTION increment_post_views(post_id UUID)
RETURNS INTEGER
LANGUAGE sql
AS $$
  UPDATE posts
  SET views_count = views_count + 1
  WHERE id = post_id
  RETURNING views_count;
$$;

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Mobile app uses anon key — posts are publicly readable, preferences are per-device.

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE flagged_posts ENABLE ROW LEVEL SECURITY;

-- Posts: anyone can read; only service role can insert/update/delete
CREATE POLICY "posts_anon_select" ON posts
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "posts_service_all" ON posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- User preferences: anyone can read/write their own (by device_id — no auth here)
-- Use service_role for all ops since mobile app uses anon key
CREATE POLICY "prefs_anon_all" ON user_preferences
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "prefs_service_all" ON user_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Flagged posts: only service role
CREATE POLICY "flagged_service_all" ON flagged_posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon to call the increment RPC functions
GRANT EXECUTE ON FUNCTION increment_post_likes(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_post_views(UUID) TO anon, authenticated;
