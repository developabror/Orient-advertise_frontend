import { useCallback, useEffect, useState } from 'react';

export interface ReportFilter {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly region: string;
  readonly facility: string;
}

export interface UptimeRow {
  // `date` is the natural key; left as `id` too so the row plays well with
  // Table-like consumers that key off `id`.
  readonly id: string;
  readonly date: string;
  readonly percent: number;
  readonly online: number;
  readonly total: number;
}

export interface UseUptimeReportResult {
  readonly rows: readonly UptimeRow[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

// Spec exposes no historical-uptime endpoint. The closest data source —
// `/api/dashboard/summary` — gives a single snapshot of online vs total,
// not a per-day series. Until the backend ships a time-series endpoint,
// this hook resolves to an empty list (no off-spec request) and the
// consuming page renders an empty state. When the BE adds the endpoint,
// re-introduce the http call here against that path.
export const useUptimeReport = (filter: ReportFilter | null): UseUptimeReportResult => {
  const [refreshKey, setRefreshKey] = useState(0);

  // Touch refreshKey so the lint rule for unused values is happy and a
  // future restoration of the http call has a working dependency hook.
  useEffect(() => {
    void refreshKey;
    void filter;
  }, [refreshKey, filter]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { rows: [], isLoading: false, error: null, retry };
};
