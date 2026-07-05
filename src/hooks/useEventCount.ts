import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import type { EventFilter } from './useEvents';

export interface UseEventCountResult {
  readonly count: number | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

// Mirror useEvents' query-param shape exactly so the count call hits the
// same row set the list call does.
const buildParams = (filter: EventFilter): Record<string, string> => {
  const params: Record<string, string> = {};
  if (filter.deviceId) params.deviceId = filter.deviceId;
  if (filter.facility) params.facilityId = filter.facility;
  if (filter.dateFrom) params.from = filter.dateFrom;
  if (filter.dateTo) params.to = filter.dateTo;
  if (filter.priorities.length > 0) {
    params.priority = String(filter.priorities[0]).toUpperCase();
  }
  return params;
};

const sanitizeCount = (data: unknown): number | null => {
  if (typeof data === 'number' && Number.isFinite(data)) return Math.max(0, Math.floor(data));
  if (typeof data === 'object' && data !== null) {
    const v = data as Record<string, unknown>;
    const candidates = [v.count, v.total, v.totalItems];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c)) return Math.max(0, Math.floor(c));
    }
  }
  return null;
};

const filterKey = (filter: EventFilter | null): string => {
  if (filter === null) return '';
  return [
    filter.deviceId,
    filter.facility,
    filter.dateFrom,
    filter.dateTo,
    [...filter.priorities].sort().join(','),
  ].join('|');
};

export const useEventCount = (filter: EventFilter | null): UseEventCountResult => {
  const [count, setCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = filterKey(filter);

  useEffect(() => {
    if (filter === null) {
      setCount(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setCount(null);

    // Spec exposes no /api/events/count. Use the events list endpoint with
    // the smallest possible page and read `totalElements` from the Spring
    // Pageable response.
    http
      .get<unknown>('/api/events', {
        params: { ...buildParams(filter), page: 0, size: 1 },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const v =
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
        const n =
          typeof v.totalElements === 'number'
            ? Math.max(0, Math.floor(v.totalElements))
            : sanitizeCount(data);
        setCount(n);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setError('Could not estimate count.');
        setCount(null);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { count, isLoading, error };
};
