import { useEffect, useId, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '@hooks/useFocusTrap';

export type DrawerSide = 'left' | 'right';
export type DrawerSize = 'sm' | 'md' | 'lg';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: DrawerSide;
  size?: DrawerSize;
  closeOnBackdrop?: boolean;
}

export const Drawer = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  size = 'md',
  closeOnBackdrop = true,
}: DrawerProps) => {
  const { t } = useTranslation();
  const containerRef = useFocusTrap<HTMLElement>(isOpen, onClose);
  const titleId = useId();

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
    <div className="oa-drawer-backdrop" role="presentation" onClick={onBackdropClick}>
      <aside
        ref={containerRef}
        className={`oa-drawer oa-drawer--${side} oa-drawer--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="oa-drawer__header">
          <h2 id={titleId} className="oa-drawer__title">
            {title}
          </h2>
          <button
            type="button"
            className="oa-drawer__close"
            onClick={onClose}
            aria-label={t('uiDrawer.closePanel')}
          >
            ×
          </button>
        </header>
        <div className="oa-drawer__body">{children}</div>
        {footer !== undefined && <footer className="oa-drawer__footer">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
};
