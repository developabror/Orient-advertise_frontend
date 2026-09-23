import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';

const isChunkLoadError = (error: Error): boolean =>
  error.name === 'ChunkLoadError' ||
  /loading chunk|dynamically imported module|failed to fetch dynamically/i.test(error.message);

export const ErrorScreen = ({ error }: { error: Error }) => {
  const { t } = useTranslation();
  const stale = isChunkLoadError(error);
  return (
    <div className="oa-error-boundary" role="alert">
      <h1>{stale ? t('errorBoundary.staleTitle') : t('errorBoundary.title')}</h1>
      <p className="oa-muted">{stale ? t('errorBoundary.staleBody') : t('errorBoundary.body')}</p>
      <div className="oa-error-boundary__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  );
};

