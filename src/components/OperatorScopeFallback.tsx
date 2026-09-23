import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

interface Props {
  /** True once `/api/me` has failed every retry — see `useAssignedProjects`. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/**
 * What an operator page shows while it still does not know its project scope.
 *
 * <p>Every scoped page holds its render until the profile lands, because showing an unfiltered list
 * to a project-scoped operator for even a frame is worse than waiting. The wait used to have no end:
 * one failed `/api/me` and the page spun forever, with no retry and nothing to click (VG-12). The
 * spinner is still right while the request is in flight; once it has given up, this says so and
 * offers the retry.
 */
export const OperatorScopeFallback = ({ failed, onRetry }: Props) => {
  const { t } = useTranslation();
  if (!failed) {
    return (
      <div className="oa-settings-page">
        <Spinner size="lg" label={t('operatorScope.loading')} />
      </div>
    );
  }
  return (
    <div className="oa-settings-page">
      <p className="oa-settings-page__error" role="alert">
        {t('operatorScope.loadFailed')}
      </p>
      <div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('operatorScope.retry')}
        </Button>
      </div>
    </div>
  );
};
