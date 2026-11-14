import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Colors, ThemeColors } from '@/constants/theme';
import { getThemePreference, saveThemePreference } from '@/lib/theme-preference';

export type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useAppTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used inside a ThemeProvider');
  }
  return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    getThemePreference().then((stored) => {
      if (active && stored) setModeState(stored as ThemeMode);
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemePreference(next).catch(() => {
      /* persistence is best-effort */
    });
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const order: ThemeMode[] = ['system', 'light', 'dark'];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      saveThemePreference(next).catch(() => {
        /* persistence is best-effort */
      });
      return next;
    });
  }, []);

  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const colors = Colors[resolved];

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, colors, setMode, toggle }),
    [mode, resolved, colors, setMode, toggle],
  );

  // While hydrating, fall back to the system scheme so we don't flash the
  // wrong theme before the stored preference is read.
  if (!hydrated) {
    const fallbackResolved = systemScheme === 'dark' ? 'dark' : 'light';
    const fallbackColors: ThemeColors =
      fallbackResolved === 'dark' ? Colors.dark : Colors.light;
    return (
      <ThemeContext.Provider
        value={{
          mode: 'system',
          resolved: fallbackResolved,
          colors: fallbackColors,
          setMode,
          toggle,
        }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export default ThemeProvider;