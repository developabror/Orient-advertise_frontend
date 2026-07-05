import { useEffect, useId, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '@hooks/useFocusTrap';

export type ModalSize = 'sm' | 'md' | 'lg';
export type ModalVariant = 'default' | 'urgent';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  variant?: ModalVariant;
  closeOnBackdrop?: boolean;
  /** Extra class on the backdrop — e.g. to raise z-index above another modal. */
  backdropClassName?: string;
  /** id of an element describing the dialog body, wired as aria-describedby. */
  descriptionId?: string | undefined;
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  variant = 'default',
  closeOnBackdrop = true,
  backdropClassName,
  descriptionId,
}: ModalProps) => {
  const containerRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const titleId = useId();
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      className={backdropClassName ? `oa-modal-backdrop ${backdropClassName}` : 'oa-modal-backdrop'}
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        ref={containerRef}
        className={`oa-modal oa-modal--${size}`}
        data-variant={variant}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="oa-modal__header">
          <h2 id={titleId} className="oa-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="oa-modal__close"
            onClick={onClose}
            aria-label={t('uiModal.closeDialog')}
          >
            ×
          </button>
        </header>
        <div className="oa-modal__body">{children}</div>
        {footer !== undefined && <footer className="oa-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};
