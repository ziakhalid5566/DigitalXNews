/**
 * usePushNotifications
 *
 * Item 3: Fixed push token error — "Please set a valid API key. A Firebase
 * API key is required to communicate with Firebase server APIs."
 *
 * Root cause: The app is built with a placeholder google-services.json that
 * has no real Firebase API key. Expo's push service needs FCM to obtain a
 * push token on Android.
 *
 * Fix: The GitHub Actions workflow (android-build.yml) reads the real
 * google-services.json from the GOOGLE_SERVICES_JSON GitHub secret.
 * This hook handles errors gracefully and never crashes the app when
 * running without a real FCM key (e.g. in dev/emulator builds).
 *
 * To fix push notifications in production:
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Add Android app with package: com.digitalxnews.islamnashra
 *   3. Download google-services.json
 *   4. In GitHub repo → Settings → Secrets → add GOOGLE_SERVICES_JSON
 *      (paste the entire JSON content as the secret value)
 *   5. Re-run the Android build workflow
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

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Islam Nashra',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1565C0',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
  });
}

async function registerTokenWithBackend(deviceId: string, token: string): Promise<void> {
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

async function requestAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 33) return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: 'اطلاعات کی اجازت',
        message: 'اسلام نشرہ آپ کو بریکنگ نیوز کی فوری اطلاعات بھیجنا چاہتا ہے۔',
        buttonPositive: 'اجازت دیں',
        buttonNegative: 'انکار',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return true; // Fall through to expo-notifications check
  }
}

/**
 * Item 3: Returns an Expo push token for the device, or a human-readable
 * error explaining why it failed. Never throws — errors surface in `error`.
 *
 * Common failure: "Firebase API key is required" — this means the APK was
 * built with a placeholder google-services.json. See file header for fix.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      token: null,
      error: 'Push notifications require a physical device.',
    };
  }

  await setupAndroidChannel();

  // Request Android 13+ runtime permission first
  const androidGranted = await requestAndroidNotificationPermission();
  if (!androidGranted) {
    return {
      token: null,
      error: 'Notification permission denied. Enable in Settings → Apps → اسلام نشرہ → Notifications.',
    };
  }

  // Check / request via expo-notifications (handles iOS too)
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      android: {},
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return {
      token: null,
      error: 'Notification permission not granted. Please enable in device settings.',
    };
  }

  // Resolve EAS project ID
  const projectId: string | undefined =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
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

  // Get the Expo push token — may fail if google-services.json is a placeholder
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: tokenData.data, error: null };
  } catch (err) {
    const rawMessage =
      err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);

    // Item 3: Helpful message for the Firebase API key error
    let friendlyMessage = `Failed to get push token: ${rawMessage}`;
    if (rawMessage.includes('Firebase') || rawMessage.includes('API key')) {
      friendlyMessage =
        'Push notifications require a valid Firebase configuration. ' +
        'Please add the GOOGLE_SERVICES_JSON secret to your GitHub repository and rebuild the APK. ' +
        'See the android-build.yml workflow for setup instructions.';
    }

    console.error('[PushNotifications]', friendlyMessage);
    return { token: null, error: friendlyMessage };
  }
}

/**
 * Hook that runs on app startup:
 * 1. Sets up the Android notification channel.
 * 2. Registers for push notifications on physical devices.
 * 3. Persists the token in AsyncStorage.
 * 4. Registers the token with the Supabase backend.
 */
export function usePushNotifications(): void {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await setupAndroidChannel();

        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
        const deviceId = await getOrCreateDeviceId();

        if (cachedToken) {
          // Re-register with backend on every startup — tokens can change
          await registerTokenWithBackend(deviceId, cachedToken);
          return;
        }

        const result = await registerForPushNotificationsAsync();
        if (cancelled || !result.token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, result.token);
        await registerTokenWithBackend(deviceId, result.token);
      } catch (err) {
        // Non-critical — app works fine without push notifications
        console.error('[PushNotifications] Startup registration error:', err);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);
}
