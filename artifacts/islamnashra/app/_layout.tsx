import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { usePushNotifications, refreshPushToken } from '@/hooks/usePushNotifications';
import { SplashAnimation } from '@/components/SplashAnimation';

// Foreground notification handler — show alerts even when app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Handles push notification registration.
 * Permission is asked AFTER the splash animation finishes so the user
 * sees the app UI first — this dramatically improves accept rates.
 */
function AppWithPush({ splashDone }: { splashDone: boolean }) {
  usePushNotifications();
  const askedRef = useRef(false);

  useEffect(() => {
    // Only ask once, and only AFTER the splash is gone
    if (!splashDone || askedRef.current) return;
    askedRef.current = true;

    const ASKED_KEY = '@notif_permission_asked_v3';

    (async () => {
      try {
        const AsyncStorage = (
          await import('@react-native-async-storage/async-storage')
        ).default;

        const asked = await AsyncStorage.getItem(ASKED_KEY);
        if (asked) return;

        // Small delay so the home feed is visible before the dialog appears
        await new Promise<void>((r) => setTimeout(r, 800));

        const { status: existing } = await Notifications.getPermissionsAsync();
        if (existing === 'granted') {
          // Already granted — mark so we never ask again and exit
          await AsyncStorage.setItem(ASKED_KEY, '1');
          return;
        }

        // Show the native OS permission dialog
        const { status: newStatus } = await Notifications.requestPermissionsAsync({
          android: {},
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });

        // Mark as asked regardless of outcome (don't spam the user)
        await AsyncStorage.setItem(ASKED_KEY, '1');

        // ── CRITICAL FIX ──────────────────────────────────────────────────────
        // usePushNotifications() ran on mount — BEFORE permission was granted.
        // It found no permission and returned without a token.
        // Now that the user just granted permission, we must fetch the token
        // immediately. Without this call, the token is only registered on the
        // NEXT app launch, so the first session never receives push notifications.
        if (newStatus === 'granted') {
          void refreshPushToken();
        }
      } catch {
        // Non-critical — silently ignore
      }
    })();
  }, [splashDone]);

  return (
    <GestureHandlerRootView>
      <KeyboardProvider>
        <RootLayoutNav />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [showSplash, setShowSplash] = useState(true);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const handleSplashDone = useCallback(() => {
    setShowSplash(false);
    setSplashDone(true);
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <LanguageProvider>
              <NotificationsProvider>
                <AppWithPush splashDone={splashDone} />
                {showSplash && <SplashAnimation onDone={handleSplashDone} />}
              </NotificationsProvider>
            </LanguageProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
