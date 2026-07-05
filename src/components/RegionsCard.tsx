import { useTranslation } from 'react-i18next';

import type { RegionStats } from '@hooks/useDashboardStats';

interface RegionsCardProps {
  regions: readonly RegionStats[];
  isLoading?: boolean;
  isStale?: boolean;
}

type RatioStatus = 'green' | 'amber' | 'red' | 'empty';

const ratioStatus = (online: number, total: number): RatioStatus => {
  if (total <= 0) return 'empty';
  const ratio = online / total;
  if (ratio >= 0.95) return 'green';
  if (ratio >= 0.8) return 'amber';
  return 'red';
};

const ratioPercent = (online: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (online / total) * 100));
};

const SKELETON_ROWS = [0, 1, 2, 3] as const;

export const RegionsCard = ({ regions, isLoading = false, isStale = false }: RegionsCardProps) => {
  const { t } = useTranslation();
  return (
    <div className="oa-card oa-regions" data-stale={isStale ? 'true' : undefined}>
      <header className="oa-regions__header">
        <h2 className="oa-regions__title">{t('regionsCard.title')}</h2>
        <span className="oa-regions__meta">
          {t('regionsCard.regionCount', { count: regions.length })}
        </span>
      </header>

      {isLoading ? (
        <ul className="oa-regions__list" aria-hidden="true">
          {SKELETON_ROWS.map((i) => (
            <li key={i} className="oa-regions__row oa-regions__row--skeleton">
              <span className="oa-regions__skeleton-name" />
              <span className="oa-regions__skeleton-bar" />
            </li>
          ))}
        </ul>
      ) : regions.length === 0 ? (
        <p className="oa-regions__empty">{t('regionsCard.empty')}</p>
      ) : (
        <ul className="oa-regions__list">
          {regions.map((r) => {
            const status = ratioStatus(r.online, r.total);
            const pct = ratioPercent(r.online, r.total);
            const valueText = t('regionsCard.devicesOnline', { online: r.online, total: r.total });
            return (
              <li key={r.id} className="oa-regions__row">
                <span className="oa-regions__name" title={r.name}>
                  {r.name}
                </span>
                <div
                  className="oa-regions__meter"
                  data-status={status}
                  role="progressbar"
                  aria-label={r.name}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={valueText}
                >
                  <span className="oa-regions__meter-fill" style={{ width: `${String(pct)}%` }} />
                </div>
                <span className="oa-regions__count" aria-hidden="true">
                  {r.online}/{r.total}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
