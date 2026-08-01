/**
 * NotificationsContext
 *
 * Stores push notifications locally (AsyncStorage, up to 100) and syncs
 * missed notifications from Supabase on every app open.
 *
 * Coverage strategy:
 *  - Foreground:          addNotificationReceivedListener → saved immediately.
 *  - Background/killed tap: addNotificationResponseReceivedListener → saved on tap.
 *  - Background/killed NO tap (app opened directly): Supabase sync on mount fills
 *    the gap — queries posts that qualify as notifications and merges any that
 *    are not already stored locally.
 *  - Cold-start tap:     getLastNotificationResponseAsync() on mount catches the
 *    notification response that fired before the listener was registered.
 *
 * Auto-expiry: notifications older than 72 hours are pruned on every load.
 *
 * Install-date gating (fix): a fresh install must never backfill news that
 * was published before the user installed the app. `installedAt` is
 * recorded once on first launch and persists across app opens (it is only
 * ever set once). The Supabase sync cutoff is the later of
 * `now - 72h` and `installedAt`, so a brand-new install starts with an
 * empty list and only ever sees notifications from after install time.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

const STORAGE_KEY = '@notifications_history_v2';
/** Recorded once on first launch — never overwritten afterwards. */
const INSTALL_KEY = '@app_installed_at';
const MAX_STORED = 100;
/** Notifications older than this are pruned automatically (matches post expiry). */
const TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
/** Minimum significance score that triggers a push notification (mirrors push-agent). */
const MIN_SIGNIFICANCE = 7;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  postId?: string;
  receivedAt: string; // ISO string
  read: boolean;
}

interface NotificationsCtx {
  notifications: StoredNotification[];
  unreadCount: number;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const Ctx = createContext<NotificationsCtx>({
  notifications: [],
  unreadCount: 0,
  markAllRead: async () => {},
  clearAll: async () => {},
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remove entries older than TTL_MS. */
function pruneExpired(list: StoredNotification[]): StoredNotification[] {
  const cutoff = Date.now() - TTL_MS;
  return list.filter((n) => new Date(n.receivedAt).getTime() > cutoff);
}

/**
 * Returns the timestamp (ms) the app was first installed/opened, recording
 * it on first call and reusing the same value forever after. This is what
 * stops a fresh install from backfilling news published before install.
 */
async function getOrSetInstalledAt(): Promise<number> {
  const stored = await AsyncStorage.getItem(INSTALL_KEY);
  if (stored) return Number(stored);
  const now = Date.now();
  await AsyncStorage.setItem(INSTALL_KEY, String(now));
  return now;
}

/** Build a StoredNotification from expo-notifications content fields. */
function buildEntry(
  id: string,
  title: string | null | undefined,
  body: string | null | undefined,
  data: unknown,
  receivedAt?: string,
): StoredNotification {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    id,
    title: title ?? 'DigitalXNews',
    body: body ?? '',
    postId: d.postId as string | undefined,
    imageUrl: (d.imageUrl ?? d.image_url) as string | undefined,
    receivedAt: receivedAt ?? new Date().toISOString(),
    read: false,
  };
}

/**
 * Persist a new entry, deduplicating by both notification id and postId.
 * Returns the updated list (unchanged reference if nothing was added).
 */
async function persistEntry(
  entry: StoredNotification,
  existing: StoredNotification[],
): Promise<StoredNotification[]> {
  const isDuplicate =
    existing.some((n) => n.id === entry.id) ||
    (!!entry.postId && existing.some((n) => n.postId === entry.postId));
  if (isDuplicate) return existing;

  const updated = [entry, ...existing].slice(0, MAX_STORED);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Fetch qualifying posts from Supabase published after `sinceMs` and merge
 * any that are not already in the local list. `sinceMs` is the later of
 * (now - 72h) and the app's install time, so a fresh install never
 * backfills notifications from before the user installed the app.  This
 * fills the gap for notifications that arrived while the app was in the
 * background and the user opened the app directly (without tapping the
 * notification).
 */
async function syncFromSupabase(
  existing: StoredNotification[],
  sinceMs: number,
  appLang: string,
): Promise<StoredNotification[]> {
  try {
    const cutoff = new Date(sinceMs).toISOString();
    const { data: posts, error } = await supabase
      .from('posts')
      .select(
        'id, title, body, title_ur, title_ar, body_ur, body_ar, is_breaking, significance_score, published_at',
      )
      .gte('published_at', cutoff)
      .or(`is_breaking.eq.true,significance_score.gte.${MIN_SIGNIFICANCE}`)
      .order('published_at', { ascending: false })
      .limit(50);

    if (error || !posts || posts.length === 0) return existing;

    const existingPostIds = new Set(existing.map((n) => n.postId).filter(Boolean));
    const newEntries: StoredNotification[] = [];

    for (const post of posts) {
      if (existingPostIds.has(post.id)) continue;

      // Match the title/body language to what this device actually shows
      // elsewhere in the app (fixes mismatched-language notifications).
      const rawTitle =
        appLang === 'en' ? (post.title as string) ?? ''
        : appLang === 'ar' ? (post.title_ar as string | null) ?? (post.title as string) ?? ''
        : (post.title_ur as string | null) ?? (post.title as string) ?? '';
      const displayTitle = (post.is_breaking as boolean)
        ? `🔴 ${rawTitle}`
        : `📰 ${rawTitle}`;
      const rawBody =
        appLang === 'en' ? (post.body as string | null) ?? ''
        : appLang === 'ar' ? (post.body_ar as string | null) ?? (post.body as string | null) ?? ''
        : (post.body_ur as string | null) ?? (post.body as string | null) ?? '';

      newEntries.push({
        id: `synced-${post.id as string}`,
        title: displayTitle,
        body: rawBody.substring(0, 120),
        postId: post.id as string,
        receivedAt: post.published_at as string,
        read: false,
      });
    }

    if (newEntries.length === 0) return existing;

    // Merge: new entries at the front, sorted by receivedAt desc
    const merged = [...newEntries, ...existing]
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      .slice(0, MAX_STORED);

    return merged;
  } catch {
    // Non-critical — return existing list unchanged
    return existing;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);

  useEffect(() => {
    /** Full initialisation: load → prune expired → catch cold-start tap → Supabase sync */
    const initialize = async () => {
      try {
        // 1. Load from storage
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        let stored: StoredNotification[] = raw ? JSON.parse(raw) : [];

        // 2. Auto-expire notifications older than 72 hours
        stored = pruneExpired(stored);

        // 3. Cold-start: app opened by tapping a notification before listeners mounted
        try {
          const lastResponse = await Notifications.getLastNotificationResponseAsync();
          if (lastResponse) {
            const { title, body, data } = lastResponse.notification.request.content;
            const entry = buildEntry(
              lastResponse.notification.request.identifier,
              title,
              body,
              data,
            );
            stored = await persistEntry(entry, stored);
          }
        } catch {
          // getLastNotificationResponseAsync is best-effort
        }

        // 4. Supabase sync — fills in all background/killed notifications the user
        //    never tapped (the most common gap on Android). Bounded by install
        //    time so a fresh install doesn't backfill pre-install news, and
        //    localized to the device's own language setting.
        const installedAtMs = await getOrSetInstalledAt();
        const sinceMs = Math.max(Date.now() - TTL_MS, installedAtMs);
        const appLang = (await AsyncStorage.getItem('app_language')) ?? 'ur';
        const synced = await syncFromSupabase(stored, sinceMs, appLang);
        if (synced !== stored) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(synced));
        }

        setNotifications(synced);
      } catch {}
    };

    initialize();

    // ── Foreground: notification arrives while app is open ──────────────────
    const receivedSub = Notifications.addNotificationReceivedListener(async (notif) => {
      try {
        const { title, body, data } = notif.request.content;
        const entry = buildEntry(notif.request.identifier, title, body, data);
        setNotifications((prev) => {
          persistEntry(entry, prev).then(setNotifications).catch(() => {});
          return prev;
        });
      } catch {}
    });

    // ── Background / killed tap: user taps notification to open the app ─────
    // Covers background and killed states on top of the cold-start check above.
    const responseSub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      try {
        const { title, body, data } = response.notification.request.content;
        const entry = buildEntry(
          response.notification.request.identifier,
          title,
          body,
          data,
        );
        setNotifications((prev) => {
          persistEntry(entry, prev).then(setNotifications).catch(() => {});
          return prev;
        });
      } catch {}
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  return (
    <Ctx.Provider
      value={{
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        markAllRead,
        clearAll,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useNotifications = () => useContext(Ctx);
