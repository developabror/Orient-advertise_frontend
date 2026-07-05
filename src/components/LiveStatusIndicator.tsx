import { useTranslation } from 'react-i18next';
import { useWsStatus } from '@hooks/useWsStatus';

export const LiveStatusIndicator = () => {
  const status = useWsStatus();
  const { t } = useTranslation();
  if (status === 'open' || status === 'idle') return null;
  return (
    <span className="oa-live-status" data-status={status} role="status">
      <span className="oa-live-status__dot" aria-hidden="true" />
      {t(`liveStatusIndicator.status_${status}`)}
    </span>
  );
};
