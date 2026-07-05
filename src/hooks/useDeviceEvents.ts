import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';

export type DeviceEventType = 'STATUS_CHANGE' | 'CONTENT_SYNC' | 'INCIDENT' | 'COMMAND' | 'BOOT';

export type EventPriority = 'critical' | 'high' | 'medium' | 'low';

export interface DeviceEvent {
  readonly id: string;
  readonly type: DeviceEventType;
  readonly message: string;
  readonly occurredAt: string;
  readonly priority?: EventPriority;
  readonly metadata?: string;
}

export interface DeviceEventsOptions {
  size?: number;
  page?: number;
}

export interface DeviceEventsState {
  readonly events: readonly DeviceEvent[];
  readonly totalItems: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
}

const DEFAULT_LIMIT = 10;

const isEventType = (v: unknown): v is DeviceEventType =>
  v === 'STATUS_CHANGE' ||
  v === 'CONTENT_SYNC' ||
  v === 'INCIDENT' ||
  v === 'COMMAND' ||
  v === 'BOOT';

const isPriority = (v: unknown): v is EventPriority =>
  v === 'critical' || v === 'high' || v === 'medium' || v === 'low';

// Spec EventDto: { id (number), deviceId (number), eventType (string),
// priority (UPPER), payload (string), occurredAt, createdAt }. The FE's
// DeviceEvent shape uses lowercase priority and a free-form `type` enum;
// map case-insensitively and let unknown event types through as 'INCIDENT'
// (closest neutral default) since the spec doesn't constrain the value.
const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const mapEventType = (raw: unknown): DeviceEvent['type'] => {
  const v = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (isEventType(v)) return v;
  // Spec backend types like DEVICE_OFFLINE, CONTENT_SYNC, PLAYBACK_STARTED…
  // None of those map cleanly to the FE enum. 'INCIDENT' keeps the row
  // visible without claiming a specific category.
  return 'INCIDENT';
};

const sanitizeEvent = (v: unknown): DeviceEvent | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = idStr(r.id);
  const occurredAt = typeof r.occurredAt === 'string' ? r.occurredAt : '';
  if (id === null || occurredAt === '') return null;
  const type = mapEventType(r.eventType ?? r.type);
  const message =
    typeof r.message === 'string' ? r.message : typeof r.payload === 'string' ? r.payload : '';
  const base = { id, type, message, occurredAt };
  const priorityRaw = typeof r.priority === 'string' ? r.priority.toLowerCase() : null;
  return {
    ...base,
    ...(priorityRaw && isPriority(priorityRaw) ? { priority: priorityRaw } : {}),
    ...(typeof r.metadata === 'string' ? { metadata: r.metadata } : {}),
  };
};

interface ParsedResponse {
  readonly events: readonly DeviceEvent[];
  readonly totalItems: number;
  readonly totalPages: number;
}

const sanitize = (data: unknown, size: number): ParsedResponse => {
  let arr: unknown[] = [];
  let totalItems = 0;
  let serverTotalPages: number | null = null;

  // Spec PageEventDto: `content[]`, `totalElements`, `totalPages`. Tolerate
  // older `data`/`totalItems` envelopes for resilience.
  if (Array.isArray(data)) {
    arr = data;
    totalItems = data.length;
  } else if (typeof data === 'object' && data !== null) {
    const v = data as Record<string, unknown>;
    if (Array.isArray(v.content)) arr = v.content;
    else if (Array.isArray(v.data)) arr = v.data;
    if (typeof v.totalElements === 'number' && Number.isFinite(v.totalElements)) {
      totalItems = Math.max(0, Math.floor(v.totalElements));
    } else if (typeof v.totalItems === 'number' && Number.isFinite(v.totalItems)) {
      totalItems = Math.max(0, Math.floor(v.totalItems));
    } else {
      totalItems = arr.length;
    }
    if (typeof v.totalPages === 'number' && Number.isFinite(v.totalPages)) {
      serverTotalPages = Math.max(0, Math.floor(v.totalPages));
    }
  }

  const events: DeviceEvent[] = [];
  for (const e of arr) {
    const ev = sanitizeEvent(e);
    if (ev) events.push(ev);
  }

  const totalPages = serverTotalPages ?? Math.max(1, Math.ceil(totalItems / Math.max(1, size)));
  return { events, totalItems, totalPages };
};

export const useDeviceEvents = (
  id: string | undefined,
  options: DeviceEventsOptions = {},
): DeviceEventsState => {
  const size = options.size ?? DEFAULT_LIMIT;
  const page = options.page ?? 1;

  const [events, setEvents] = useState<readonly DeviceEvent[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (id === undefined || id === '') {
      setEvents([]);
      setTotalItems(0);
      setTotalPages(0);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    let cancelled = false;
    const controller = new AbortController();

    // Spec has no `/api/devices/:id/events`. Use the global events list with
    // `deviceId=` filter and Spring Pageable (0-indexed).
    http
      .get<unknown>('/api/events', {
        params: { deviceId: id, page: Math.max(0, page - 1), size },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled) return;
        const parsed = sanitize(data, size);
        setEvents(parsed.events);
        setTotalItems(parsed.totalItems);
        setTotalPages(parsed.totalPages);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setEvents([]);
        setTotalItems(0);
        setTotalPages(0);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, size, page]);

  return { events, totalItems, totalPages, isLoading };
};
