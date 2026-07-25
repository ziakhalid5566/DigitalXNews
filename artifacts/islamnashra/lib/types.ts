/**
 * Local type definitions matching the Supabase posts/user_preferences tables.
 * These mirror the camelCase convention used throughout the app.
 * Supabase PostgREST returns snake_case; api.ts mappers convert to these types.
 */

export interface Post {
  id: string;
  title: string;
  body: string;
  category: string;
  imageUrl: string | null;
  hasImage: boolean;
  significanceScore: number;
  sourceNote: string;
  publishedAt: string; // ISO 8601
  expiresAt: string;
  isBreaking: boolean;
  createdAt: string;
  titleEn: string | null;
  bodyEn: string | null;
  titleUr: string | null;
  bodyUr: string | null;
  titleAr: string | null;
  bodyAr: string | null;
  likesCount: number;
  viewsCount: number;
}

export interface UserPreference {
  id: string;
  deviceId: string;
  pushToken: string | null;
  followedCategories: string[];
  notificationsEnabled: boolean;
  createdAt: string;
}

// ─── Supabase row shapes (snake_case from PostgREST) ─────────────────────────

export interface PostRow {
  id: string;
  title: string;
  body: string;
  category: string;
  image_url: string | null;
  has_image: boolean;
  significance_score: number;
  source_note: string;
  published_at: string;
  expires_at: string;
  is_breaking: boolean;
  created_at: string;
  title_en: string | null;
  body_en: string | null;
  title_ur: string | null;
  body_ur: string | null;
  title_ar: string | null;
  body_ar: string | null;
  likes_count: number;
  views_count: number;
}

export interface UserPreferenceRow {
  id: string;
  device_id: string;
  push_token: string | null;
  followed_categories: string[];
  notifications_enabled: boolean;
  created_at: string;
}
