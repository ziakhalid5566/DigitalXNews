/**
 * usePushNotifications
 *
 * Requests notification permissions, obtains an Expo push token,
 * and persists it in AsyncStorage (no backend required).
 *
 * Requirements for real push delivery in Expo Go:
 *   1. Physical device (Android or iOS) — simulators cannot receive push.
 *   2. EXPO_PUBLIC_EAS_PROJECT_ID env var OR `extra.eas.projectId` in app.json.
 *      Create a free project at https://expo.dev and copy the project ID.
 *   3. User must be logged into the Expo Go app on their device.
 */

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = 'pushToken';

/**
 * Returns the Expo push token for the device, or null if permissions
 * are denied or we are running on a simulator / web.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[PushNotifications] Must use a physical device for push notifications.');
    return null;
  }

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

  // Resolve the EAS project ID
  const projectId: string | undefined =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas?.projectId as string | undefined ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn(
      '[PushNotifications] No EAS project ID found. ' +
      'Set EXPO_PUBLIC_EAS_PROJECT_ID or add extra.eas.projectId in app.json. ' +
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
 * Hook that runs on app startup to register the device's push token
 * in AsyncStorage for later use.
 */
export function usePushNotifications(): void {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
        if (cachedToken) return;

        const token = await registerForPushNotificationsAsync();
        if (cancelled || !token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
        console.log('[PushNotifications] Token saved:', token);
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
