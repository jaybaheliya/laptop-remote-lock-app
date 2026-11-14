import { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useColorScheme } from 'react-native';
import { saveThemePreference, getThemePreference } from '@/lib/theme-preference';
import { Colors, Spacing } from '@/constants/theme';

type Mode = 'light' | 'dark' | 'system';

/**
 * A small, self-contained theme toggle.
 *
 * It reads the *user preference* (not the resolved system scheme) so the
 * user can force light or dark regardless of device settings. On first
 * render it hydrates the stored preference; until then it follows the
 * system scheme to avoid a flash of the wrong theme.
 */
export function ThemeToggle() {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<Mode>('system');

  useEffect(() => {
    let active = true;
    getThemePreference().then((stored) => {
      if (active && stored) setPreference(stored as Mode);
    });
    return () => {
      active = false;
    };
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const colors = Colors[resolved];

  function next() {
    const order: Mode[] = ['system', 'light', 'dark'];
    const nextMode = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(nextMode);
    saveThemePreference(nextMode).catch(() => {
      /* best-effort persistence; UI still works without it */
    });
  }

  const label =
    preference === 'system'
      ? 'Theme: system'
      : preference === 'light'
      ? 'Theme: light'
      : 'Theme: dark';

  return (
    <TouchableOpacity
      onPress={next}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: colors.surfaceHover,
        borderWidth: 1,
        borderColor: colors.border,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ThemeIcon mode={preference} resolved={resolved} />
      </View>
    </TouchableOpacity>
  );
}

function ThemeIcon({ mode, resolved }: { mode: Mode; resolved: 'light' | 'dark' }) {
  const colors = Colors[resolved];
  const dot = resolved === 'dark' ? '#38bdf8' : '#fbbf24';
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: dot,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    />
  );
}

export default ThemeToggle;