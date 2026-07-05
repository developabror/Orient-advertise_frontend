import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@hooks/useTheme';
import { type ThemePreference } from '@/theme/theme';

const SunIcon = () => (
  <svg
    className="oa-theme-toggle__icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg
    className="oa-theme-toggle__icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon = () => (
  <svg
    className="oa-theme-toggle__icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

interface ThemeOption {
  readonly value: ThemePreference;
  // i18n key under `theme.*`; resolved at render time.
  readonly labelKey: string;
  readonly icon: ReactNode;
}

const OPTIONS: readonly ThemeOption[] = [
  { value: 'light', labelKey: 'theme.light', icon: <SunIcon /> },
  { value: 'dark', labelKey: 'theme.dark', icon: <MoonIcon /> },
  { value: 'system', labelKey: 'theme.system', icon: <MonitorIcon /> },
];

interface Props {
  // Icon-only (labels visually hidden) for tight bars like the topbar.
  readonly compact?: boolean;
}

export const ThemeToggle = ({ compact = false }: Props) => {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  return (
    <div
      className={`oa-theme-toggle${compact ? ' oa-theme-toggle--compact' : ''}`}
      role="group"
      aria-label={t('theme.label')}
    >
      {OPTIONS.map((option) => {
        const active = preference === option.value;
        const label = t(option.labelKey);
        return (
          <button
            key={option.value}
            type="button"
            className={`oa-theme-toggle__btn${active ? ' oa-theme-toggle__btn--active' : ''}`}
            aria-pressed={active}
            title={label}
            onClick={() => {
              setPreference(option.value);
            }}
          >
            {option.icon}
            <span className="oa-theme-toggle__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
};
