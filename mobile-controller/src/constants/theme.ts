/**
 * Design tokens for the Laptop Remote Lock controller.
 *
 * Everything visual is derived from these tokens so the app can support
 * light and dark modes from a single source of truth. Prefer importing
 * `useTheme` / `useColors` in components instead of hardcoding hex values.
 */

import { StyleSheet } from 'react-native';
import { Platform } from 'react-native';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  surfaceActive: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  chart: string;
  overlay: string;
  backgroundElement: string;
  backgroundSelected: string;
};

export const Colors: Record<'light' | 'dark', ThemeColors> = {
  light: {
    // Surfaces
    background: '#f8fafc',
    surface: '#ffffff',
    surfaceElevated: '#ffffff',
    surfaceHover: '#f1f5f9',
    surfaceActive: '#e2e8f0',
    // Text
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    textOnPrimary: '#ffffff',
    // Borders
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    // Legacy aliases used by the starter ThemedView/ThemedText components.
    // Kept so the template UI keeps rendering; prefer surfaceHover/surfaceActive.
    backgroundElement: '#f1f5f9',
    backgroundSelected: '#e2e8f0',
    // Brand / accent
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    primarySoft: '#dbeafe',
    // Status
    success: '#16a34a',
    successSoft: '#dcfce7',
    warning: '#d97706',
    warningSoft: '#fef3c7',
    danger: '#dc2626',
    dangerSoft: '#fee2e2',
    // Chart / misc
    chart: '#6366f1',
    overlay: 'rgba(15, 23, 42, 0.45)',
  },
  dark: {
    // Surfaces
    background: '#090d16',
    surface: '#0b1220',
    surfaceElevated: '#111827',
    surfaceHover: '#162032',
    surfaceActive: '#1e293b',
    // Text
    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
    textOnPrimary: '#ffffff',
    // Borders
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    // Legacy aliases used by the starter ThemedView/ThemedText components.
    // Kept so the template UI keeps rendering; prefer surfaceHover/surfaceActive.
    backgroundElement: '#162032',
    backgroundSelected: '#1e293b',
    // Brand / accent
    primary: '#38bdf8',
    primaryHover: '#0ea5e9',
    primarySoft: 'rgba(56, 189, 248, 0.15)',
    // Status
    success: '#34d399',
    successSoft: 'rgba(52, 211, 153, 0.12)',
    warning: '#fbbf24',
    warningSoft: 'rgba(251, 191, 36, 0.12)',
    danger: '#f87171',
    dangerSoft: 'rgba(248, 113, 113, 0.12)',
    // Chart / misc
    chart: '#60a5fa',
    overlay: 'rgba(2, 6, 23, 0.78)',
  },
} as const;

export type ThemeColor = keyof ThemeColors;

export const Spacing = {
  none: 0,
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 48,
  seven: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  full: 9999,
} as const;

export const Typography = {
  display: { fontSize: 26, fontWeight: '900' as const, letterSpacing: -0.5 },
  title: { fontSize: 16, fontWeight: '800' as const },
  body: { fontSize: 14, fontWeight: '600' as const },
  bodyMuted: { fontSize: 13, fontWeight: '500' as const },
  small: { fontSize: 12, fontWeight: '700' as const },
  caption: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6 },
  micro: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.8 },
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 560;

/**
 * A small helper for creating theme-aware StyleSheet entries. Using this
 * instead of raw `StyleSheet.create` keeps the tokens resolvable at runtime
 * even when the active theme changes after initial render.
 */
export function themedStyles<T extends Record<string, any>>(
  builder: (colors: ThemeColors) => T,
) {
  return builder;
}