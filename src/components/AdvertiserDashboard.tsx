import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAdvertiserStats } from '@hooks/useAdvertiserStats';
import { useAuth } from '@hooks/useAuth';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

type TimeRange = '7d' | '30d' | 'custom';

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

interface ResolvedFilter {
  readonly timeRange: TimeRange;
  readonly dateFrom: string;
  readonly dateTo: string;
}

const resolveFromUrl = (params: URLSearchParams): ResolvedFilter => {
  const tr = params.get('timeRange');
  const range = tr !== null && isTimeRange(tr) ? tr : '30d';
  if (range === 'custom') {
    const dateFrom = params.get('dateFrom') ?? '';
    const dateTo = params.get('dateTo') ?? '';
    if (dateFrom !== '' && dateTo !== '') {
      return { timeRange: 'custom', dateFrom, dateTo };
    }
  }
  const preset = range === 'custom' ? '30d' : range;
  const r = presetRange(preset);
  return { timeRange: preset, dateFrom: r.dateFrom, dateTo: r.dateTo };
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

export const AdvertiserDashboard = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
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
    setSearchParams(next);
  };

  const { content, rows, totalPlays, isLoading, error, retry } = useAdvertiserStats({
    dateFrom: active.dateFrom,
    dateTo: active.dateTo,
  });

  // Forward the active filter to the detail page so opening a card lands on
  // the same date scope. Custom range carries from/to; presets just carry the
  // range key and the detail page recomputes from "now".
  const detailLinkSearch = useMemo(() => {
    const p = new URLSearchParams();
    p.set('timeRange', active.timeRange);
    if (active.timeRange === 'custom') {
      p.set('dateFrom', active.dateFrom);
      p.set('dateTo', active.dateTo);
    }
    const s = p.toString();
    return s === '' ? '' : `?${s}`;
  }, [active.timeRange, active.dateFrom, active.dateTo]);

  return (
    <section className="oa-advertiser">
      <header className="oa-advertiser__header">
        <div>
          <h1 className="oa-advertiser__title">{t('advertiserDashboard.title')}</h1>
          {user && (
            <p className="oa-advertiser__subtitle">
              <Trans
                i18nKey="advertiserDashboard.signedInAs"
                values={{ user: user.sub }}
                components={{ strong: <strong /> }}
              />
            </p>
          )}
        </div>
      </header>

      <div className="oa-advertiser__filter">
        <fieldset className="oa-advertiser__range">
          <legend>{t('advertiserDashboard.dateRange')}</legend>
          <div className="oa-advertiser__range-options" role="radiogroup">
            {(['7d', '30d', 'custom'] as const).map((opt) => (
              <label
                key={opt}
                className={`oa-advertiser__range-option${
                  localTimeRange === opt ? ' oa-advertiser__range-option--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="advertiserTimeRange"
                  value={opt}
                  checked={localTimeRange === opt}
                  onChange={() => {
                    setLocalTimeRange(opt);
                  }}
                />
                <span>
                  {opt === '7d'
                    ? t('advertiserDashboard.last7Days')
                    : opt === '30d'
                      ? t('advertiserDashboard.last30Days')
                      : t('advertiserDashboard.custom')}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {isCustom && (
          <div className="oa-advertiser__custom">
            <div className="oa-field">
              <label htmlFor="oa-adv-from" className="oa-field__label">
                {t('advertiserDashboard.from')}
              </label>
              <input
                id="oa-adv-from"
                type="date"
                className="oa-field__input"
                value={localDateFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setLocalDateFrom(e.target.value);
                }}
              />
            </div>
            <div className="oa-field">
              <label htmlFor="oa-adv-to" className="oa-field__label">
                {t('advertiserDashboard.to')}
              </label>
              <input
                id="oa-adv-to"
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
            {t('advertiserDashboard.customRangeInvalid')}
          </p>
        )}

        <div className="oa-advertiser__actions">
          <Button variant="primary" onClick={onApply} disabled={!canApply}>
            {t('advertiserDashboard.apply')}
          </Button>
        </div>
      </div>

      {error !== null ? (
        <div className="oa-advertiser__panel-error" role="alert">
          <p>{error}</p>
          <Button variant="primary" size="sm" onClick={retry}>
            {t('advertiserDashboard.retry')}
          </Button>
        </div>
      ) : isLoading ? (
        <div className="oa-advertiser__skeleton" aria-hidden="true">
          <div className="oa-advertiser__skeleton-total" />
          <div className="oa-advertiser__skeleton-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="oa-advertiser__skeleton-card" />
            ))}
          </div>
        </div>
      ) : content.length === 0 ? (
        <EmptyState
          title={t('advertiserDashboard.emptyTitle')}
          description={t('advertiserDashboard.emptyDescription')}
        />
      ) : (
        <>
          <article className="oa-advertiser__total" aria-label={t('advertiserDashboard.totalPlays')}>
            <div>
              <span className="oa-advertiser__total-label">{t('advertiserDashboard.totalPlays')}</span>
              <span className="oa-advertiser__total-value">{totalPlays.toLocaleString()}</span>
            </div>
            <span className="oa-advertiser__total-hint">
              {formatPretty(active.dateFrom)} — {formatPretty(active.dateTo)}
            </span>
          </article>

          <div className="oa-advertiser__grid">
            {rows.map((r) => (
              <Link
                key={r.contentId}
                to={`/my-content/${encodeURIComponent(r.contentId)}${detailLinkSearch}`}
                className="oa-advertiser-card oa-advertiser-card--link"
                aria-label={t('advertiserDashboard.viewPlayHistory', { filename: r.filename })}
              >
                <span className="oa-advertiser-card__filename" title={r.filename}>
                  {r.filename}
                </span>
                <span className="oa-advertiser-card__plays">{r.plays.toLocaleString()}</span>
                <span className="oa-advertiser-card__plays-label">
                  {r.plays === 1
                    ? t('advertiserDashboard.playSingular')
                    : t('advertiserDashboard.playPlural')}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
