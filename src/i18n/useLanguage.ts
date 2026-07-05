import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLanguageAttr, isLanguage, storeLanguage, type Language } from './language';

interface LanguageController {
  readonly language: Language;
  readonly setLanguage: (next: Language) => void;
}

// Thin wrapper over react-i18next: reads the current locale and exposes a setter
// that also persists the choice and updates <html lang> — the three side effects
// that must always happen together when the language changes.
export const useLanguage = (): LanguageController => {
  const { i18n } = useTranslation();
  const current = isLanguage(i18n.language) ? i18n.language : 'en';

  const setLanguage = useCallback(
    (next: Language) => {
      void i18n.changeLanguage(next);
      storeLanguage(next);
      applyLanguageAttr(next);
    },
    [i18n],
  );

  return { language: current, setLanguage };
};
