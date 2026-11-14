/**
 * Theme hook.
 *
 * Returns the resolved color palette for the current color scheme. The
 * controller UI is dark-first, but all colors come from this hook so the
 * same components render correctly in light mode on supported devices.
 */

import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { Colors, ThemeColors } from '@/constants/theme';

export type ThemeMode = 'light' | 'dark';

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return useMemo(() => {
    if (scheme === 'dark') return Colors.dark;
    return Colors.light;
  }, [scheme]);
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}