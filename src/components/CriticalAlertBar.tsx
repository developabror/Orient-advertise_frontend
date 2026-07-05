import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { criticalAlerts, type CriticalAlert } from '@api/criticalAlerts';

export const CriticalAlertBar = () => {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<readonly CriticalAlert[]>(() => criticalAlerts.getAll());

  useEffect(() => criticalAlerts.subscribe(setAlerts), []);

  if (alerts.length === 0) return null;
  const top = alerts[0];
  if (!top) return null;
  const remaining = alerts.length - 1;

  return (
    <div className="oa-critical-bar" role="alert">
      <span className="oa-critical-bar__label">{t('criticalAlertBar.label')}</span>
      <span className="oa-critical-bar__message">{top.message}</span>
      {remaining > 0 && (
        <span className="oa-critical-bar__more">{t('criticalAlertBar.more', { count: remaining })}</span>
      )}
      <button
        type="button"
        className="oa-critical-bar__dismiss"
        onClick={() => {
          criticalAlerts.dismiss(top.id);
        }}
      >
        {t('criticalAlertBar.dismiss')}
      </button>
    </div>
  );
};
