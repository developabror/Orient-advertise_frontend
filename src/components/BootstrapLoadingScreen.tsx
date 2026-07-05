import { useTranslation } from 'react-i18next';

import { Spinner } from './ui/Spinner';

export const BootstrapLoadingScreen = () => {
  const { t } = useTranslation();

  return (
    <div className="oa-bootstrap" role="status" aria-live="polite">
      <div className="oa-bootstrap__inner">
        <span className="oa-bootstrap__brand">Orient Advertise</span>
        <Spinner size="lg" label={t('bootstrapLoadingScreen.restoringSession')} />
        <span className="oa-bootstrap__hint">{t('bootstrapLoadingScreen.restoringSessionHint')}</span>
      </div>
    </div>
  );
};
