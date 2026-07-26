import React, { useCallback, useEffect, useState } from 'react';
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
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { SplashAnimation } from '@/components/SplashAnimation';

// How push notifications are handled when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Prevent the native splash screen from auto-hiding before fonts load.
SplashScreen.preventAutoHideAsync();

// Base URL removed — app now reads directly from Supabase SDK

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

/** Requests push permission on very first launch, then registers silently. */
function AppWithPush() {
  usePushNotifications();

  // First-launch notification permission request
  useEffect(() => {
    const ASKED_KEY = '@notif_permission_asked';
    (async () => {
      try {
        const asked = await import('@react-native-async-storage/async-storage')
          .then((m) => m.default.getItem(ASKED_KEY));
        if (asked) return; // already asked
        // Mark as asked immediately so we never show twice
        const AS = (await import('@react-native-async-storage/async-storage')).default;
        await AS.setItem(ASKED_KEY, '1');
        // Small delay so the UI is fully loaded before the system dialog appears
        await new Promise((r) => setTimeout(r, 1500));
        const { status: existing } = await Notifications.getPermissionsAsync();
        if (existing === 'granted') return; // already have permission
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
      } catch {}
    })();
  }, []);

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

  // Hide the native OS splash once fonts are ready
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const handleSplashDone = useCallback(() => {
    setShowSplash(false);
  }, []);

  // Don't render anything until fonts are ready
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <NotificationsProvider>
              <AppWithPush />
              {/* Animated intro — overlaid on top until done */}
              {showSplash && <SplashAnimation onDone={handleSplashDone} />}
            </NotificationsProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
