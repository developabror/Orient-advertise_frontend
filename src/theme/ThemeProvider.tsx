import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ThemeContext,
  applyResolvedTheme,
  readStoredPreference,
  resolvePreference,
  storePreference,
  subscribeToSystemTheme,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemePreference,
} from './theme';

interface Props {
  readonly children: ReactNode;
}

export const ThemeProvider = ({ children }: Props) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolvePreference(preference));

  // Mirror the resolved theme onto <html> (data-theme + native color-scheme).
  // The boot script in index.html sets this before first paint to avoid a
  // flash; this keeps it correct across React-driven changes.
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // While following the OS ('system'), recompute now and track live changes.
  useEffect(() => {
    if (preference !== 'system') return;
    setResolved(resolvePreference('system'));
    return subscribeToSystemTheme(setResolved);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    storePreference(next);
    const nextResolved = resolvePreference(next);
    setPreferenceState(next);
    setResolved(nextResolved);
    // Apply synchronously so a same-tick reader (e.g. the uptime chart, which
    // samples CSS variables) sees the new tokens immediately, not one render
    // later.
    applyResolvedTheme(nextResolved);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
