import type { ReactNode } from 'react';

export type StatusDotKind =
  | 'online'
  | 'offline'
  | 'no-content'
  | 'unregistered'
  | 'unknown';

interface StatusDotProps {
  status: StatusDotKind;
  label?: ReactNode;
  pulse?: boolean;
}

export const StatusDot = ({ status, label, pulse = false }: StatusDotProps) => (
  <span className="oa-status">
    <span
      className={`oa-status__dot oa-status__dot--${status}${pulse ? ' oa-status__dot--pulse' : ''}`}
      aria-hidden="true"
    />
    {label !== undefined && <span className="oa-status__label">{label}</span>}
  </span>
);
