interface StatCardProps {
  label: string;
  value: number;
  isLoading?: boolean;
  isStale?: boolean;
}

export const StatCard = ({ label, value, isLoading = false, isStale = false }: StatCardProps) => {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    <div className="oa-stat-card" data-stale={isStale ? 'true' : undefined}>
      <span className="oa-stat-card__label">{label}</span>
      {isLoading ? (
        <span className="oa-stat-card__skeleton" aria-hidden="true" />
      ) : (
        <span className="oa-stat-card__value">{safe.toLocaleString()}</span>
      )}
    </div>
  );
};
