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
import { ThemeProvider } from '@/contexts/ThemeContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { SplashAnimation } from '@/components/SplashAnimation';

// Foreground notification handler
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
 * Handles push notification registration on first launch.
 * Shows the native Android/iOS permission dialog once, on first open.
 */
function AppWithPush() {
  usePushNotifications();

  // Item 4: Show native notification permission dialog on very first launch
  useEffect(() => {
    const ASKED_KEY = '@notif_permission_asked_v2';
    (async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const asked = await AsyncStorage.getItem(ASKED_KEY);
        if (asked) return;
        // Mark immediately so we never double-show
        await AsyncStorage.setItem(ASKED_KEY, '1');
        // Wait for UI to settle before showing the dialog
        await new Promise((r) => setTimeout(r, 1800));
        const { status: existing } = await Notifications.getPermissionsAsync();
        if (existing === 'granted') return;
        await Notifications.requestPermissionsAsync({
          android: {},
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
      } catch {
        // Silently ignore — non-critical
      }
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const handleSplashDone = useCallback(() => {
    setShowSplash(false);
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <LanguageProvider>
              <NotificationsProvider>
                <AppWithPush />
                {showSplash && <SplashAnimation onDone={handleSplashDone} />}
              </NotificationsProvider>
            </LanguageProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
