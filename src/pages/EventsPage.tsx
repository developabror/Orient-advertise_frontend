import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  type Column,
  EmptyState,
  ExpandableText,
  FormInput,
  Pagination,
  Spinner,
  Table,
  TimeAgo,
} from '@components';
import { useEventCount, useEvents, type EventFilter, type FleetEvent } from '@hooks';
import type { DeviceEventType, EventPriority } from '@hooks/useDeviceEvents';

const PAGE_SIZE = 50;
const TEXT_DEBOUNCE_MS = 300;
const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 86_400_000;
// Threshold above which we make the user explicitly opt in to fetching the
// full list. Cheap enough to render below; expensive enough to warn.
const AUTO_LOAD_THRESHOLD = 500;

const PRIORITIES: readonly EventPriority[] = ['critical', 'high', 'medium', 'low'];

const TYPE_DEFAULT_PRIORITY: Record<DeviceEventType, EventPriority> = {
  INCIDENT: 'critical',
  STATUS_CHANGE: 'high',
  COMMAND: 'medium',
  CONTENT_SYNC: 'low',
  BOOT: 'low',
};

const formatDate = (d: Date): string => {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

interface ClampedRange {
  readonly from: string;
  readonly to: string;
  readonly clamped: boolean;
}

// When the user adjusts one end of the range and the new span exceeds
// MAX_RANGE_DAYS, snap the OTHER end so the just-edited value stays put and
// the constraint is enforced.
const clampDateRange = (from: string, to: string, anchor: 'from' | 'to'): ClampedRange => {
  if (from === '' || to === '') return { from, to, clamped: false };
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(f) || !Number.isFinite(t)) return { from, to, clamped: false };
  if (t < f) return { from, to, clamped: false };
  const span = (t - f) / MS_PER_DAY;
  if (span <= MAX_RANGE_DAYS) return { from, to, clamped: false };
  if (anchor === 'from') {
    return { from, to: formatDate(new Date(f + MAX_RANGE_DAYS * MS_PER_DAY)), clamped: true };
  }
  return { from: formatDate(new Date(t - MAX_RANGE_DAYS * MS_PER_DAY)), to, clamped: true };
};

const parsePriorities = (raw: string | null): readonly EventPriority[] => {
  if (raw === null || raw === '') return [];
  const parts = raw.split(',');
  const out: EventPriority[] = [];
  for (const p of parts) {
    if (p === 'critical' || p === 'high' || p === 'medium' || p === 'low') out.push(p);
  }
  return out;
};

const parsePage = (raw: string | null): number => {
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
};

export const EventsPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const deviceId = searchParams.get('deviceId') ?? '';
  const facility = searchParams.get('facility') ?? '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const priorities = parsePriorities(searchParams.get('priority'));
  const page = parsePage(searchParams.get('page'));

  const updateParam = useCallback(
    (key: string, value: string): void => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete(key);
        else next.set(key, value);
        if (key !== 'page') next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const updateMany = useCallback(
    (updates: Record<string, string>): void => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in updates)) next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  // Debounced text inputs so typing doesn't fire a count request per keystroke.
  const [deviceInput, setDeviceInput] = useState(deviceId);
  const [facilityInput, setFacilityInput] = useState(facility);

  useEffect(() => {
    setDeviceInput(deviceId);
  }, [deviceId]);
  useEffect(() => {
    setFacilityInput(facility);
  }, [facility]);

  useEffect(() => {
    if (deviceInput === deviceId) return;
    const timer = window.setTimeout(() => {
      updateParam('deviceId', deviceInput.trim());
    }, TEXT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deviceInput, deviceId, updateParam]);

  useEffect(() => {
    if (facilityInput === facility) return;
    const timer = window.setTimeout(() => {
      updateParam('facility', facilityInput.trim());
    }, TEXT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [facilityInput, facility, updateParam]);

  const [clampWarning, setClampWarning] = useState(false);

  const onDateChange = (which: 'from' | 'to', value: string): void => {
    const otherKey = which === 'from' ? 'dateTo' : 'dateFrom';
    const otherValue = searchParams.get(otherKey) ?? '';
    const fromVal = which === 'from' ? value : otherValue;
    const toVal = which === 'to' ? value : otherValue;
    const result = clampDateRange(fromVal, toVal, which);
    setClampWarning(result.clamped);
    updateMany({ dateFrom: result.from, dateTo: result.to });
  };

  const togglePriority = (p: EventPriority): void => {
    const set = new Set(priorities);
    if (set.has(p)) set.delete(p);
    else set.add(p);
    const list = PRIORITIES.filter((x) => set.has(x));
    updateParam('priority', list.join(','));
  };

  const clearAll = (): void => {
    setSearchParams(new URLSearchParams());
    setDeviceInput('');
    setFacilityInput('');
    setClampWarning(false);
  };

  const hasMinFilters = deviceId !== '' || facility !== '';

  const filter: EventFilter | null = useMemo(
    () => (hasMinFilters ? { deviceId, facility, dateFrom, dateTo, priorities } : null),
    [hasMinFilters, deviceId, facility, dateFrom, dateTo, priorities],
  );

  const { count, isLoading: countLoading, error: countError } = useEventCount(filter);

  // Confirmation gate for large result sets — reset when the filter changes.
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const filterKeyForConfirm = useMemo(
    () =>
      filter === null
        ? null
        : [
            filter.deviceId,
            filter.facility,
            filter.dateFrom,
            filter.dateTo,
            [...filter.priorities].sort().join(','),
          ].join('|'),
    [filter],
  );
  const isConfirmedForCurrent =
    filterKeyForConfirm !== null && confirmedKey === filterKeyForConfirm;
  const shouldFetch = count !== null && (count <= AUTO_LOAD_THRESHOLD || isConfirmedForCurrent);

  const { events, totalPages, isLoading, error, retry } = useEvents(
    shouldFetch ? filter : null,
    page,
    PAGE_SIZE,
  );

  const onConfirmLoad = (): void => {
    if (filterKeyForConfirm !== null) setConfirmedKey(filterKeyForConfirm);
  };

  const columns: readonly Column<FleetEvent>[] = useMemo(
    () => [
      {
        key: 'priority',
        header: '',
        width: '32px',
        render: (e) => {
          const p = e.priority ?? TYPE_DEFAULT_PRIORITY[e.type];
          return (
            <span
              className="oa-event-row__dot oa-event-row__dot--inline"
              data-priority={p}
              aria-label={t('eventsPage.priorityAria', { priority: t(`eventsPage.priority_${p}`) })}
            />
          );
        },
      },
      {
        key: 'type',
        header: t('eventsPage.colType'),
        width: '160px',
        render: (e) => <Badge variant="neutral">{e.type.replace(/_/g, ' ')}</Badge>,
      },
      {
        key: 'device',
        header: t('eventsPage.colDevice'),
        width: '160px',
        render: (e) => <code className="oa-mono">{e.deviceId}</code>,
      },
      {
        key: 'facility',
        header: t('eventsPage.colFacility'),
        render: (e) => <span title={e.facility}>{e.facility}</span>,
      },
      {
        key: 'message',
        header: t('eventsPage.colMessage'),
        render: (e) => <ExpandableText text={e.message} max={80} />,
      },
      {
        key: 'time',
        header: t('eventsPage.colWhen'),
        width: '140px',
        render: (e) => <TimeAgo date={e.occurredAt} />,
      },
    ],
    [t],
  );

  return (
    <section className="oa-events-page">
      <header className="oa-events-page__header">
        <h1>{t('eventsPage.heading')}</h1>
        <p className="oa-events-page__hint">{t('eventsPage.hint')}</p>
      </header>

      <div className="oa-events-filter">
        <div className="oa-events-filter__row">
          <FormInput
            label={t('eventsPage.deviceIdLabel')}
            type="search"
            value={deviceInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setDeviceInput(e.target.value);
            }}
            placeholder={t('eventsPage.deviceIdPlaceholder')}
            autoComplete="off"
          />
          <FormInput
            label={t('eventsPage.facilityLabel')}
            type="search"
            value={facilityInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setFacilityInput(e.target.value);
            }}
            placeholder={t('eventsPage.facilityPlaceholder')}
            autoComplete="off"
          />
        </div>
        <div className="oa-events-filter__row">
          <div className="oa-field">
            <label htmlFor="oa-events-from" className="oa-field__label">
              {t('eventsPage.fromLabel')}
            </label>
            <input
              id="oa-events-from"
              type="date"
              className="oa-field__input"
              value={dateFrom}
              onChange={(e) => {
                onDateChange('from', e.target.value);
              }}
            />
          </div>
          <div className="oa-field">
            <label htmlFor="oa-events-to" className="oa-field__label">
              {t('eventsPage.toLabel')}
            </label>
            <input
              id="oa-events-to"
              type="date"
              className="oa-field__input"
              value={dateTo}
              onChange={(e) => {
                onDateChange('to', e.target.value);
              }}
            />
          </div>
          <fieldset className="oa-events-filter__priorities">
            <legend>{t('eventsPage.priorityLegend')}</legend>
            <div className="oa-events-filter__priorities-options">
              {PRIORITIES.map((p) => (
                <label key={p} className="oa-events-filter__priority">
                  <input
                    type="checkbox"
                    checked={priorities.includes(p)}
                    onChange={() => {
                      togglePriority(p);
                    }}
                  />
                  <span>{t(`eventsPage.priority_${p}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {clampWarning && (
          <p className="oa-events-filter__warning" role="status">
            ⚠ {t('eventsPage.rangeCapped', { count: MAX_RANGE_DAYS })}
          </p>
        )}
        <div className="oa-events-filter__actions">
          {(deviceId !== '' ||
            facility !== '' ||
            dateFrom !== '' ||
            dateTo !== '' ||
            priorities.length > 0) && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              {t('eventsPage.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {!hasMinFilters ? (
        <div className="oa-events-page__state">
          <EmptyState
            title={t('eventsPage.emptySearchTitle')}
            description={t('eventsPage.emptySearchDesc')}
          />
        </div>
      ) : countError !== null ? (
        <div className="oa-events-page__state">
          <EmptyState
            title={t('eventsPage.countErrorTitle')}
            description={t('eventsPage.tryAgain')}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  retry();
                }}
              >
                {t('eventsPage.retry')}
              </Button>
            }
          />
        </div>
      ) : countLoading ? (
        <div className="oa-events-page__state">
          <Spinner size="md" label={t('eventsPage.counting')} />
        </div>
      ) : count !== null && count > AUTO_LOAD_THRESHOLD && !isConfirmedForCurrent ? (
        <div className="oa-events-confirm" role="status">
          <p className="oa-events-confirm__text">
            <Trans
              i18nKey="eventsPage.confirmText"
              values={{ count: count.toLocaleString() }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="oa-events-confirm__actions">
            <Button variant="ghost" size="sm" onClick={clearAll}>
              {t('eventsPage.refineFilters')}
            </Button>
            <Button variant="primary" size="sm" onClick={onConfirmLoad}>
              {t('eventsPage.loadAnyway')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {count !== null && (
            <p className="oa-events-page__count">
              {t('eventsPage.matchCount', { count, formatted: count.toLocaleString() })}
            </p>
          )}
          {error !== null ? (
            <div className="oa-events-page__state">
              <EmptyState
                title={t('eventsPage.loadErrorTitle')}
                description={t('eventsPage.tryAgain')}
                action={
                  <Button variant="primary" onClick={retry}>
                    {t('eventsPage.retry')}
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <Table
                columns={columns}
                data={events}
                rowKey={(e) => e.id}
                isLoading={isLoading}
                emptyTitle={t('eventsPage.tableEmptyTitle')}
                emptyDescription={t('eventsPage.tableEmptyDesc')}
              />
              {totalPages > 1 && (
                <div className="oa-events-page__pagination">
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={(p) => {
                      updateParam('page', String(p));
                    }}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
};
