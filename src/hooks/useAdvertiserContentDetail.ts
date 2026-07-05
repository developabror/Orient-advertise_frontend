import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';

export interface PerDeviceRow {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly plays: number;
}

export interface AdvertiserContentDetail {
  readonly id: string;
  readonly filename: string;
  readonly totalPlays: number;
  readonly perDevice: readonly PerDeviceRow[];
}

export interface ContentDetailFilter {
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface UseAdvertiserContentDetailResult {
  readonly detail: AdvertiserContentDetail | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly notFound: boolean;
  readonly retry: () => void;
}

const safeNumber = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

// Spec ContentStatsResponse.perDevice = [{ deviceId, deviceName, playCount }].
const sanitizePerDevice = (data: unknown): readonly PerDeviceRow[] => {
  if (!Array.isArray(data)) return [];
  const rows: PerDeviceRow[] = [];
  for (const v of data) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    const deviceId = idStr(r.deviceId);
    if (deviceId === null) continue;
    rows.push({
      deviceId,
      deviceName: typeof r.deviceName === 'string' ? r.deviceName : deviceId,
      plays: safeNumber(r.playCount ?? r.plays),
    });
  }
  rows.sort((a, b) => b.plays - a.plays || a.deviceName.localeCompare(b.deviceName));
  return rows;
};

// Spec ContentStatsResponse:
//   { contentFileId, contentFileName, from, to, totalPlayCount,
//     perDevice[], timestampsIncluded, timestamps: TimestampsPage }
const sanitize = (data: unknown, fallbackId: string): AdvertiserContentDetail | null => {
  if (typeof data !== 'object' || data === null) return null;
  const v = data as Record<string, unknown>;
  const id = idStr(v.contentFileId ?? v.id) ?? fallbackId;
  const filename =
    typeof v.contentFileName === 'string'
      ? v.contentFileName
      : typeof v.filename === 'string'
        ? v.filename
        : '';
  if (filename === '' && id === '') return null;
  return {
    id,
    filename: filename || `Content #${id}`,
    totalPlays: safeNumber(v.totalPlayCount ?? v.totalPlays),
    perDevice: sanitizePerDevice(v.perDevice),
  };
};

export const useAdvertiserContentDetail = (
  contentId: string,
  filter: ContentDetailFilter,
): UseAdvertiserContentDetailResult => {
  const [detail, setDetail] = useState<AdvertiserContentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const key = `${contentId}|${filter.dateFrom}|${filter.dateTo}`;

  useEffect(() => {
    if (contentId === '') return;
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setNotFound(false);

    http
      .get<unknown>(`/api/stats/content/${encodeURIComponent(contentId)}`, {
        // Spec uses `from`/`to` (ISO date-time) with Spring Pageable. We only
        // need totals + perDevice here, so request the smallest possible page
        // — timestamps are fetched separately by the plays hook.
        params: {
          from: `${filter.dateFrom}T00:00:00Z`,
          to: `${filter.dateTo}T23:59:59Z`,
          page: 0,
          size: 1,
        },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitize(data, contentId);
        if (parsed === null) {
          setNotFound(true);
          setDetail(null);
        } else {
          setDetail(parsed);
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setNotFound(true);
          setDetail(null);
          setIsLoading(false);
          return;
        }
        setError('Could not load play stats for this content.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { detail, isLoading, error, notFound, retry };
};
