import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { http } from '@api/http';
import { notify } from '@api/notify';
import {
  Button,
  type Column,
  EmptyState,
  FormInput,
  Select,
  Table,
  UptimeChart,
} from '@components';
import {
  useDelayedFlag,
  useIncidentSummary,
  useRegions,
  useUptimeReport,
  type IncidentSummaryRow,
  type ReportFilter,
} from '@hooks';

type TimeRange = '7d' | '30d' | 'custom';

const SKELETON_DELAY_MS = 3_000;
const MS_PER_DAY = 86_400_000;

const isTimeRange = (v: string): v is TimeRange => v === '7d' || v === '30d' || v === 'custom';

const formatDate = (d: Date): string => {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const presetRange = (preset: '7d' | '30d'): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const days = preset === '7d' ? 7 : 30;
  return {
    dateFrom: formatDate(new Date(now.getTime() - days * MS_PER_DAY)),
    dateTo: formatDate(now),
  };
};

const filenameFromHeaders = (headers: unknown): string | null => {
  if (typeof headers !== 'object' || headers === null) return null;
  const disp = (headers as Record<string, unknown>)['content-disposition'];
  if (typeof disp !== 'string') return null;
  // Matches `filename="report.csv"` or `filename=report.csv` (and the
  // `filename*=UTF-8''…` extended form).
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
  return match?.[1] ?? null;
};

const exportErrorMessage = (err: unknown, t: TFunction): string => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) {
      return t('reportsPage.exportErrorUnreachable');
    }
    if (status === 429) {
      return t('reportsPage.exportErrorRunning');
    }
    if (status === 408 || status === 504 || status === 413) {
      return t('reportsPage.exportErrorTooLarge');
    }
    if (status >= 500) {
      return t('reportsPage.exportErrorServer');
    }
  }
  return t('reportsPage.exportErrorGeneric');
};

interface ParsedActive {
  readonly timeRange: TimeRange;
  readonly resolved: ReportFilter;
}

const parseActiveFromUrl = (params: URLSearchParams): ParsedActive | null => {
  const tr = params.get('timeRange');
  if (tr === null) return null;
  const range = isTimeRange(tr) ? tr : '7d';
  const region = params.get('region') ?? '';
  const facility = params.get('facility') ?? '';

  if (range === 'custom') {
    const dateFrom = params.get('dateFrom') ?? '';
    const dateTo = params.get('dateTo') ?? '';
    if (dateFrom === '' || dateTo === '') return null;
    return {
      timeRange: 'custom',
      resolved: { dateFrom, dateTo, region, facility },
    };
  }
  const { dateFrom, dateTo } = presetRange(range);
  return {
    timeRange: range,
    resolved: { dateFrom, dateTo, region, facility },
  };
};

const SkeletonBars = () => (
  <ul className="oa-uptime-list" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (
      <li key={i} className="oa-uptime-row oa-uptime-row--skeleton">
        <span className="oa-uptime-row__skeleton-label" />
        <span className="oa-uptime-row__skeleton-bar" />
      </li>
    ))}
  </ul>
);

const SkeletonTable = () => (
  <div className="oa-summary-skeleton" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="oa-summary-skeleton__row" />
    ))}
  </div>
);

export const ReportsPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseActiveFromUrl(searchParams);

  // Local form state — what the user is editing. Only flushed to the URL
  // (and therefore to the hooks) when Apply fires.
  const [localTimeRange, setLocalTimeRange] = useState<TimeRange>(active?.timeRange ?? '7d');
  const [localDateFrom, setLocalDateFrom] = useState(
    active?.timeRange === 'custom' ? active.resolved.dateFrom : '',
  );
  const [localDateTo, setLocalDateTo] = useState(
    active?.timeRange === 'custom' ? active.resolved.dateTo : '',
  );
  const [localRegion, setLocalRegion] = useState(active?.resolved.region ?? '');
  const [localFacility, setLocalFacility] = useState(active?.resolved.facility ?? '');

  // Sync local form state when the URL changes externally (browser back, paste).
  useEffect(() => {
    if (active === null) return;
    setLocalTimeRange(active.timeRange);
    if (active.timeRange === 'custom') {
      setLocalDateFrom(active.resolved.dateFrom);
      setLocalDateTo(active.resolved.dateTo);
    }
    setLocalRegion(active.resolved.region);
    setLocalFacility(active.resolved.facility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active?.timeRange,
    active?.resolved.dateFrom,
    active?.resolved.dateTo,
    active?.resolved.region,
    active?.resolved.facility,
  ]);

  const regions = useRegions();
  const regionOptions = useMemo(
    () => [
      { value: '', label: t('reportsPage.allRegions') },
      ...regions.map((r) => ({ value: r.id, label: r.name })),
    ],
    [regions, t],
  );

  const isCustom = localTimeRange === 'custom';
  const customRangeInvalid =
    isCustom &&
    (localDateFrom === '' ||
      localDateTo === '' ||
      new Date(localDateFrom).getTime() > new Date(localDateTo).getTime());

  const canApply = !customRangeInvalid;

  const onApply = (): void => {
    if (!canApply) return;
    const next = new URLSearchParams();
    next.set('timeRange', localTimeRange);
    if (isCustom) {
      next.set('dateFrom', localDateFrom);
      next.set('dateTo', localDateTo);
    }
    if (localRegion !== '') next.set('region', localRegion);
    if (localFacility !== '') next.set('facility', localFacility);
    setSearchParams(next);
  };

  const filter: ReportFilter | null = active?.resolved ?? null;

  const uptime = useUptimeReport(filter);
  const summary = useIncidentSummary(filter);

  const [exporting, setExporting] = useState(false);

  // While the export is in flight, intercept tab close / refresh / back-forward
  // navigation so the user can't accidentally lose a long-running export.
  useEffect(() => {
    if (!exporting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      // Modern browsers show the confirmation dialog from preventDefault alone;
      // legacy returnValue assignment is now deprecated.
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [exporting]);

  const onExport = (): void => {
    if (filter === null || exporting) return;
    setExporting(true);
    void (async () => {
      try {
        // Spec: GET /api/reports/export takes `type` (required), optional
        // `facilityId`/`deviceId`/`from`/`to`. `region` isn't accepted —
        // facility is the smallest scoping unit. Reports page exports the
        // EVENTS sheet by default.
        const response = await http.get('/api/reports/export', {
          params: {
            type: 'EVENTS',
            from: `${filter.dateFrom}T00:00:00Z`,
            to: `${filter.dateTo}T23:59:59Z`,
            ...(filter.facility !== '' ? { facilityId: filter.facility } : {}),
          },
          responseType: 'blob',
          // Server may take well over the default 10s for large exports — we
          // explicitly disable any timeout so the download isn't aborted
          // prematurely.
          timeout: 0,
          _suppressErrorToast: true,
        });
        const blob = response.data as Blob;
        const filename =
          filenameFromHeaders(response.headers) ??
          `orient-report-${filter.dateFrom}_to_${filter.dateTo}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify.success(t('reportsPage.exportSuccess', { filename }));
      } catch (err: unknown) {
        notify.error(exportErrorMessage(err, t));
      } finally {
        setExporting(false);
      }
    })();
  };

  // Skeleton only after 3s of continuous loading; quick fetches show no
  // intermediate state at all.
  const showUptimeSkeleton = useDelayedFlag(uptime.isLoading, SKELETON_DELAY_MS);
  const showSummarySkeleton = useDelayedFlag(summary.isLoading, SKELETON_DELAY_MS);

  type SortColumn = 'facility' | 'incidentCount' | 'criticalCount' | 'avgResolutionMinutes';
  type SortDir = 'asc' | 'desc';
  const [sortBy, setSortBy] = useState<{ col: SortColumn; dir: SortDir }>({
    col: 'incidentCount',
    dir: 'desc',
  });

  const onSortClick = (col: SortColumn): void => {
    setSortBy((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'facility' ? 'asc' : 'desc' },
    );
  };

  const sortedSummary = useMemo(() => {
    const rows = [...summary.rows];
    rows.sort((a, b) => {
      // Null-handling for avg resolution: null always pushed to the bottom,
      // regardless of sort direction.
      if (sortBy.col === 'avgResolutionMinutes') {
        if (a.avgResolutionMinutes === null && b.avgResolutionMinutes === null) return 0;
        if (a.avgResolutionMinutes === null) return 1;
        if (b.avgResolutionMinutes === null) return -1;
      }
      let cmp = 0;
      if (sortBy.col === 'facility') cmp = a.facility.localeCompare(b.facility);
      else if (sortBy.col === 'incidentCount') cmp = a.incidentCount - b.incidentCount;
      else if (sortBy.col === 'criticalCount') cmp = a.criticalCount - b.criticalCount;
      else {
        const ax = a.avgResolutionMinutes ?? 0;
        const bx = b.avgResolutionMinutes ?? 0;
        cmp = ax - bx;
      }
      return sortBy.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [summary.rows, sortBy]);

  const renderSortHeader = (col: SortColumn, label: string): ReactElement => {
    const active = sortBy.col === col;
    return (
      <button
        type="button"
        className={`oa-sort-header${active ? ' oa-sort-header--active' : ''}`}
        onClick={() => {
          onSortClick(col);
        }}
        aria-sort={active ? (sortBy.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <span className="oa-sort-header__indicator" aria-hidden="true">
          {active ? (sortBy.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    );
  };

  const formatDuration = (minutes: number | null): string => {
    if (minutes === null) return '—';
    const m = Math.round(minutes);
    if (m < 60) return `${String(m)}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${String(h)}h` : `${String(h)}h ${String(rem)}m`;
  };

  type CellStatus = 'green' | 'amber' | 'red' | 'muted';

  const incidentCountStatus = (n: number): CellStatus => {
    if (n === 0) return 'green';
    if (n < 5) return 'amber';
    return 'red';
  };
  const criticalCountStatus = (n: number): CellStatus => (n === 0 ? 'green' : 'red');
  const avgResolutionStatus = (minutes: number | null): CellStatus => {
    if (minutes === null) return 'muted';
    if (minutes < 60) return 'green';
    if (minutes < 240) return 'amber';
    return 'red';
  };

  const summaryColumns: readonly Column<IncidentSummaryRow>[] = useMemo(
    () => [
      {
        key: 'facility',
        header: renderSortHeader('facility', t('reportsPage.colFacility')),
        render: (r) => r.facility,
      },
      {
        key: 'incidentCount',
        header: renderSortHeader('incidentCount', t('reportsPage.colIncidents')),
        align: 'right',
        width: '120px',
        render: (r) => (
          <span className="oa-summary-cell" data-status={incidentCountStatus(r.incidentCount)}>
            {String(r.incidentCount)}
          </span>
        ),
      },
      {
        key: 'criticalCount',
        header: renderSortHeader('criticalCount', t('reportsPage.colCritical')),
        align: 'right',
        width: '120px',
        render: (r) => (
          <span className="oa-summary-cell" data-status={criticalCountStatus(r.criticalCount)}>
            {String(r.criticalCount)}
          </span>
        ),
      },
      {
        key: 'avgResolutionMinutes',
        header: renderSortHeader('avgResolutionMinutes', t('reportsPage.colAvgResolution')),
        align: 'right',
        width: '140px',
        render: (r) => (
          <span
            className="oa-summary-cell"
            data-status={avgResolutionStatus(r.avgResolutionMinutes)}
          >
            {formatDuration(r.avgResolutionMinutes)}
          </span>
        ),
      },
    ],
    // sortBy is referenced via renderSortHeader; we recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortBy, t],
  );

  return (
    <section className="oa-reports">
      <header className="oa-reports__header">
        <div>
          <h1>{t('reportsPage.title')}</h1>
          <p className="oa-reports__hint">{t('reportsPage.hint')}</p>
        </div>
        {filter !== null && (
          <div className="oa-reports__top-actions">
            <Button
              variant="secondary"
              onClick={onExport}
              isLoading={exporting}
              disabled={exporting}
            >
              {exporting ? t('reportsPage.preparing') : t('reportsPage.exportCsv')}
            </Button>
          </div>
        )}
      </header>

      <div className="oa-reports__filter">
        <fieldset className="oa-reports__range">
          <legend>{t('reportsPage.timeRange')}</legend>
          <div className="oa-reports__range-options" role="radiogroup">
            {(['7d', '30d', 'custom'] as const).map((t2) => (
              <label
                key={t2}
                className={`oa-reports__range-option${
                  localTimeRange === t2 ? ' oa-reports__range-option--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="timeRange"
                  value={t2}
                  checked={localTimeRange === t2}
                  onChange={() => {
                    setLocalTimeRange(t2);
                  }}
                />
                <span>
                  {t2 === '7d'
                    ? t('reportsPage.last7Days')
                    : t2 === '30d'
                      ? t('reportsPage.last30Days')
                      : t('reportsPage.custom')}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {isCustom && (
          <div className="oa-reports__custom">
            <div className="oa-field">
              <label htmlFor="oa-reports-from" className="oa-field__label">
                {t('reportsPage.from')}
              </label>
              <input
                id="oa-reports-from"
                type="date"
                className="oa-field__input"
                value={localDateFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setLocalDateFrom(e.target.value);
                }}
              />
            </div>
            <div className="oa-field">
              <label htmlFor="oa-reports-to" className="oa-field__label">
                {t('reportsPage.to')}
              </label>
              <input
                id="oa-reports-to"
                type="date"
                className="oa-field__input"
                value={localDateTo}
                min={localDateFrom || undefined}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setLocalDateTo(e.target.value);
                }}
                aria-invalid={customRangeInvalid ? true : undefined}
              />
            </div>
          </div>
        )}

        <div className="oa-reports__scope">
          <Select
            label={t('reportsPage.region')}
            options={regionOptions}
            value={localRegion}
            onChange={(e) => {
              setLocalRegion(e.target.value);
            }}
          />
          <FormInput
            label={t('reportsPage.facility')}
            type="search"
            value={localFacility}
            onChange={(e) => {
              setLocalFacility(e.target.value);
            }}
            placeholder={t('reportsPage.facilitySearchPlaceholder')}
            autoComplete="off"
          />
        </div>

        {customRangeInvalid && (
          <p className="oa-reports__error" role="alert">
            {t('reportsPage.customRangeInvalid')}
          </p>
        )}

        <div className="oa-reports__actions">
          <Button variant="primary" onClick={onApply} disabled={!canApply}>
            {t('reportsPage.apply')}
          </Button>
        </div>
      </div>

      {filter === null ? (
        <div className="oa-reports__state">
          <EmptyState
            title={t('reportsPage.emptyTitle')}
            description={t('reportsPage.emptyDescription')}
          />
        </div>
      ) : (
        <div className="oa-reports__panels">
          <article className="oa-card oa-uptime-panel">
            <header className="oa-panel-header">
              <h2>{t('reportsPage.uptime')}</h2>
            </header>
            {uptime.error !== null ? (
              <div className="oa-reports__panel-error" role="alert">
                <p>{uptime.error}</p>
                <Button variant="primary" size="sm" onClick={uptime.retry}>
                  {t('reportsPage.retry')}
                </Button>
              </div>
            ) : uptime.isLoading ? (
              showUptimeSkeleton ? (
                <SkeletonBars />
              ) : null
            ) : uptime.rows.length === 0 ? (
              <p className="oa-muted">{t('reportsPage.noUptimeData')}</p>
            ) : (
              <UptimeChart rows={uptime.rows} />
            )}
          </article>

          <article className="oa-card oa-summary-panel">
            <header className="oa-panel-header">
              <h2>{t('reportsPage.incidentSummary')}</h2>
            </header>
            {summary.error !== null ? (
              <div className="oa-reports__panel-error" role="alert">
                <p>{summary.error}</p>
                <Button variant="primary" size="sm" onClick={summary.retry}>
                  {t('reportsPage.retry')}
                </Button>
              </div>
            ) : summary.isLoading ? (
              showSummarySkeleton ? (
                <SkeletonTable />
              ) : null
            ) : (
              <Table
                columns={summaryColumns}
                data={sortedSummary}
                rowKey={(r) => r.id}
                emptyTitle={t('reportsPage.noIncidentsTitle')}
                emptyDescription={t('reportsPage.noIncidentsDescription')}
              />
            )}
          </article>
        </div>
      )}
    </section>
  );
};
