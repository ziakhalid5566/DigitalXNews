/**
 * NotificationsContext
 *
 * Stores incoming push notifications in AsyncStorage (up to 100) so users
 * can review them later in the Notifications tab.  Also tracks unread count
 * for the tab-bar badge.
 *
 * Coverage by state:
 *  - Foreground:  addNotificationReceivedListener fires → saved immediately.
 *  - Background:  Notification shown in OS tray; when user taps it,
 *                 addNotificationResponseReceivedListener fires → saved on tap.
 *  - Killed:      Same as background — saved when user taps to open the app.
 *
 * Deduplication by notification ID prevents double-saving when the foreground
 * listener and the tap-response listener both fire for the same notification.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const STORAGE_KEY = '@notifications_history';
const MAX_STORED = 100;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  postId?: string;
  receivedAt: string;
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

/** Persist a new notification entry, deduplicating by id. */
async function persistNotification(entry: StoredNotification): Promise<StoredNotification[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const existing: StoredNotification[] = raw ? JSON.parse(raw) : [];

  // Skip if already stored (foreground listener may have saved it first)
  if (existing.some((n) => n.id === entry.id)) return existing;

  const updated = [entry, ...existing].slice(0, MAX_STORED);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

/** Extract a notification entry from expo-notifications content. */
function buildEntry(
  id: string,
  title: string | null | undefined,
  body: string | null | undefined,
  data: unknown,
): StoredNotification {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    id,
    title: title ?? 'DigitalXNews',
    body: body ?? '',
    postId: d.postId as string | undefined,
    imageUrl: (d.imageUrl ?? d.image_url) as string | undefined,
    receivedAt: new Date().toISOString(),
    read: false,
  };
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setNotifications(raw ? JSON.parse(raw) : []);
    } catch {}
  }, []);

  useEffect(() => {
    load();

    // ── Foreground: notification arrives while app is open ────────────────────
    const receivedSub = Notifications.addNotificationReceivedListener(async (notif) => {
      const { title, body, data } = notif.request.content;
      try {
        const entry = buildEntry(notif.request.identifier, title, body, data);
        const updated = await persistNotification(entry);
        setNotifications(updated);
      } catch {}
    });

    // ── Background / killed: user taps notification to open the app ──────────
    // addNotificationResponseReceivedListener fires in all three states
    // (foreground, background, killed). We save the notification here so that
    // notifications received while the app was not in the foreground still
    // appear in the Alerts tab after the user taps them.
    const responseSub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { title, body, data } = response.notification.request.content;
      try {
        const entry = buildEntry(
          response.notification.request.identifier,
          title,
          body,
          data,
        );
        const updated = await persistNotification(entry);
        // Refresh state — if the notification was already stored this is a no-op
        setNotifications(updated);
      } catch {}
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [load]);

  const markAllRead = useCallback(async () => {
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }, [notifications]);

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
