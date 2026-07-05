export type ToastKind = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
}

type Listener = (toast: Toast) => void;

const listeners = new Set<Listener>();
const recentEmits = new Map<string, number>();
const DEDUP_WINDOW_MS = 1000;

let counter = 0;

const emit = (kind: ToastKind, message: string): void => {
  const key = `${kind}:${message}`;
  const now = Date.now();
  const last = recentEmits.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;
  recentEmits.set(key, now);

  counter += 1;
  const toast: Toast = { id: `t-${String(counter)}`, kind, message };
  listeners.forEach((fn) => {
    fn(toast);
  });
};

export const notify = {
  success: (message: string): void => {
    emit('success', message);
  },
  warning: (message: string): void => {
    emit('warning', message);
  },
  error: (message: string): void => {
    emit('error', message);
  },
  info: (message: string): void => {
    emit('info', message);
  },
};

export const onToast = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
