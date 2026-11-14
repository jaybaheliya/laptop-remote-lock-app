import { DarkTheme, DefaultTheme, Stack, ThemeProvider as RouterThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemeProvider, useAppTheme } from '@/theme/provider';

SplashScreen.preventAutoHideAsync();

function AppShell() {
  const { resolved, colors } = useAppTheme();

  // Keep the OS-level chrome (status bar, nav bar) in sync with the theme.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <RouterThemeProvider
      value={{
        ...(resolved === 'dark' ? DarkTheme : DefaultTheme),
        colors: {
          ...(resolved === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          primary: colors.primary,
        },
      }}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="explore" options={{ headerShown: false }} />
      </Stack>
    </RouterThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}