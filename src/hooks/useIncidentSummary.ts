import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import type { ReportFilter } from './useUptimeReport';

export interface IncidentSummaryRow {
  readonly id: string;
  readonly facility: string;
  readonly incidentCount: number;
  readonly criticalCount: number;
  // null when no incidents have been resolved yet — distinct from "0 minutes
  // average". Display layer renders this as a dash.
  readonly avgResolutionMinutes: number | null;
}

export interface UseIncidentSummaryResult {
  readonly rows: readonly IncidentSummaryRow[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

// GET /api/reports/events can answer synchronously (200, the rollup body) OR
// asynchronously (202, `{ status: 'PENDING', jobId }`). On the async path the
// rollup fields are absent, so `sanitize` would render an EMPTY table (RS-3) —
// we must poll the job to completion instead.
const POLL_DELAY_MS = 2_000;
const MAX_POLLS = 30; // ~60s ceiling before we surface "still generating".

const pendingJobId = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null;
  const v = body as Record<string, unknown>;
  return v.status === 'PENDING' && typeof v.jobId === 'string' ? v.jobId : null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const safeCount = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

// Spec: GET /api/reports/events returns ReportResponse — a single facility-
// level rollup with `topAffectedDevices: [{ deviceId, deviceName, eventCount }]`
// plus aggregate `incidentCount` and `avgResolutionSeconds`. We synthesise
// one IncidentSummaryRow per top-affected device — that's the FE's table
// model for "which facility/device is hurting most" and is the closest
// available analog. There is no per-facility breakdown endpoint to pivot on.
const sanitize = (data: unknown): readonly IncidentSummaryRow[] => {
  if (typeof data !== 'object' || data === null) return [];
  const v = data as Record<string, unknown>;
  const top = Array.isArray(v.topAffectedDevices) ? v.topAffectedDevices : [];
  const incidentCountTotal = safeCount(v.incidentCount);
  const avgSeconds =
    typeof v.avgResolutionSeconds === 'number' && Number.isFinite(v.avgResolutionSeconds)
      ? Math.max(0, v.avgResolutionSeconds)
      : null;
  const avgMinutes = avgSeconds === null ? null : Math.round(avgSeconds / 60);
  const rows: IncidentSummaryRow[] = [];
  for (const r of top) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    const id =
      typeof x.deviceId === 'string'
        ? x.deviceId
        : typeof x.deviceId === 'number'
          ? String(x.deviceId)
          : null;
    if (id === null) continue;
    rows.push({
      id,
      facility: typeof x.deviceName === 'string' ? x.deviceName : '—',
      incidentCount: safeCount(x.eventCount),
      // Per-device critical breakdown isn't available; use 0 unless this
      // happens to be the only affected device, in which case fold the
      // aggregate critical count into it.
      criticalCount: top.length === 1 ? incidentCountTotal : 0,
      avgResolutionMinutes: avgMinutes,
    });
  }
  return rows;
};

const filterKey = (filter: ReportFilter | null): string => {
  if (filter === null) return '';
  return [filter.dateFrom, filter.dateTo, filter.region, filter.facility].join('|');
};

const buildParams = (filter: ReportFilter): Record<string, string> => {
  const params: Record<string, string> = {
    from: `${filter.dateFrom}T00:00:00Z`,
    to: `${filter.dateTo}T23:59:59Z`,
  };
  // Spec only accepts facilityId — region scoping isn't supported here.
  if (filter.facility) params.facilityId = filter.facility;
  return params;
};

export const useIncidentSummary = (filter: ReportFilter | null): UseIncidentSummaryResult => {
  const [rows, setRows] = useState<readonly IncidentSummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const key = filterKey(filter);

  useEffect(() => {
    if (filter === null) {
      setRows([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const aborted = (): boolean => cancelled || controller.signal.aborted;
    setIsLoading(true);
    setError(null);

    const run = async (): Promise<void> => {
      try {
        const first = await http.get<unknown>('/api/reports/events', {
          params: buildParams(filter),
          signal: controller.signal,
          _suppressErrorToast: true,
        });
        if (aborted()) return;

        let body: unknown = first.data;
        const jobId = pendingJobId(body);
        if (jobId !== null) {
          // Async path: poll the job until it completes. isLoading stays true
          // throughout, so the page keeps showing its "generating" skeleton
          // rather than an empty result.
          let polls = 0;
          // `done` (did the job COMPLETE?) is tracked separately from the
          // result value: a COMPLETED job whose `result` is null/absent is a
          // valid "no data in window" outcome, NOT a timeout. Conflating the
          // two would resurrect the RS-3 bug on the async path (a completed
          // report shown as an error instead of an empty table).
          let done = false;
          let completed: unknown = null;
          while (polls < MAX_POLLS) {
            await sleep(POLL_DELAY_MS);
            if (aborted()) return;
            const jobRes = await http.get<unknown>(
              `/api/reports/events/jobs/${encodeURIComponent(jobId)}`,
              { signal: controller.signal, _suppressErrorToast: true },
            );
            if (aborted()) return;
            const job =
              typeof jobRes.data === 'object' && jobRes.data !== null
                ? (jobRes.data as Record<string, unknown>)
                : {};
            if (job.status === 'COMPLETED') {
              done = true;
              completed = job.result ?? null;
              break;
            }
            if (job.status === 'FAILED') {
              setRows([]);
              setError('Report generation failed. Try again.');
              setIsLoading(false);
              return;
            }
            polls += 1;
          }
          if (!done) {
            // Loop exhausted without completing — genuine timeout.
            setRows([]);
            setError('Report is still generating — try again shortly.');
            setIsLoading(false);
            return;
          }
          // Falls through to sanitize(body) below; sanitize(null) → [] renders
          // the correct empty table, matching the synchronous 200 path.
          body = completed;
        }

        setRows(sanitize(body));
        setIsLoading(false);
      } catch (err: unknown) {
        if (aborted() || axios.isCancel(err)) return;
        setRows([]);
        setError('Could not load incident summary.');
        setIsLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { rows, isLoading, error, retry };
};
