/**
 * Supabase-based query hooks replacing @workspace/api-client-react hooks.
 *
 * All hooks use React Query + the Supabase JS SDK.
 * snake_case Supabase column names are mapped to camelCase Post / UserPreference.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Post, UserPreference, PostRow, UserPreferenceRow } from './types';

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapPost(r: PostRow): Post {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    imageUrl: r.image_url,
    hasImage: r.has_image,
    significanceScore: r.significance_score,
    sourceNote: r.source_note,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
    isBreaking: r.is_breaking,
    createdAt: r.created_at,
    titleEn: r.title_en,
    bodyEn: r.body_en,
    titleUr: r.title_ur,
    bodyUr: r.body_ur,
    titleAr: r.title_ar,
    bodyAr: r.body_ar,
    likesCount: r.likes_count ?? 0,
    viewsCount: r.views_count ?? 0,
  };
}

function mapPref(r: UserPreferenceRow): UserPreference {
  return {
    id: r.id,
    deviceId: r.device_id,
    pushToken: r.push_token,
    followedCategories: r.followed_categories ?? [],
    notificationsEnabled: r.notifications_enabled,
    createdAt: r.created_at,
  };
}

// ─── Posts ─────────────────────────────────────────────────────────────────────

/**
 * List active (non-expired) posts.
 * Matches the shape previously returned by useListPosts from api-client-react:
 *   data → { posts: Post[], total: number, page: number, limit: number }
 */
export function useListPosts(
  params: { category?: string; limit?: number; page?: number } = {},
  options: { query?: { queryKey?: unknown[]; enabled?: boolean } } = {},
) {
  const { category, limit = 30, page = 1 } = params;
  const queryKey = options?.query?.queryKey ?? ['posts', category ?? 'All', page];
  const enabled = options?.query?.enabled ?? true;

  return useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const now = new Date().toISOString();
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let query = supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .gt('expires_at', now)
        .order('published_at', { ascending: false })
        .range(from, to);

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);

      return {
        posts: (data as PostRow[]).map(mapPost),
        total: count ?? 0,
        page,
        limit,
      };
    },
    staleTime: 60_000,
  });
}

/**
 * Server-side full-text search across all non-expired posts.
 *
 * Searches title_en, title_ur, title_ar, body_en, body_ur, body_ar, and
 * category using Supabase's `ilike` (case-insensitive substring match).
 * Runs on the Supabase backend so it searches the entire database, not just
 * the most recent 150 posts loaded for the home feed.
 *
 * Also supports category filtering (pass category !== 'All' to narrow results).
 */
export function useSearchPosts(
  params: { query: string; category?: string; limit?: number },
  options: { enabled?: boolean } = {},
) {
  const { query: searchQuery, category, limit = 100 } = params;
  const trimmed = searchQuery.trim();
  const enabled = (options.enabled ?? true) && trimmed.length > 0;

  return useQuery({
    queryKey: ['search', trimmed, category ?? 'All'],
    enabled,
    queryFn: async () => {
      const now = new Date().toISOString();
      const pattern = `%${trimmed}%`;

      // Supabase OR filter across all text columns
      let query = supabase
        .from('posts')
        .select('*')
        .gt('expires_at', now)
        .or(
          [
            `title_en.ilike.${pattern}`,
            `title_ur.ilike.${pattern}`,
            `title_ar.ilike.${pattern}`,
            `body_en.ilike.${pattern}`,
            `body_ur.ilike.${pattern}`,
            `body_ar.ilike.${pattern}`,
            `title.ilike.${pattern}`,
            `category.ilike.${pattern}`,
          ].join(','),
        )
        .order('published_at', { ascending: false })
        .limit(limit);

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return (data as PostRow[]).map(mapPost);
    },
    staleTime: 30_000,
  });
}

/**
 * Fetch a single post by ID.
 * Matches the shape previously returned by useGetPost.
 */
export function useGetPost(
  id: string,
  options: { query?: { enabled?: boolean; queryKey?: unknown[] } } = {},
) {
  const enabled = options?.query?.enabled ?? true;

  return useQuery({
    queryKey: options?.query?.queryKey ?? ['post', id],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return mapPost(data as PostRow);
    },
  });
}

/**
 * Atomically increment likesCount via Supabase RPC.
 * Mutation variable shape: { id: string }
 * Returns: { likesCount: number }
 */
export function useLikePost() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc('increment_post_likes', { post_id: id });
      if (error) throw new Error(error.message);
      return { likesCount: data as number };
    },
  });
}

/**
 * Atomically increment viewsCount via Supabase RPC.
 * Mutation variable shape: { id: string }
 * Returns: { viewsCount: number }
 */
export function useViewPost() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc('increment_post_views', { post_id: id });
      if (error) throw new Error(error.message);
      return { viewsCount: data as number };
    },
  });
}

// ─── Category counts ───────────────────────────────────────────────────────────

export function useListCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 120_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('posts')
        .select('category')
        .gt('expires_at', now);
      if (error) throw new Error(error.message);

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.category] = (counts[row.category] ?? 0) + 1;
      }
      return Object.entries(counts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    },
  });
}

// ─── User Preferences ─────────────────────────────────────────────────────────

/**
 * Fetch preferences for a device.
 * Matches shape of useGetPreferences from api-client-react.
 */
export function useGetPreferences(
  deviceId: string,
  options: { query?: { enabled?: boolean } } = {},
) {
  const enabled = options?.query?.enabled ?? true;

  return useQuery({
    queryKey: ['preferences', deviceId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();
      // maybeSingle returns null if not found (no error)
      if (error) throw new Error(error.message);
      return data ? mapPref(data as UserPreferenceRow) : null;
    },
  });
}

/**
 * Upsert preferences for a device.
 * Mutation variable shape: { data: { deviceId, notificationsEnabled?, followedCategories?, pushToken? } }
 */
export function useUpsertPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      data,
    }: {
      data: {
        deviceId: string;
        notificationsEnabled?: boolean;
        followedCategories?: string[];
        pushToken?: string | null;
      };
    }) => {
      const { data: result, error } = await supabase
        .from('user_preferences')
        .upsert(
          {
            device_id: data.deviceId,
            notifications_enabled: data.notificationsEnabled ?? true,
            followed_categories: data.followedCategories ?? [],
            ...(data.pushToken !== undefined ? { push_token: data.pushToken } : {}),
          },
          { onConflict: 'device_id' },
        )
        .select()
        .single();

      if (error) throw new Error(error.message);
      return mapPref(result as UserPreferenceRow);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['preferences', result.deviceId] });
    },
  });
}
