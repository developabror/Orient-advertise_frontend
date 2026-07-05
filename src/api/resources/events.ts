// Events resource — typed wrapper around GET /api/events.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';
import type { IncidentPriority } from '../wsClient';

/**
 * Backend `Priority` enum verbatim. Aliased from {@link IncidentPriority}
 * because the backend uses one enum across events and incidents — keeping
 * the alias means the two never drift on the FE side either.
 */
export type EventPriority = IncidentPriority;

export interface EventFilters {
  readonly deviceId?: number;
  readonly facilityId?: number;
  readonly from?: string;
  readonly to?: string;
  readonly priority?: EventPriority;
}

/**
 * Row shape from GET /api/events `content[]`. Mirrors the backend
 * `EventDto` record exactly. `priority` is a plain `string` rather than
 * the strict `EventPriority` enum because the events table is a firehose
 * — a server-side enum addition shouldn't drop rows from the FE.
 */
export interface EventDto {
  readonly id: number;
  readonly deviceId: number;
  readonly eventType: string;
  readonly priority: string;
  readonly payload: string;
  readonly occurredAt: string;
  readonly createdAt: string;
}

const MAX_PAGE_SIZE = 100;

const parseEventDto = (raw: unknown): EventDto => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.deviceId !== 'number' || !Number.isFinite(v.deviceId)) throw new Error('deviceId');
  if (typeof v.eventType !== 'string') throw new Error('eventType');
  if (typeof v.priority !== 'string') throw new Error('priority');
  if (typeof v.payload !== 'string') throw new Error('payload');
  if (typeof v.occurredAt !== 'string') throw new Error('occurredAt');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  return {
    id: v.id,
    deviceId: v.deviceId,
    eventType: v.eventType,
    priority: v.priority,
    payload: v.payload,
    occurredAt: v.occurredAt,
    createdAt: v.createdAt,
  };
};

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * GET /api/events.
 *
 * **Backend validation rules** — these all surface as a 400 thrown axios
 * error. The global response interceptor does NOT toast 4xx, so callers
 * should narrow on `err.response?.status === 400` and inspect
 * `err.response.data.message` (or `fieldErrors`) to render the right
 * inline message:
 *
 *  1. **At least one of `deviceId` / `facilityId` is required.** Calling
 *     with both omitted is a programming mistake — the endpoint exists
 *     to scope events to a device or facility, not to dump them all.
 *  2. **Date range must be ≤ 90 days.** `to - from > 90d` → 400.
 *  3. **`from` must be ≤ `to`.** Inverted ranges → 400.
 *
 * **Page size cap.** The backend caps `size` at 100; this resource
 * clamps the requested size client-side BEFORE sending so a programming
 * mistake (e.g. requesting 1000 thinking the server allows it) fails
 * fast as a clamp instead of round-tripping a 400.
 */
export const listEvents = async (
  filters: EventFilters,
  pageable: Pageable,
): Promise<Page<EventDto>> => {
  const clampedSize =
    pageable.size === undefined
      ? undefined
      : Math.min(MAX_PAGE_SIZE, Math.max(0, Math.floor(pageable.size)));
  const params = dropUndefined({
    deviceId: filters.deviceId,
    facilityId: filters.facilityId,
    from: filters.from,
    to: filters.to,
    priority: filters.priority,
    page: pageable.page,
    size: clampedSize,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/events', { params });
  return parsePage(data, parseEventDto);
};
