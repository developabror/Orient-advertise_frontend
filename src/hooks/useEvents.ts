import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import type { DeviceEventType, EventPriority } from './useDeviceEvents';

export interface EventFilter {
  readonly deviceId: string;
  readonly facility: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly priorities: readonly EventPriority[];
}

export interface FleetEvent {
  readonly id: string;
  readonly type: DeviceEventType;
  readonly deviceId: string;
  readonly facility: string;
  readonly message: string;
  readonly occurredAt: string;
  readonly priority?: EventPriority;
  readonly metadata?: string;
}

export interface UseEventsResult {
  readonly events: readonly FleetEvent[];
  readonly totalItems: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

const isEventType = (v: unknown): v is DeviceEventType =>
  v === 'STATUS_CHANGE' ||
  v === 'CONTENT_SYNC' ||
  v === 'INCIDENT' ||
  v === 'COMMAND' ||
  v === 'BOOT';

const isPriority = (v: unknown): v is EventPriority =>
  v === 'critical' || v === 'high' || v === 'medium' || v === 'low';

const sanitizeEvent = (v: unknown): FleetEvent | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    !isEventType(r.type) ||
    typeof r.deviceId !== 'string' ||
    typeof r.facility !== 'string' ||
    typeof r.message !== 'string' ||
    typeof r.occurredAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    type: r.type,
    deviceId: r.deviceId,
    facility: r.facility,
    message: r.message,
    occurredAt: r.occurredAt,
    ...(isPriority(r.priority) ? { priority: r.priority } : {}),
    ...(typeof r.metadata === 'string' ? { metadata: r.metadata } : {}),
  };
};

interface ParsedResponse {
  readonly events: readonly FleetEvent[];
  readonly totalItems: number;
  readonly totalPages: number;
}

const sanitize = (data: unknown, size: number): ParsedResponse => {
  let arr: unknown[] = [];
  let totalItems = 0;
  let serverTotalPages: number | null = null;

  if (Array.isArray(data)) {
    arr = data;
    totalItems = data.length;
  } else if (typeof data === 'object' && data !== null) {
    const v = data as Record<string, unknown>;
    if (Array.isArray(v.data)) arr = v.data;
    if (typeof v.totalItems === 'number' && Number.isFinite(v.totalItems)) {
      totalItems = Math.max(0, Math.floor(v.totalItems));
    } else {
      totalItems = arr.length;
    }
    if (typeof v.totalPages === 'number' && Number.isFinite(v.totalPages)) {
      serverTotalPages = Math.max(0, Math.floor(v.totalPages));
    }
  }

  const events: FleetEvent[] = [];
  for (const e of arr) {
    const ev = sanitizeEvent(e);
    if (ev) events.push(ev);
  }

  const totalPages = serverTotalPages ?? Math.max(1, Math.ceil(totalItems / Math.max(1, size)));
  return { events, totalItems, totalPages };
};

// Spec query params: deviceId, facilityId, from, to, priority (single
// uppercase enum), pageable. The FE's `dateFrom`/`dateTo` map to `from`/`to`
// (kept as ISO date-time strings) and the priority list is collapsed to its
// first value since the backend takes one priority filter at a time.
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

export const useEvents = (
  filter: EventFilter | null,
  page: number,
  size: number,
): UseEventsResult => {
  const [events, setEvents] = useState<readonly FleetEvent[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const key = filterKey(filter);

  useEffect(() => {
    if (filter === null) {
      setEvents([]);
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
      .get<unknown>('/api/events', {
        params: { ...buildParams(filter), page, size, sort: 'occurredAt,desc' },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitize(data, size);
        setEvents(parsed.events);
        setTotalItems(parsed.totalItems);
        setTotalPages(parsed.totalPages);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setEvents([]);
        setError('Could not load events.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Filter-key collapses object identity into a stable string so callers can
    // pass a fresh object each render without triggering refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, size, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { events, totalItems, totalPages, isLoading, error, retry };
};
