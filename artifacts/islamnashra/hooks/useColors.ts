import colors from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Returns the design tokens for the current color scheme.
 * Reads from ThemeContext so the user can override system dark/light mode
 * from the Settings page. Falls back to the light palette when needed.
 */
export function useColors() {
  const { isDark } = useTheme();
  const palette = isDark ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
