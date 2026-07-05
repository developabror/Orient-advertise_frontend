import { useEffect, useState } from 'react';
import { onToast, type Toast } from '@api/notify';

const TOAST_TTL_MS = 5000;
const MAX_VISIBLE = 3;

export const Toaster = () => {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  useEffect(() => {
    return onToast((t) => {
      setToasts((prev) => [...prev, t].slice(-MAX_VISIBLE));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, TOAST_TTL_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="oa-toaster" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="alert" className="oa-toast" data-kind={t.kind}>
          {t.message}
        </div>
      ))}
    </div>
  );
};
