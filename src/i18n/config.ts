import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ru } from './locales/ru';
import { uz } from './locales/uz';
import { pagesEn, pagesRu, pagesUz } from './locales/pages';
import { DEFAULT_LANGUAGE, applyLanguageAttr, readStoredLanguage } from './language';

// Single shared i18next instance. Resources are bundled inline (the string set
// is modest), so there's no async load and no Suspense boundary to manage —
// `useSuspense: false` keeps first paint synchronous. English is the fallback
// for any key missing in ru/uz. The initial language comes from localStorage
// (mirrors how ThemeProvider seeds the theme).
//
// `en`/`ru`/`uz` are the app-shell strings (nav, login, dashboard, …); the
// per-page/component namespaces are aggregated in ./locales/pages and merged in
// on top, each under its own `<namespace>` key.

const initialLanguage = readStoredLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, ...pagesEn } },
    ru: { translation: { ...ru, ...pagesRu } },
    uz: { translation: { ...uz, ...pagesUz } },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes rendered values — double-escaping would corrupt
    // interpolated names/times.
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

applyLanguageAttr(initialLanguage);

export default i18n;
