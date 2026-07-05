import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onErrorDialog, type ErrorDialog } from '@api/errorDialog';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

// Modal sibling of the Toaster: subscribes to the global error-dialog channel
// and renders one popup at a time. Mounted once at the app root (see main.tsx).
// Backend business 4xx that no component handled inline arrive here as a clear,
// dismissible modal showing the server's own message — the safety net for an
// action that was silently rejected (e.g. a device sync with no playlist).
export const ErrorDialogHost = () => {
  // A small FIFO queue: if several errors land at once (a bulk action fanning
  // out) we show them one after another rather than stacking modals. The
  // channel already coalesces identical messages within a short window.
  const { t } = useTranslation();
  const [queue, setQueue] = useState<readonly ErrorDialog[]>([]);
  const messageId = useId();

  useEffect(() => {
    return onErrorDialog((dialog) => {
      setQueue((prev) => (prev.some((d) => d.id === dialog.id) ? prev : [...prev, dialog]));
    });
  }, []);

  const current = queue[0] ?? null;

  const dismiss = (): void => {
    setQueue((prev) => prev.slice(1));
  };

  return (
    <Modal
      // Key by dialog id so advancing the queue remounts the Modal — re-running
      // the focus trap and re-announcing the new message rather than silently
      // swapping text in place.
      key={current?.id ?? 'oa-error-dialog-empty'}
      isOpen={current !== null}
      onClose={dismiss}
      title={current?.title ?? ''}
      size="sm"
      // Stack above any modal/drawer that may already be open (the action that
      // triggered the error often lives inside its own dialog).
      backdropClassName="oa-modal-backdrop--top"
      // Announce the verbatim backend message (the point of the feature), not
      // just the generic title.
      descriptionId={current !== null ? messageId : undefined}
      footer={
        <Button variant="primary" onClick={dismiss}>
          {t('errorDialogHost.dismiss')}
        </Button>
      }
    >
      {current !== null && (
        <div className="oa-error-dialog">
          <p id={messageId} className="oa-error-dialog__message">
            {current.message}
          </p>
          <p className="oa-error-dialog__meta">
            <span className="oa-error-dialog__status">
              {t('errorDialogHost.errorStatus', { status: current.status })}
            </span>
            {current.correlationId !== null && (
              <span className="oa-error-dialog__ref">
                {t('errorDialogHost.ref', { correlationId: current.correlationId })}
              </span>
            )}
          </p>
        </div>
      )}
    </Modal>
  );
};
