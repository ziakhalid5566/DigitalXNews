/**
 * NotificationsContext
 *
 * Stores incoming push notifications in AsyncStorage (up to 50) so users
 * can review them later in the Notifications tab.  Also tracks unread count
 * for the tab-bar badge.
 *
 * The listener lives here so any component can access the state without
 * prop-drilling.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const STORAGE_KEY = '@notifications_history';
const MAX_STORED = 50;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
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

    // Save every foreground notification to history
    const sub = Notifications.addNotificationReceivedListener(async (notif) => {
      const { title, body, data } = notif.request.content;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const existing: StoredNotification[] = raw ? JSON.parse(raw) : [];
        const entry: StoredNotification = {
          id: notif.request.identifier,
          title: title ?? 'DigitalXNews',
          body: body ?? '',
          postId: (data as Record<string, unknown>)?.postId as string | undefined,
          receivedAt: new Date().toISOString(),
          read: false,
        };
        const updated = [entry, ...existing].slice(0, MAX_STORED);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setNotifications(updated);
      } catch {}
    });

    return () => sub.remove();
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
