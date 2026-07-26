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
import { Platform, PermissionsAndroid } from 'react-native';

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
    lightColor: '#1565C0',
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
 * Result type returned by registerForPushNotificationsAsync.
 * On success, token is set. On failure, token is null and error describes why.
 */
export interface PushRegistrationResult {
  token: string | null;
  /** Human-readable reason for failure, or null on success. */
  error: string | null;
}

/**
 * Request Android 13+ (API 33) POST_NOTIFICATIONS runtime permission explicitly.
 * expo-notifications' requestPermissionsAsync handles this on most devices, but
 * calling PermissionsAndroid.request first ensures the system dialog appears on
 * devices running Android 13+ where the permission might otherwise be silently
 * denied without a dialog.
 */
async function requestAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // Android 13+ (API level 33) requires POST_NOTIFICATIONS runtime permission.
  // On older Android versions this permission doesn't exist, so we check first.
  if (Platform.Version < 33) {
    // Notifications don't need a runtime permission below Android 13.
    return true;
  }

  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: 'اطلاع کی اجازت',
        message: 'DigitalXNews آپ کو بریکنگ نیوز کی فوری اطلاعات بھیجنا چاہتا ہے۔',
        buttonPositive: 'اجازت دیں',
        buttonNegative: 'انکار',
      },
    );
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    if (!granted) {
      console.warn('[PushNotifications] Android POST_NOTIFICATIONS permission denied by user');
    }
    return granted;
  } catch (err) {
    console.warn('[PushNotifications] Error requesting Android permission:', err);
    // Fall through to expo-notifications permission request even if this fails.
    return true;
  }
}

/**
 * Returns an Expo push token for the device, or an error message explaining
 * why registration failed.  Never throws — all errors are returned in the
 * `error` field so callers can surface the actual reason to the user.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    const error = 'Push notifications require a physical device. Simulators and emulators cannot receive push notifications.';
    console.warn('[PushNotifications]', error);
    return { token: null, error };
  }

  // Set up Android channel first
  await setupAndroidChannel();

  // Step 1: Request Android 13+ runtime permission (PermissionsAndroid).
  // This shows the system dialog before we call expo-notifications' permission API.
  const androidGranted = await requestAndroidNotificationPermission();
  if (!androidGranted) {
    const error = 'Notification permission was denied. Please enable it in your device Settings → Apps → DigitalXNews → Notifications.';
    return { token: null, error };
  }

  // Step 2: Check / request permissions via expo-notifications API.
  // This handles iOS and also acts as the canonical check on Android.
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      android: {},
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    const error =
      `Notification permission status: "${finalStatus}". ` +
      'Please enable notifications in your device Settings → Apps → DigitalXNews → Notifications.';
    console.warn('[PushNotifications]', error);
    return { token: null, error };
  }

  // Step 3: Resolve EAS project ID — checked in order of precedence:
  //   1. EXPO_PUBLIC_EAS_PROJECT_ID env var (set at build time in eas.json env block)
  //   2. extra.eas.projectId in app.json
  //   3. Constants.easConfig.projectId (auto-injected by EAS)
  const projectId: string | undefined =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas
      ?.projectId as string | undefined ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    const error =
      'No EAS project ID found. ' +
      'Add extra.eas.projectId in app.json or set EXPO_PUBLIC_EAS_PROJECT_ID. ' +
      'Create a free project at https://expo.dev to get one.';
    console.warn('[PushNotifications]', error);
    return { token: null, error };
  }

  // Step 4: Get the Expo push token.
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[PushNotifications] Got push token:', tokenData.data);
    return { token: tokenData.data, error: null };
  } catch (err) {
    // Capture the full error message to surface it to the user.
    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err);
    const error = `Failed to get push token: ${rawMessage}`;
    console.error('[PushNotifications]', error);
    return { token: null, error };
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

        const result = await registerForPushNotificationsAsync();
        if (cancelled || !result.token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
        console.log('[PushNotifications] Token saved to AsyncStorage:', result.token);

        // Register with Supabase so the server can send pushes to this device
        await registerTokenWithBackend(deviceId, result.token);
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
