-- Migration: Add preferred_language column to user_preferences
-- Run this on your Supabase SQL editor (or via drizzle-kit push)
--
-- This column stores each device's preferred notification language.
-- Default is 'ur' (Urdu) to match existing behavior.
--
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'ur';

COMMENT ON COLUMN user_preferences.preferred_language IS
  'User preferred notification language: ur (Urdu), ar (Arabic), en (English). Default: ur.';
