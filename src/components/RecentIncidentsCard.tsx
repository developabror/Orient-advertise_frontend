import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, EmptyState } from '@components/ui';
import { TimeAgo } from './TimeAgo';
import type { Incident, IncidentPriority } from '@hooks/useRecentIncidents';

interface RecentIncidentsCardProps {
  incidents: readonly Incident[];
  isLoading?: boolean;
  isStale?: boolean;
}

const priorityVariant = (p: IncidentPriority): 'error' | 'warning' | 'info' | 'neutral' => {
  if (p === 'critical') return 'error';
  if (p === 'high') return 'warning';
  if (p === 'medium') return 'info';
  return 'neutral';
};

const SKELETON_ROWS = [0, 1, 2] as const;
const ANIMATION_MS = 600;

export const RecentIncidentsCard = ({
  incidents,
  isLoading = false,
  isStale = false,
}: RecentIncidentsCardProps) => {
  const { t } = useTranslation();
  const previousIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(incidents.map((i) => i.id));

    // Skip animation on the very first non-loading render so the initial list
    // doesn't fade in row-by-row.
    if (!seededRef.current) {
      if (!isLoading) {
        seededRef.current = true;
        previousIdsRef.current = currentIds;
      }
      return;
    }

    const newIds: string[] = [];
    for (const id of currentIds) {
      if (!previousIdsRef.current.has(id)) newIds.push(id);
    }
    previousIdsRef.current = currentIds;
    if (newIds.length === 0) return;

    setAnimatingIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    const timer = window.setTimeout(() => {
      setAnimatingIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
    }, ANIMATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [incidents, isLoading]);

  return (
    <div className="oa-card oa-incidents" data-stale={isStale ? 'true' : undefined}>
      <header className="oa-incidents__header">
        <h2 className="oa-incidents__title">{t('recentIncidentsCard.title')}</h2>
        <Link to="/incidents" className="oa-btn oa-btn--ghost oa-btn--sm">
          {t('recentIncidentsCard.viewAll')}
        </Link>
      </header>

      {isLoading ? (
        <ul className="oa-incidents__list" aria-hidden="true">
          {SKELETON_ROWS.map((i) => (
            <li key={i} className="oa-incidents__row oa-incidents__row--skeleton">
              <span className="oa-incidents__skeleton" />
            </li>
          ))}
        </ul>
      ) : incidents.length === 0 ? (
        <EmptyState
          icon={
            <span className="oa-incidents__check" aria-hidden="true">
              ✓
            </span>
          }
          title={t('recentIncidentsCard.emptyTitle')}
          description={t('recentIncidentsCard.emptyDescription')}
        />
      ) : (
        <ul className="oa-incidents__list">
          {incidents.map((inc) => {
            const isNew = animatingIds.has(inc.id);
            return (
              <li
                key={inc.id}
                className={`oa-incidents__row${isNew ? ' oa-incidents__row--new' : ''}`}
              >
                <Badge variant={priorityVariant(inc.priority)}>{inc.priority.toUpperCase()}</Badge>
                <div className="oa-incidents__meta">
                  <span className="oa-incidents__device" title={inc.deviceId}>
                    {inc.deviceId}
                  </span>
                  <span className="oa-incidents__facility" title={inc.facility}>
                    {inc.facility}
                  </span>
                </div>
                <TimeAgo date={inc.occurredAt} className="oa-incidents__time" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
