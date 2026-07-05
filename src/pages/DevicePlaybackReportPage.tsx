import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, type Column, SearchableSelect, Table } from '@components';
import { useDeviceOptions } from '@hooks/useDeviceOptions';
import {
  useDevicePlaybackReport,
  type DevicePlaybackReportFilter,
} from '@hooks/useDevicePlaybackReport';
import type { PlaybackByContentRow } from '@api/resources/playbackReport';
import { formatDuration, totalMinutes } from '@/utils/formatDuration';

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * `/reports/playback` — pick a device + date range, see what it played (content
 * name, play count, total duration). Built around a scope concept (today only
 * "Device"); adding Region/Group later = a scope option + id-picker + endpoint,
 * with the table/formatter/totals untouched (the response shape is scope-agnostic).
 */
export const DevicePlaybackReportPage = () => {
  const { t } = useTranslation();
  const deviceOptions = useDeviceOptions();

  // Form state.
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(isoDaysAgo(7));
  const [dateTo, setDateTo] = useState<string>(isoToday());

  // Applied filter (only set on Apply); null ⇒ hook inert.
  const [filter, setFilter] = useState<DevicePlaybackReportFilter | null>(null);
  const report = useDevicePlaybackReport(filter);

  // String compare is valid for YYYY-MM-DD; blocks the request client-side.
  const rangeInvalid = dateFrom > dateTo;
  const canApply = deviceId !== null && !rangeInvalid;

  const onApply = (): void => {
    // `canApply` aliases `deviceId !== null && !rangeInvalid`, so TS narrows
    // deviceId to a number here — no extra null check needed.
    if (!canApply) return;
    setFilter({ deviceId, dateFrom, dateTo });
  };

  const columns: readonly Column<PlaybackByContentRow>[] = useMemo(
    () => [
      {
        key: 'contentFileName',
        header: t('devicePlaybackReportPage.colContent'),
        render: (r) => r.contentFileName,
      },
      {
        key: 'playCount',
        header: t('devicePlaybackReportPage.colTimesPlayed'),
        align: 'right',
        width: '140px',
        render: (r) => String(r.playCount),
      },
      {
        key: 'totalDurationSeconds',
        header: t('devicePlaybackReportPage.colTotalDuration'),
        align: 'right',
        width: '160px',
        render: (r) =>
          r.durationComplete ? (
            formatDuration(r.totalDurationSeconds)
          ) : (
            <span title={t('devicePlaybackReportPage.durationIncompleteTooltip')}>
              {'≥ '}
              {formatDuration(r.totalDurationSeconds)}
            </span>
          ),
      },
    ],
    [t],
  );

  // notFound (404) is distinct from a generic load error: on 404 the hook sets
  // notFound=true while error stays null, so the error panel must check both.
  const showErrorPanel = report.error !== null || report.notFound;

  return (
    <section className="oa-reports">
      <header className="oa-reports__header">
        <div>
          <h1>{t('devicePlaybackReportPage.title')}</h1>
          <p className="oa-reports__hint">{t('devicePlaybackReportPage.hint')}</p>
        </div>
      </header>

      {/* Filter bar: scope = Device (today the only scope) + date range + Apply. */}
      <div className="oa-reports__filter">
        <div className="oa-reports__scope">
          <SearchableSelect
            label={t('devicePlaybackReportPage.device')}
            placeholder={t('devicePlaybackReportPage.devicePlaceholder')}
            options={deviceOptions.options.map((o) => ({ value: String(o.value), label: o.label }))}
            value={deviceId === null ? '' : String(deviceId)}
            onChange={(v) => {
              setDeviceId(v === '' ? null : Number(v));
            }}
            isLoading={deviceOptions.isLoading}
            error={deviceOptions.error ?? undefined}
            onRetry={deviceOptions.retry}
          />
          <div className="oa-field">
            <label htmlFor="oa-playback-from" className="oa-field__label">
              {t('devicePlaybackReportPage.from')}
            </label>
            <input
              id="oa-playback-from"
              type="date"
              className="oa-field__input"
              value={dateFrom}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setDateFrom(e.target.value);
              }}
            />
          </div>
          <div className="oa-field">
            <label htmlFor="oa-playback-to" className="oa-field__label">
              {t('devicePlaybackReportPage.to')}
            </label>
            <input
              id="oa-playback-to"
              type="date"
              className="oa-field__input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setDateTo(e.target.value);
              }}
              aria-invalid={rangeInvalid ? true : undefined}
            />
          </div>
        </div>

        <div className="oa-reports__actions">
          <Button variant="primary" disabled={!canApply} onClick={onApply}>
            {t('devicePlaybackReportPage.apply')}
          </Button>
        </div>
      </div>

      {showErrorPanel ? (
        <div className="oa-reports__panel-error" role="alert">
          <p>
            {report.notFound
              ? t('devicePlaybackReportPage.deviceNotFound')
              : t('devicePlaybackReportPage.errorLoad')}
          </p>
          {!report.notFound && (
            <Button variant="primary" size="sm" onClick={report.retry}>
              {t('devicePlaybackReportPage.retry')}
            </Button>
          )}
        </div>
      ) : (
        <article className="oa-card">
          {report.data !== null && (
            <div className="oa-report-totals" role="status">
              <span>
                {t('devicePlaybackReportPage.totalPlaysLabel', {
                  count: report.data.totalPlayCount,
                })}
              </span>
              <span>
                {t('devicePlaybackReportPage.totalDurationLabel', {
                  hms: formatDuration(report.data.totalDurationSeconds),
                  minutes: totalMinutes(report.data.totalDurationSeconds),
                })}
                {!report.data.durationComplete && (
                  <span title={t('devicePlaybackReportPage.durationIncompleteTooltip')}>
                    {' ≥'}
                  </span>
                )}
              </span>
            </div>
          )}
          <Table<PlaybackByContentRow>
            columns={columns}
            data={report.data?.perContent ?? []}
            rowKey={(r) => String(r.contentFileId)}
            isLoading={report.isLoading}
            emptyTitle={t('devicePlaybackReportPage.emptyTitle')}
            emptyDescription={t('devicePlaybackReportPage.emptyDescription')}
          />
        </article>
      )}
    </section>
  );
};
