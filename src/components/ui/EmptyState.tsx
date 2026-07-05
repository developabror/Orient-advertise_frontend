import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export const EmptyState = ({ title, description, icon, action }: EmptyStateProps) => (
  <div className="oa-empty" role="status">
    {icon !== undefined && (
      <div className="oa-empty__icon" aria-hidden="true">
        {icon}
      </div>
    )}
    <h3 className="oa-empty__title">{title}</h3>
    {description !== undefined && <p className="oa-empty__description">{description}</p>}
    {action !== undefined && <div className="oa-empty__action">{action}</div>}
  </div>
);
