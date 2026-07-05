import { createContext } from 'react';

// Theme is purely presentational. The user's *preference* is one of three
// values; 'system' is resolved to an actual light/dark theme via the OS media
// query. The resolved value is what gets written to <html data-theme> and what
// the CSS variable overrides key off. Mirrors the AuthContext/AuthProvider/
// useAuth split so the provider file only exports a component.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

export const THEME_STORAGE_KEY = 'oa-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const isPreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

export const systemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
};

export const readStoredPreference = (): ThemePreference => {
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    // Storage can throw in locked-down / private contexts.
    return 'system';
  }
};

export const storePreference = (preference: ThemePreference): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable — keep the in-memory choice for this session.
  }
};

export const resolvePreference = (preference: ThemePreference): ResolvedTheme =>
  preference === 'system' ? systemTheme() : preference;

export const applyResolvedTheme = (resolved: ResolvedTheme): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  // Keep native form controls / scrollbars in step with the chosen theme.
  root.style.colorScheme = resolved;
};

// Subscribe to OS theme changes while following 'system'. Returns an
// unsubscribe function. MediaQueryList.addEventListener is supported across all
// current browsers (Safari 14+).
export const subscribeToSystemTheme = (
  listener: (resolved: ResolvedTheme) => void,
): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {
      /* no media-query support — nothing to clean up */
    };
  }
  const mql = window.matchMedia(DARK_QUERY);
  const handler = (): void => {
    listener(mql.matches ? 'dark' : 'light');
  };
  mql.addEventListener('change', handler);
  return () => {
    mql.removeEventListener('change', handler);
  };
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);
