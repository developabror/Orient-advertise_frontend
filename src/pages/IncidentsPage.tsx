import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Button, EmptyState, Spinner, StatCard, TimeAgo } from '@components';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { useIncidentStats } from '@hooks/useIncidentStats';
import { useIncidents, type IncidentFilter } from '@hooks/useIncidents';

const TABS: readonly { value: IncidentFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'tabAll' },
  { value: 'critical', labelKey: 'tabCritical' },
  { value: 'warning', labelKey: 'tabWarning' },
  { value: 'resolved', labelKey: 'tabResolved' },
];

const ANIMATION_MS = 600;

const parseFilter = (raw: string | null): IncidentFilter => {
  if (raw === 'critical' || raw === 'warning' || raw === 'resolved') return raw;
  return 'all';
};

export const IncidentsPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get('tab'));

  const setFilter = (next: IncidentFilter): void => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') params.delete('tab');
      else params.set('tab', next);
      return params;
    });
  };

  const { stats, isLoading: statsLoading, isStale: statsStale } = useIncidentStats();
  const { incidents, isLoading, isStale, acknowledge, resolve } = useIncidents(filter);

  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(new Set());

  const onAcknowledge = (id: string): void => {
    setSubmittingIds((prev) => new Set(prev).add(id));
    void (async () => {
      try {
        await acknowledge(id);
      } catch (err: unknown) {
        markErrorHandled(err);
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          // 409 = already acted on by someone else; the backend message names
          // who / what changed.
          notify.warning(
            extractApiMessage(err) ?? t('incidentsPage.alreadyUpdated'),
          );
        } else {
          notify.error(extractApiMessage(err) ?? t('incidentsPage.couldNotAcknowledge'));
        }
      } finally {
        setSubmittingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    })();
  };

  const onResolve = (id: string): void => {
    setSubmittingIds((prev) => new Set(prev).add(id));
    void (async () => {
      try {
        await resolve(id);
      } catch (err: unknown) {
        markErrorHandled(err);
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          notify.warning(
            extractApiMessage(err) ?? t('incidentsPage.alreadyUpdated'),
          );
        } else {
          notify.error(extractApiMessage(err) ?? t('incidentsPage.couldNotResolve'));
        }
      } finally {
        setSubmittingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    })();
  };

  // Animate newly-arrived incidents (typically WS-driven prepends) into the
  // top of the list. Detect new ids by diffing the previous render's set.
  const previousIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [animatingIds, setAnimatingIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(incidents.map((i) => i.id));

    // Skip animation on the very first non-loading render so the initial list
    // doesn't all flash at once.
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

  // Reset animation tracking when the user switches tabs — incidents in a
  // different filter shouldn't all animate just because the tab changed.
  useEffect(() => {
    seededRef.current = false;
    previousIdsRef.current = new Set();
    setAnimatingIds(new Set());
  }, [filter]);

  const emptyTitle =
    filter === 'resolved'
      ? t('incidentsPage.emptyTitleResolved')
      : filter === 'critical'
        ? t('incidentsPage.emptyTitleCritical')
        : filter === 'warning'
          ? t('incidentsPage.emptyTitleWarning')
          : t('incidentsPage.emptyTitleAllClear');
  const emptyDescription =
    filter === 'resolved'
      ? t('incidentsPage.emptyDescResolved')
      : t('incidentsPage.emptyDescDefault');

  return (
    <section className="oa-incidents-page">
      <header className="oa-incidents-page__header">
        <h1>{t('incidentsPage.heading')}</h1>
        {(isStale || statsStale) && (
          <span className="oa-dashboard__stale">{t('incidentsPage.staleData')}</span>
        )}
      </header>

      <div className="oa-stat-grid">
        <StatCard
          label={t('incidentsPage.statCritical')}
          value={stats.critical}
          isLoading={statsLoading}
          isStale={statsStale}
        />
        <StatCard
          label={t('incidentsPage.statWarning')}
          value={stats.warning}
          isLoading={statsLoading}
          isStale={statsStale}
        />
        <StatCard
          label={t('incidentsPage.statResolvedToday')}
          value={stats.resolvedToday}
          isLoading={statsLoading}
          isStale={statsStale}
        />
      </div>

      <div className="oa-tabs" role="tablist" aria-label={t('incidentsPage.filterAriaLabel')}>
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={filter === tab.value}
            className={`oa-tab${filter === tab.value ? ' oa-tab--active' : ''}`}
            onClick={() => {
              setFilter(tab.value);
            }}
          >
            {t(`incidentsPage.${tab.labelKey}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="oa-incidents-page__state">
          <Spinner size="lg" label={t('incidentsPage.loading')} />
        </div>
      ) : incidents.length === 0 ? (
        <div className="oa-incidents-page__state">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <ul className="oa-incident-list">
          {incidents.map((inc) => {
            const isAnimating = animatingIds.has(inc.id);
            const isSubmitting = submittingIds.has(inc.id);
            return (
              <li
                key={inc.id}
                className={`oa-incident-row${isAnimating ? ' oa-incident-row--new' : ''}`}
                data-status={inc.status}
                data-priority={inc.priority}
              >
                <span
                  className="oa-incident-row__dot"
                  aria-label={t('incidentsPage.priorityAria', { priority: inc.priority })}
                />
                <div className="oa-incident-row__info">
                  <code className="oa-incident-row__device">{inc.deviceId}</code>
                  <span className="oa-incident-row__facility" title={inc.facility}>
                    {inc.facility}
                    {inc.message !== '' && ` · ${inc.message}`}
                  </span>
                </div>
                <span className="oa-incident-row__time">
                  <TimeAgo date={inc.occurredAt} />
                </span>
                <div className="oa-incident-row__actions">
                  {inc.status === 'open' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        onAcknowledge(inc.id);
                      }}
                      disabled={isSubmitting}
                      isLoading={isSubmitting}
                    >
                      {t('incidentsPage.acknowledge')}
                    </Button>
                  )}
                  {inc.status !== 'resolved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        onResolve(inc.id);
                      }}
                      disabled={isSubmitting}
                      isLoading={isSubmitting && inc.status !== 'open'}
                    >
                      {t('incidentsPage.resolve')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
