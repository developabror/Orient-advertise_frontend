import type { ReactNode } from 'react';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

export const Badge = ({ variant = 'neutral', children }: BadgeProps) => (
  <span className={`oa-badge oa-badge--${variant}`}>{children}</span>
);
