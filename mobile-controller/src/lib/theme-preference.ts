import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const THEME_PREFERENCE_KEY = 'laptop-lock-theme-preference';

type Mode = 'light' | 'dark' | 'system';

const memoryFallback: { current: Mode | null } = { current: null };

function canUseSecureStore(): boolean {
  return Platform.OS !== 'web';
}

export async function getThemePreference(): Promise<Mode | null> {
  if (canUseSecureStore()) {
    try {
      const value = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
      return (value as Mode) ?? null;
    } catch {
      // Fall back to memory on any secure-store failure.
    }
  }
  return memoryFallback.current;
}

export async function saveThemePreference(mode: Mode): Promise<void> {
  if (canUseSecureStore()) {
    try {
      await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, mode);
      return;
    } catch {
      // Fall back to memory on any secure-store failure.
    }
  }
  memoryFallback.current = mode;
}

export async function clearThemePreference(): Promise<void> {
  memoryFallback.current = null;
  if (canUseSecureStore()) {
    try {
      await SecureStore.deleteItemAsync(THEME_PREFERENCE_KEY);
    } catch {
      /* best-effort */
    }
  }
}

export type { Mode };