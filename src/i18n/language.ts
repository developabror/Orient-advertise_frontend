// Language is purely presentational, like the theme. The user's choice is one
// of three fixed locales; English is both the source of truth and the fallback
// when a key is missing in another locale. Mirrors the theme.ts persistence
// helpers (localStorage + a graceful fallback for locked-down contexts) so the
// two preference systems behave identically.

export type Language = 'en' | 'ru' | 'uz';

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'oa-language';

export interface LanguageOption {
  readonly value: Language;
  // Endonym — each language is labelled in its own script so a user who
  // landed in the wrong locale can still recognise their own.
  readonly label: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { value: 'en', label: 'EN' },
  { value: 'ru', label: 'RU' },
  { value: 'uz', label: 'UZ' },
];

export const isLanguage = (value: unknown): value is Language =>
  value === 'en' || value === 'ru' || value === 'uz';

export const readStoredLanguage = (): Language => {
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Storage can throw in locked-down / private contexts.
    return DEFAULT_LANGUAGE;
  }
};

export const storeLanguage = (language: Language): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage unavailable — keep the in-memory choice for this session.
  }
};

// Keep <html lang> in step with the chosen locale for a11y / SEO. The boot
// script in index.html could set this pre-paint later; for now React owns it.
export const applyLanguageAttr = (language: Language): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', language);
};
