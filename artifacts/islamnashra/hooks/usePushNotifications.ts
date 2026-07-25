/**
 * usePushNotifications
 *
 * Requests notification permissions, obtains an Expo push token, persists it
 * in AsyncStorage, and registers it with the Supabase backend so the server
 * can deliver push notifications to this device.
 *
 * Requirements for push delivery in a standalone APK:
 *   1. Physical device — simulators cannot receive push.
 *   2. `extra.eas.projectId` in app.json (create a free project at expo.dev).
 *   3. For Android: Google FCM credentials configured in EAS (google-services.json).
 *   4. EXPO_PUBLIC_EAS_PROJECT_ID env var OR extra.eas.projectId takes effect at
 *      build time — make sure it is set before running `eas build`.
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

// We create a thin supabase client here just for the push-token upsert.
// It uses the same anon key the rest of the app uses.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase && supabaseUrl && supabaseAnonKey) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return _supabase;
}

/**
 * Get or generate a stable device ID stored in AsyncStorage.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Set up the Android notification channel. Must be called before any
 * notification is displayed on Android.
 */
async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'DigitalXNews',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1a5c38',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
  });
}

/**
 * Register push token with Supabase user_preferences so the backend can
 * send push notifications to this device.
 */
async function registerTokenWithBackend(deviceId: string, token: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[PushNotifications] Supabase not configured — skipping backend registration');
    return;
  }
  try {
    const { error } = await sb
      .from('user_preferences')
      .upsert(
        {
          device_id: deviceId,
          push_token: token,
          notifications_enabled: true,
        },
        { onConflict: 'device_id' },
      );
    if (error) {
      console.error('[PushNotifications] Backend registration error:', error.message);
    } else {
      console.log('[PushNotifications] Token registered with backend for device:', deviceId);
    }
  } catch (err) {
    console.error('[PushNotifications] Backend registration failed:', err);
  }
}

/**
 * Returns the Expo push token for the device, or null if permissions
 * are denied or we are running on a simulator/web.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[PushNotifications] Must use a physical device for push notifications.');
    return null;
  }

  // Set up Android channel first
  await setupAndroidChannel();

  // Check / request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[PushNotifications] Permission not granted for push notifications.');
    return null;
  }

  // Resolve EAS project ID — checked in order of precedence:
  //   1. EXPO_PUBLIC_EAS_PROJECT_ID env var (set at build time in eas.json env block)
  //   2. extra.eas.projectId in app.json
  //   3. Constants.easConfig.projectId (auto-injected by EAS)
  const projectId: string | undefined =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas
      ?.projectId as string | undefined ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn(
      '[PushNotifications] No EAS project ID found. ' +
        'Add extra.eas.projectId in app.json or set EXPO_PUBLIC_EAS_PROJECT_ID. ' +
        'Create a free project at https://expo.dev to get one.',
    );
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch (err) {
    console.error('[PushNotifications] Failed to get push token:', err);
    return null;
  }
}

/**
 * Hook that runs on app startup to:
 *  1. Set up the Android notification channel.
 *  2. Register for push notifications on physical devices.
 *  3. Persist the token in AsyncStorage.
 *  4. Register the token with the Supabase backend (upserts user_preferences).
 */
export function usePushNotifications(): void {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // Always set up Android channel, even if already registered
        await setupAndroidChannel();

        // Check if we already have a registered token
        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
        const deviceId = await getOrCreateDeviceId();

        if (cachedToken) {
          // Re-register with backend on every startup to ensure the token is
          // current — Expo tokens can change after OS reinstalls or app updates.
          await registerTokenWithBackend(deviceId, cachedToken);
          return;
        }

        const token = await registerForPushNotificationsAsync();
        if (cancelled || !token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
        console.log('[PushNotifications] Token saved to AsyncStorage:', token);

        // Register with Supabase so the server can send pushes to this device
        await registerTokenWithBackend(deviceId, token);
      } catch (err) {
        console.error('[PushNotifications] Startup registration error:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
