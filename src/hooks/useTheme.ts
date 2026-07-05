import { useContext } from 'react';
import {
  ThemeContext,
  applyResolvedTheme,
  readStoredPreference,
  resolvePreference,
  storePreference,
  type ThemeContextValue,
  type ThemePreference,
} from '@/theme/theme';

// Unlike useAuth (which requires its provider), useTheme degrades gracefully:
// when no <ThemeProvider> is mounted it returns a working — if non-reactive —
// controller backed directly by localStorage + <html>. That keeps standalone
// renders and unit tests from crashing while still letting the theme flip.
const standalone = (): ThemeContextValue => {
  const preference = readStoredPreference();
  return {
    preference,
    resolved: resolvePreference(preference),
    setPreference: (next: ThemePreference) => {
      storePreference(next);
      applyResolvedTheme(resolvePreference(next));
    },
  };
};

export const useTheme = (): ThemeContextValue => useContext(ThemeContext) ?? standalone();
