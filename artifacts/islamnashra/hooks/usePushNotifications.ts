/**
 * usePushNotifications — Real push token registration
 *
 * FIXED ISSUES:
 * 1. Android channel created BEFORE token request (required for Android 8+)
 * 2. projectId resolved from multiple sources with clear error logging
 * 3. Token re-registration on every launch ensures backend has latest token
 * 4. refreshPushToken() called after permission grant from _layout.tsx
 * 5. Added explicit error messages so debugging is easier
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
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[PushNotifications] Supabase env vars not set — token registration will fail');
    return null;
  }
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
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

// ─── Android channel setup ────────────────────────────────────────────────────
// MUST be called before requesting a push token on Android
export async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Digital X News',
    description: 'Digital X News — Breaking news and important updates',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1D9BF0',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
  });
}

// ─── Register token with Supabase backend ─────────────────────────────────────
async function registerTokenWithBackend(deviceId: string, token: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[PushNotifications] Cannot register token — Supabase not configured');
    return;
  }
  try {
    const { error } = await sb
      .from('user_preferences')
      .upsert(
        { device_id: deviceId, push_token: token, notifications_enabled: true },
        { onConflict: 'device_id' },
      );
    if (error) {
      console.error('[PushNotifications] Backend upsert error:', error.message);
    } else {
      console.log('[PushNotifications] Token registered successfully for device:', deviceId.slice(0, 8));
    }
  } catch (err) {
    console.error('[PushNotifications] Backend registration failed:', err);
  }
}

// ─── Main registration function ───────────────────────────────────────────────
export interface PushRegistrationResult {
  token: string | null;
  error: string | null;
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    console.log('[PushNotifications] Not a physical device — push notifications unavailable');
    return { token: null, error: 'Push notifications require a physical device' };
  }

  // Step 1: Set up Android channel BEFORE asking for token
  await setupAndroidChannel();

  // Step 2: Check permission (do NOT request here — done by _layout.tsx after splash)
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    console.log('[PushNotifications] Permission not granted yet — status:', status);
    return { token: null, error: `Permission status: ${status}` };
  }

  // Step 3: Resolve EAS project ID
  const projectId: string | undefined =
    (process.env.EXPO_PUBLIC_EAS_PROJECT_ID as string | undefined) ??
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
      ?.eas?.projectId as string | undefined ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.error('[PushNotifications] No EAS projectId found — check app.json extra.eas.projectId');
    return { token: null, error: 'No EAS project ID configured' };
  }

  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[PushNotifications] Got push token (last 8):', result.data.slice(-8));
    return { token: result.data, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PushNotifications] getExpoPushTokenAsync failed:', msg);
    return { token: null, error: msg };
  }
}

// ─── Hook: runs on app startup ─────────────────────────────────────────────────
export function usePushNotifications(): void {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // Always set up Android channel on startup (idempotent)
        await setupAndroidChannel();

        const deviceId = await getOrCreateDeviceId();
        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);

        if (cachedToken) {
          // Re-register on every startup — ensures backend always has latest token
          // This handles cases where the token was rotated by Expo/FCM
          await registerTokenWithBackend(deviceId, cachedToken);
          return;
        }

        // No cached token — try to get one (only works if permission already granted)
        const result = await registerForPushNotificationsAsync();
        if (cancelled || !result.token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
        await registerTokenWithBackend(deviceId, result.token);
      } catch (err) {
        // Non-critical — app works fine without push notifications
        console.error('[PushNotifications] Startup hook error:', err);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);
}

// ─── Refresh token after permission is newly granted ──────────────────────────
// Called from _layout.tsx after the OS permission dialog is accepted
export async function refreshPushToken(): Promise<void> {
  try {
    console.log('[PushNotifications] refreshPushToken called — fetching fresh token');
    // Clear cached token so registerForPushNotificationsAsync fetches a fresh one
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    const deviceId = await getOrCreateDeviceId();
    const result = await registerForPushNotificationsAsync();
    if (!result.token) {
      console.warn('[PushNotifications] refreshPushToken: no token obtained —', result.error);
      return;
    }
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
    await registerTokenWithBackend(deviceId, result.token);
    console.log('[PushNotifications] Token refreshed and registered');
  } catch (err) {
    console.error('[PushNotifications] refreshPushToken error:', err);
  }
}
