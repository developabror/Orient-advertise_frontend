import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { http } from '@api/http';
import { notify } from '@api/notify';
import { Button, type Column, EmptyState, Pagination, Table } from '@components';
import { useAdvertiserContentDetail } from '@hooks/useAdvertiserContentDetail';
import { useAdvertiserContentPlays, type PlayTimestamp } from '@hooks/useAdvertiserContentPlays';
import type { PerDeviceRow } from '@hooks/useAdvertiserContentDetail';
import { useRole } from '@hooks/useRole';

type TimeRange = '7d' | '30d' | 'custom';

const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 50;
const TIMESTAMPS_MAX_DAYS = 30;

const isTimeRange = (v: string): v is TimeRange => v === '7d' || v === '30d' || v === 'custom';

const formatYmd = (d: Date): string => {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const presetRange = (preset: '7d' | '30d'): { dateFrom: string; dateTo: string } => {
  const now = new Date();
  const days = preset === '7d' ? 7 : 30;
  return {
    dateFrom: formatYmd(new Date(now.getTime() - days * MS_PER_DAY)),
    dateTo: formatYmd(now),
  };
};

interface ResolvedFilter {
  readonly timeRange: TimeRange;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly page: number;
}

const resolveFromUrl = (params: URLSearchParams): ResolvedFilter => {
  const tr = params.get('timeRange');
  const range = tr !== null && isTimeRange(tr) ? tr : '30d';
  const pageParam = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  if (range === 'custom') {
    const dateFrom = params.get('dateFrom') ?? '';
    const dateTo = params.get('dateTo') ?? '';
    if (dateFrom !== '' && dateTo !== '') {
      return { timeRange: 'custom', dateFrom, dateTo, page };
    }
  }
  const preset = range === 'custom' ? '30d' : range;
  const r = presetRange(preset);
  return { timeRange: preset, dateFrom: r.dateFrom, dateTo: r.dateTo, page };
};

const daysBetween = (dateFrom: string, dateTo: string): number => {
  const a = new Date(`${dateFrom}T00:00:00Z`).getTime();
  const b = new Date(`${dateTo}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
};

const formatPretty = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatTimestamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Tashkent local — matches the rest of the app's Asia/Tashkent (UTC+5) display.
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const filenameFromHeaders = (headers: unknown): string | null => {
  if (typeof headers !== 'object' || headers === null) return null;
  const disp = (headers as Record<string, unknown>)['content-disposition'];
  if (typeof disp !== 'string') return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
  return match?.[1] ?? null;
};

const exportErrorMessage = (err: unknown, t: TFunction): string => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) {
      return t('advertiserContentDetailPage.exportErrorNetwork');
    }
    if (status === 403) {
      return t('advertiserContentDetailPage.exportErrorForbidden');
    }
    if (status === 429) {
      return t('advertiserContentDetailPage.exportErrorRateLimited');
    }
    if (status === 408 || status === 504 || status === 413) {
      return t('advertiserContentDetailPage.exportErrorTooLarge');
    }
    if (status >= 500) {
      return t('advertiserContentDetailPage.exportErrorServer');
    }
  }
  return t('advertiserContentDetailPage.exportErrorGeneric');
};

// Strip any character that's risky in a download filename (cross-platform).
const safeFilenameSegment = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);

export const AdvertiserContentDetailPage = () => {
  const { t } = useTranslation();
  const { contentId = '' } = useParams<{ contentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // The Excel export endpoint is ADMIN/OPERATOR-only — an advertiser always
  // gets a 403 (RS-1). Hide the control for that role rather than offer a
  // button that can only fail; the 403 branch in exportErrorMessage covers any
  // other role that somehow hits it.
  const role = useRole();
  const canExport = role !== 'advertiser';
  const active = useMemo(() => resolveFromUrl(searchParams), [searchParams]);

  const [localTimeRange, setLocalTimeRange] = useState<TimeRange>(active.timeRange);
  const [localDateFrom, setLocalDateFrom] = useState(active.dateFrom);
  const [localDateTo, setLocalDateTo] = useState(active.dateTo);

  useEffect(() => {
    setLocalTimeRange(active.timeRange);
    setLocalDateFrom(active.dateFrom);
    setLocalDateTo(active.dateTo);
  }, [active.timeRange, active.dateFrom, active.dateTo]);

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
    // Reset to page 1 whenever the date scope changes — old offsets are no
    // longer meaningful against a different result set.
    setSearchParams(next);
  };

  const setPage = (page: number): void => {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    setSearchParams(next);
  };

  const days = daysBetween(active.dateFrom, active.dateTo);
  const aggregateOnly = days > TIMESTAMPS_MAX_DAYS;

  const detailFilter = useMemo(
    () => ({ dateFrom: active.dateFrom, dateTo: active.dateTo }),
    [active.dateFrom, active.dateTo],
  );
  const {
    detail,
    isLoading: detailLoading,
    error: detailError,
    notFound,
    retry: retryDetail,
  } = useAdvertiserContentDetail(contentId, detailFilter);

  const playsQuery = useMemo(
    () => ({
      contentId,
      dateFrom: active.dateFrom,
      dateTo: active.dateTo,
      page: active.page,
      size: PAGE_SIZE,
      enabled: !aggregateOnly,
    }),
    [contentId, active.dateFrom, active.dateTo, active.page, aggregateOnly],
  );
  const {
    items: plays,
    totalItems: playsTotal,
    totalPages: playsPages,
    isLoading: playsLoading,
    error: playsError,
    retry: retryPlays,
  } = useAdvertiserContentPlays(playsQuery);

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!exporting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [exporting]);

  const onExport = (): void => {
    if (exporting || contentId === '') return;
    setExporting(true);
    void (async () => {
      try {
        // Spec: GET /api/reports/export streams the workbook with a `type`
        // selector. STATS gives a per-content play-count sheet over the
        // date window — that's the per-advertiser-content report.
        const response = await http.get(`/api/reports/export`, {
          params: {
            type: 'STATS',
            from: `${active.dateFrom}T00:00:00Z`,
            to: `${active.dateTo}T23:59:59Z`,
          },
          responseType: 'blob',
          // Server-side workbook generation can take a while on long ranges
          // — disable axios timeout so we don't kill long exports prematurely.
          timeout: 0,
          _suppressErrorToast: true,
        });
        const blob = response.data as Blob;
        const baseName = detail !== null ? safeFilenameSegment(detail.filename) : 'content';
        const fallback = `play-history-${baseName}-${active.dateFrom}_to_${active.dateTo}.xlsx`;
        const filename = filenameFromHeaders(response.headers) ?? fallback;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify.success(t('advertiserContentDetailPage.exportSuccess', { filename }));
      } catch (err: unknown) {
        notify.error(exportErrorMessage(err, t));
      } finally {
        setExporting(false);
      }
    })();
  };

  const perDeviceColumns: readonly Column<PerDeviceRow>[] = useMemo(
    () => [
      {
        key: 'deviceName',
        header: t('advertiserContentDetailPage.colDevice'),
        render: (r) => r.deviceName,
      },
      {
        key: 'plays',
        header: t('advertiserContentDetailPage.colPlays'),
        align: 'right',
        width: '140px',
        render: (r) => r.plays.toLocaleString(),
      },
    ],
    [t],
  );

  const playsColumns: readonly Column<PlayTimestamp>[] = useMemo(
    () => [
      {
        key: 'playedAt',
        header: t('advertiserContentDetailPage.colPlayedAt'),
        render: (r) => <span className="oa-mono">{formatTimestamp(r.playedAt)}</span>,
      },
      {
        key: 'deviceName',
        header: t('advertiserContentDetailPage.colDevice'),
        render: (r) => r.deviceName,
      },
    ],
    [t],
  );

  if (notFound) {
    return (
      <section className="oa-content-detail">
        <Link to="/dashboard" className="oa-content-detail__back">
          ← {t('advertiserContentDetailPage.backToContent')}
        </Link>
        <EmptyState
          title={t('advertiserContentDetailPage.notFoundTitle')}
          description={t('advertiserContentDetailPage.notFoundDescription')}
        />
      </section>
    );
  }

  return (
    <section className="oa-content-detail">
      <Link to="/dashboard" className="oa-content-detail__back">
        ← {t('advertiserContentDetailPage.backToContent')}
      </Link>

      <header className="oa-content-detail__header">
        <div className="oa-content-detail__title-block">
          {detailLoading && detail === null ? (
            <div className="oa-content-detail__title-skeleton" aria-hidden="true" />
          ) : (
            <h1 className="oa-content-detail__title" title={detail?.filename ?? ''}>
              {detail?.filename ?? t('advertiserContentDetailPage.contentFallback')}
            </h1>
          )}
          <p className="oa-content-detail__subtitle">
            {t('advertiserContentDetailPage.subtitle')}
          </p>
        </div>
        {canExport && (
          <div className="oa-content-detail__top-actions">
            <Button
              variant="secondary"
              onClick={onExport}
              isLoading={exporting}
              disabled={exporting || detail === null}
            >
              {exporting
                ? t('advertiserContentDetailPage.exportPreparing')
                : t('advertiserContentDetailPage.exportExcel')}
            </Button>
          </div>
        )}
      </header>

      <div className="oa-advertiser__filter">
        <fieldset className="oa-advertiser__range">
          <legend>{t('advertiserContentDetailPage.dateRange')}</legend>
          <div className="oa-advertiser__range-options" role="radiogroup">
            {(['7d', '30d', 'custom'] as const).map((range) => (
              <label
                key={range}
                className={`oa-advertiser__range-option${
                  localTimeRange === range ? ' oa-advertiser__range-option--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="contentDetailTimeRange"
                  value={range}
                  checked={localTimeRange === range}
                  onChange={() => {
                    setLocalTimeRange(range);
                  }}
                />
                <span>
                  {range === '7d'
                    ? t('advertiserContentDetailPage.last7Days')
                    : range === '30d'
                      ? t('advertiserContentDetailPage.last30Days')
                      : t('advertiserContentDetailPage.custom')}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {isCustom && (
          <div className="oa-advertiser__custom">
            <div className="oa-field">
              <label htmlFor="oa-cd-from" className="oa-field__label">
                {t('advertiserContentDetailPage.from')}
              </label>
              <input
                id="oa-cd-from"
                type="date"
                className="oa-field__input"
                value={localDateFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setLocalDateFrom(e.target.value);
                }}
              />
            </div>
            <div className="oa-field">
              <label htmlFor="oa-cd-to" className="oa-field__label">
                {t('advertiserContentDetailPage.to')}
              </label>
              <input
                id="oa-cd-to"
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

        {customRangeInvalid && (
          <p className="oa-advertiser__error" role="alert">
            {t('advertiserContentDetailPage.customRangeInvalid')}
          </p>
        )}

        <div className="oa-advertiser__actions">
          <Button variant="primary" onClick={onApply} disabled={!canApply}>
            {t('advertiserContentDetailPage.apply')}
          </Button>
        </div>
      </div>

      {detailError !== null ? (
        <div className="oa-advertiser__panel-error" role="alert">
          <p>{detailError}</p>
          <Button variant="primary" size="sm" onClick={retryDetail}>
            {t('advertiserContentDetailPage.retry')}
          </Button>
        </div>
      ) : (
        <>
          <article
            className="oa-advertiser__total"
            aria-label={t('advertiserContentDetailPage.totalPlays')}
          >
            <div>
              <span className="oa-advertiser__total-label">
                {t('advertiserContentDetailPage.totalPlays')}
              </span>
              <span className="oa-advertiser__total-value">
                {detailLoading && detail === null
                  ? '—'
                  : (detail?.totalPlays ?? 0).toLocaleString()}
              </span>
            </div>
            <span className="oa-advertiser__total-hint">
              {formatPretty(active.dateFrom)} — {formatPretty(active.dateTo)}
            </span>
          </article>

          <article className="oa-card oa-content-detail__panel">
            <header className="oa-panel-header">
              <h2>{t('advertiserContentDetailPage.playsPerDevice')}</h2>
            </header>
            {detail === null && detailLoading ? (
              <div className="oa-summary-skeleton" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="oa-summary-skeleton__row" />
                ))}
              </div>
            ) : detail === null || detail.perDevice.length === 0 ? (
              <EmptyState
                title={t('advertiserContentDetailPage.noPlaysTitle')}
                description={t('advertiserContentDetailPage.noPlaysPerDeviceDescription')}
              />
            ) : (
              <Table
                columns={perDeviceColumns}
                data={detail.perDevice}
                rowKey={(r) => r.deviceId}
              />
            )}
          </article>

          <article className="oa-card oa-content-detail__panel">
            <header className="oa-panel-header">
              <h2>{t('advertiserContentDetailPage.playTimestamps')}</h2>
              {!aggregateOnly && playsTotal > 0 && (
                <span className="oa-content-detail__count">
                  {t('advertiserContentDetailPage.playCount', {
                    count: playsTotal,
                    formatted: playsTotal.toLocaleString(),
                  })}
                </span>
              )}
            </header>

            {aggregateOnly ? (
              <div className="oa-content-detail__notice" role="note">
                <Trans
                  i18nKey="advertiserContentDetailPage.aggregateNotice"
                  values={{ max: TIMESTAMPS_MAX_DAYS, days }}
                  components={{ strong: <strong /> }}
                />
              </div>
            ) : playsError !== null ? (
              <div className="oa-advertiser__panel-error" role="alert">
                <p>{playsError}</p>
                <Button variant="primary" size="sm" onClick={retryPlays}>
                  {t('advertiserContentDetailPage.retry')}
                </Button>
              </div>
            ) : playsLoading ? (
              <div className="oa-summary-skeleton" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="oa-summary-skeleton__row" />
                ))}
              </div>
            ) : plays.length === 0 ? (
              <EmptyState
                title={t('advertiserContentDetailPage.noPlaysTitle')}
                description={t('advertiserContentDetailPage.noPlaysDescription')}
              />
            ) : (
              <>
                <Table columns={playsColumns} data={plays} rowKey={(r) => r.id} />
                {playsPages > 1 && (
                  <div className="oa-content-detail__pagination">
                    <Pagination
                      currentPage={active.page}
                      totalPages={playsPages}
                      onPageChange={setPage}
                    />
                  </div>
                )}
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
};
