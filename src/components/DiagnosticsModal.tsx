import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, Modal, Spinner, type BadgeVariant } from './ui';
import { TimeAgo } from './TimeAgo';
import type {
  Diagnostics,
  DiagnosticsActionStatus,
  DiagnosticsState,
} from '@hooks/useDiagnostics';

interface Props {
  state: DiagnosticsState;
  deviceId: string;
  onClose: () => void;
  onRetry: () => void;
}

const ACTION_STATUS_VARIANT: Record<DiagnosticsActionStatus, BadgeVariant> = {
  pending: 'warning',
  completed: 'success',
  failed: 'error',
};

const DiagnosticsBody = ({ data }: { data: Diagnostics }) => {
  const { t } = useTranslation();

  return (
    <div className="oa-diag">
      <dl className="oa-diag__grid">
        <div className="oa-diag__cell">
          <dt>{t('diagnosticsModal.lastHeartbeat')}</dt>
          <dd>
            {data.lastHeartbeat !== null ? (
              <TimeAgo date={data.lastHeartbeat} />
            ) : (
              <span className="oa-muted">{t('diagnosticsModal.never')}</span>
            )}
          </dd>
        </div>
        <div className="oa-diag__cell">
          <dt>{t('diagnosticsModal.contentVersion')}</dt>
          <dd>
            <code className="oa-mono">{data.contentVersion}</code>
          </dd>
        </div>
        <div className="oa-diag__cell">
          <dt>{t('diagnosticsModal.ipAddress')}</dt>
          <dd>
            <code className="oa-mono">{data.ipAddress}</code>
          </dd>
        </div>
      </dl>

      <section className="oa-diag__section">
        <h3>{t('diagnosticsModal.last10Events')}</h3>
        {data.recentEvents.length === 0 ? (
          <p className="oa-muted">{t('diagnosticsModal.noneRecorded')}</p>
        ) : (
          <ol className="oa-diag__list">
            {data.recentEvents.map((e) => (
              <li key={e.id} className="oa-diag__row">
                <span className="oa-diag__row-message">{e.message}</span>
                <span className="oa-diag__row-meta">
                  <span className="oa-diag__row-type">{e.type.replace(/_/g, ' ')}</span>
                  <span aria-hidden="true"> · </span>
                  <TimeAgo date={e.occurredAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="oa-diag__section">
        <h3>{t('diagnosticsModal.last5Actions')}</h3>
        {data.recentActions.length === 0 ? (
          <p className="oa-muted">{t('diagnosticsModal.noneRecorded')}</p>
        ) : (
          <ol className="oa-diag__list">
            {data.recentActions.map((a) => (
              <li key={a.id} className="oa-diag__row">
                <div className="oa-diag__row-head">
                  <span className="oa-diag__row-action">{a.type}</span>
                  <Badge variant={ACTION_STATUS_VARIANT[a.status]}>{a.status}</Badge>
                </div>
                <span className="oa-diag__row-meta">
                  {t('diagnosticsModal.by', { requestedBy: a.requestedBy })}
                  <span aria-hidden="true"> · </span>
                  <TimeAgo date={a.requestedAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

export const DiagnosticsModal = ({ state, deviceId, onClose, onRetry }: Props) => {
  const { t } = useTranslation();
  const isOpen = state.kind !== 'closed';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={t('diagnosticsModal.title', { deviceId })}
    >
      {state.kind === 'loading' && (
        <div className="oa-diag__center">
          <Spinner size="lg" label={t('diagnosticsModal.loading')} />
        </div>
      )}
      {state.kind === 'error' && (
        <EmptyState
          title={t('diagnosticsModal.errorTitle')}
          description={t('diagnosticsModal.errorDescription')}
          action={<Button onClick={onRetry}>{t('diagnosticsModal.retry')}</Button>}
        />
      )}
      {state.kind === 'ready' && <DiagnosticsBody data={state.data} />}
    </Modal>
  );
};
