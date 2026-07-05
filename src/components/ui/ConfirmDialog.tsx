import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const resolvedConfirmLabel = confirmLabel ?? t('uiConfirmDialog.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('uiConfirmDialog.cancel');

  // Reset on each (re)open so a freshly-shown dialog accepts a click again.
  useEffect(() => {
    if (isOpen) setSubmitting(false);
  }, [isOpen]);

  const handleConfirm = (): void => {
    if (submitting) return;
    setSubmitting(true);
    void (async () => {
      try {
        await onConfirm();
        // Parent is expected to close the dialog after a successful confirm.
        // Stay disabled until then so the same click can't fire twice.
      } catch {
        // On failure, re-enable so the user can retry.
        setSubmitting(false);
      }
    })();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            isLoading={submitting}
          >
            {resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      <div className="oa-confirm__message">{message}</div>
    </Modal>
  );
};
