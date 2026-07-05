import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@/i18n/language';
import { useLanguage } from '@/i18n/useLanguage';

interface Props {
  // Icon/code-only (full names visually hidden) for tight bars like the topbar.
  readonly compact?: boolean;
}

// Segmented EN / RU / UZ control. Reuses the theme-toggle's pill styling so the
// two preference controls read as a matched set in the topbar; the accessible
// name for each button is the language's full endonym, not the short code.
export const LanguageSwitcher = ({ compact = false }: Props) => {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  return (
    <div
      className={`oa-theme-toggle${compact ? ' oa-theme-toggle--compact' : ''}`}
      role="group"
      aria-label={t('language.label')}
    >
      {LANGUAGES.map((option) => {
        const active = language === option.value;
        const fullName = t(`language.${option.value}`);
        return (
          <button
            key={option.value}
            type="button"
            className={`oa-theme-toggle__btn${active ? ' oa-theme-toggle__btn--active' : ''}`}
            aria-pressed={active}
            title={fullName}
            aria-label={fullName}
            onClick={() => {
              setLanguage(option.value);
            }}
          >
            <span className="oa-lang-switcher__code">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
