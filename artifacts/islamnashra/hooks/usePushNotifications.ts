/**
 * usePushNotifications
 *
 * Handles push token registration on physical devices.
 * Permission request is intentionally NOT done here — _layout.tsx asks
 * for it AFTER the splash animation so the user sees the app first.
 *
 * Flow:
 *  1. Setup Android notification channel (silent — no dialog)
 *  2. Re-register any cached token with the backend on every launch
 *  3. If no cached token → get a new Expo push token → save + register
 */

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export const PUSH_TOKEN_KEY = 'pushToken';
export const DEVICE_ID_KEY = 'deviceId';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase && supabaseUrl && supabaseAnonKey) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _supabase;
}

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'DigitalXNews',
    description: 'اسلامی خبریں اور بریکنگ نیوز — DigitalXNews',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1565C0',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
  });
}

async function registerTokenWithBackend(
  deviceId: string,
  token: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb
      .from('user_preferences')
      .upsert(
        { device_id: deviceId, push_token: token, notifications_enabled: true },
        { onConflict: 'device_id' },
      );
    if (error) {
      console.error('[PushNotifications] Backend registration error:', error.message);
    }
  } catch (err) {
    console.error('[PushNotifications] Backend registration failed:', err);
  }
}

export interface PushRegistrationResult {
  token: string | null;
  error: string | null;
}

/**
 * Attempts to get an Expo push token.
 * Prerequisites: notification permission must already be granted before calling.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      token: null,
      error: 'Push notifications require a physical device.',
    };
  }

  // Ensure Android notification channel exists
  await setupAndroidChannel();

  // Check current permission status — do NOT request here (done in _layout.tsx)
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    return {
      token: null,
      error: 'Notification permission not yet granted.',
    };
  }

  // Resolve EAS project ID from app.json or env var
  const projectId: string | undefined =
    (process.env.EXPO_PUBLIC_EAS_PROJECT_ID as string | undefined) ??
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas
      ?.projectId as string | undefined ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    return {
      token: null,
      error:
        'No EAS project ID found. Add extra.eas.projectId in app.json. ' +
        'Create a free project at https://expo.dev',
    };
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: tokenData.data, error: null };
  } catch (err) {
    const rawMessage =
      err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);

    let friendlyMessage = `Failed to get push token: ${rawMessage}`;
    if (rawMessage.includes('Firebase') || rawMessage.includes('API key')) {
      friendlyMessage =
        'FCM configuration error — ensure google-services.json is valid and ' +
        'the GOOGLE_SERVICES_JSON secret is set in your GitHub repository.';
    }

    console.error('[PushNotifications]', friendlyMessage);
    return { token: null, error: friendlyMessage };
  }
}

/**
 * Hook that runs on app startup:
 * 1. Sets up the Android notification channel.
 * 2. Re-registers cached token with the backend (tokens can change).
 * 3. If no token yet, attempts to get one (succeeds if permission already granted).
 *
 * NOTE: Permission request is handled in _layout.tsx (after splash animation).
 * This hook only runs the token-fetch flow.
 */
export function usePushNotifications(): void {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // Always set up the Android channel (idempotent)
        await setupAndroidChannel();

        const deviceId = await getOrCreateDeviceId();
        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);

        if (cachedToken) {
          // Re-register on every startup — ensures backend always has latest token
          await registerTokenWithBackend(deviceId, cachedToken);
          return;
        }

        // Try to get token — will only succeed if permission is already granted
        const result = await registerForPushNotificationsAsync();
        if (cancelled || !result.token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
        await registerTokenWithBackend(deviceId, result.token);
      } catch (err) {
        // Non-critical — app works fine without push notifications
        console.error('[PushNotifications] Startup error:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * Call this after the user grants notification permission (e.g. from Settings screen).
 * Fetches a fresh token and registers it with the backend.
 */
export async function refreshPushToken(): Promise<void> {
  try {
    // Clear cached token so registerForPushNotificationsAsync fetches a fresh one
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    const deviceId = await getOrCreateDeviceId();
    const result = await registerForPushNotificationsAsync();
    if (!result.token) return;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
    await registerTokenWithBackend(deviceId, result.token);
  } catch (err) {
    console.error('[PushNotifications] refreshPushToken error:', err);
  }
}
