import { useTranslation } from 'react-i18next';

export type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
}

export const Spinner = ({ size = 'md', label }: SpinnerProps) => {
  const { t } = useTranslation();
  return (
    <span className={`oa-spinner oa-spinner--${size}`} role="status" aria-label={label ?? t('uiSpinner.loading')}>
      <span className="oa-spinner__ring" aria-hidden="true" />
    </span>
  );
};
