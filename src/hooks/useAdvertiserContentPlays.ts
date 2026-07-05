import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';

export interface PlayTimestamp {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly playedAt: string;
}

export interface ContentPlaysQuery {
  readonly contentId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly page: number;
  readonly size: number;
  // When true the hook stays inert — used to suppress the per-event
  // request when the date range is too wide for the backend to materialise.
  readonly enabled: boolean;
}

export interface UseAdvertiserContentPlaysResult {
  readonly items: readonly PlayTimestamp[];
  readonly totalItems: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

interface ParsedPage {
  readonly items: readonly PlayTimestamp[];
  readonly totalItems: number;
  readonly totalPages: number;
}

// Spec ContentStatsResponse.timestamps is a TimestampsPage:
//   { content: ['iso',...], page, size, totalElements, totalPages }
// The timestamp page carries no per-row deviceId, so the FE table's "Device"
// column shows '—' here.
const sanitize = (data: unknown, size: number): ParsedPage => {
  if (typeof data !== 'object' || data === null) {
    return { items: [], totalItems: 0, totalPages: 0 };
  }
  const root = data as Record<string, unknown>;
  const tsRoot =
    typeof root.timestamps === 'object' && root.timestamps !== null
      ? (root.timestamps as Record<string, unknown>)
      : root;
  const arr = Array.isArray(tsRoot.content)
    ? tsRoot.content
    : Array.isArray(root.data)
      ? root.data
      : [];
  const items: PlayTimestamp[] = [];
  arr.forEach((e, i) => {
    if (typeof e === 'string') {
      // Synthetic id — the response gives only timestamps.
      items.push({ id: `${String(i)}|${e}`, deviceId: '', deviceName: '—', playedAt: e });
    }
  });
  const totalItems =
    typeof tsRoot.totalElements === 'number' && Number.isFinite(tsRoot.totalElements)
      ? Math.max(0, Math.floor(tsRoot.totalElements))
      : items.length;
  const totalPages =
    typeof tsRoot.totalPages === 'number' && Number.isFinite(tsRoot.totalPages)
      ? Math.max(0, Math.floor(tsRoot.totalPages))
      : Math.max(1, Math.ceil(totalItems / Math.max(1, size)));
  return { items, totalItems, totalPages };
};

export const useAdvertiserContentPlays = (
  query: ContentPlaysQuery,
): UseAdvertiserContentPlaysResult => {
  const [items, setItems] = useState<readonly PlayTimestamp[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!query.enabled || query.contentId === '') {
      setItems([]);
      setTotalItems(0);
      setTotalPages(0);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    http
      .get<unknown>(`/api/stats/content/${encodeURIComponent(query.contentId)}`, {
        // Spec uses `from`/`to` ISO date-time + Spring Pageable (0-indexed).
        params: {
          from: `${query.dateFrom}T00:00:00Z`,
          to: `${query.dateTo}T23:59:59Z`,
          page: Math.max(0, query.page - 1),
          size: query.size,
        },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitize(data, query.size);
        setItems(parsed.items);
        setTotalItems(parsed.totalItems);
        setTotalPages(parsed.totalPages);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setItems([]);
        setError('Could not load play timestamps.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    query.enabled,
    query.contentId,
    query.dateFrom,
    query.dateTo,
    query.page,
    query.size,
    refreshKey,
  ]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { items, totalItems, totalPages, isLoading, error, retry };
};
