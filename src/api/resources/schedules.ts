// Schedules resource — wrappers around /api/schedules and
// /api/schedules/{id}. Both write (createSchedule / updateSchedule /
// deleteSchedule) AND read (listSchedules / getSchedule) endpoints
// live here as of FE-25; the BE-05 / BE-06 list and read-by-id
// endpoints are now merged.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

/** Backend `RepeatType` enum verbatim. */
export type RepeatType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

/**
 * Body for POST /api/schedules. All times are ISO-8601 UTC instants.
 * `repeatEndUtc` is required when `repeatType !== 'NONE'` and ignored
 * otherwise — the backend enforces this with a 400 if violated.
 */
export interface CreateScheduleRequest {
  readonly assignmentId: number;
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc?: string;
}

/**
 * Body for PUT /api/schedules/{id}. Note: `assignmentId` is NOT
 * mutable — it's bound at create time, so the update payload omits it.
 */
export interface UpdateScheduleRequest {
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc?: string;
}

/**
 * Single non-blocking warning emitted alongside a successful create or
 * update when the server detects a time-overlap with another schedule.
 * Mirrors the backend `OverlapWarningDto` schema verbatim — the schedule
 * **is saved**; the warning is informational so the operator can
 * decide whether to revisit. Compose a user-facing message from the
 * range fields client-side rather than expecting a server `message`.
 */
export interface OverlapWarning {
  readonly existingScheduleId: number;
  readonly newStart: string;
  readonly newEnd: string;
  readonly existingStart: string;
  readonly existingEnd: string;
}

/**
 * Mirror of the backend `ScheduleResponse` schema verbatim.
 * `overlapWarnings` is always present (empty array when there are no
 * conflicts) — the shape is stable so consumers can iterate without
 * null checks.
 */
export interface ScheduleResponse {
  readonly id: number;
  readonly assignmentId: number;
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc: string | null;
  readonly overlapWarnings: readonly OverlapWarning[];
}

/**
 * POST /api/schedules — create a schedule attached to an existing
 * assignment.
 *
 * **`overlapWarnings` is non-blocking.** When the new window overlaps
 * other schedules for the same assignment, the schedule is **still
 * saved** and the conflicts are returned alongside the DTO. Surface
 * them to the operator as **informational toasts**, not errors:
 *
 * ```ts
 * const res = await createSchedule(req);
 * for (const w of res.overlapWarnings) notify.info(w.message);
 * ```
 *
 * **400 surface — end-in-the-past validation.** When `endTimeUtc` is
 * before "now", the backend returns 400. The global response
 * interceptor does NOT toast 4xx, so the caller should narrow on
 * `err.response?.status === 400` and render this as an **inline form
 * error** on the end-time input, not a toast.
 */
export const createSchedule = async (
  req: CreateScheduleRequest,
): Promise<ScheduleResponse> => {
  const { data } = await http.post<ScheduleResponse>('/api/schedules', req);
  return data;
};

/**
 * PUT /api/schedules/{id} — update timing / repeat fields. The
 * `assignmentId` is immutable post-create and is therefore not
 * accepted in the body.
 *
 * Same `overlapWarnings` (non-blocking) and 400 (end-in-the-past form
 * error) contracts as {@link createSchedule}.
 */
export const updateSchedule = async (
  id: number,
  req: UpdateScheduleRequest,
): Promise<ScheduleResponse> => {
  const { data } = await http.put<ScheduleResponse>(
    `/api/schedules/${String(id)}`,
    req,
  );
  return data;
};

/**
 * DELETE /api/schedules/{id} — hard delete (schedules don't carry the
 * soft-delete trail that devices do — they're cheap to recreate).
 */
export const deleteSchedule = async (id: number): Promise<void> => {
  await http.delete(`/api/schedules/${String(id)}`);
};

export interface ScheduleListFilters {
  readonly assignmentId?: number;
  readonly repeatType?: RepeatType;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Row shape from GET /api/schedules `content[]`. Mirrors the backend
 * `ScheduleSummary` schema verbatim. Lighter than {@link ScheduleResponse}
 * — no `overlapWarnings` (those are emitted only at create/update time).
 */
export interface ScheduleSummary {
  readonly id: number;
  readonly assignmentId: number;
  readonly playlistId: number;
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc: string | null;
  readonly createdAt: string;
}

/**
 * GET /api/schedules/{id} response — adds `nextOccurrenceUtc` for
 * repeating schedules. Null for `repeatType === 'NONE'` and for
 * repeating schedules whose `repeatEndUtc` has already passed.
 */
export interface ScheduleDetail extends ScheduleSummary {
  readonly nextOccurrenceUtc: string | null;
}

const isRepeatType = (v: unknown): v is RepeatType =>
  v === 'NONE' || v === 'DAILY' || v === 'WEEKLY' || v === 'MONTHLY';

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new Error('expected string or null');
};

const parseScheduleSummary = (raw: unknown): ScheduleSummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.assignmentId !== 'number' || !Number.isFinite(v.assignmentId))
    throw new Error('assignmentId');
  if (typeof v.playlistId !== 'number' || !Number.isFinite(v.playlistId))
    throw new Error('playlistId');
  if (typeof v.startTimeUtc !== 'string') throw new Error('startTimeUtc');
  if (typeof v.endTimeUtc !== 'string') throw new Error('endTimeUtc');
  if (!isRepeatType(v.repeatType)) throw new Error('repeatType');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  return {
    id: v.id,
    assignmentId: v.assignmentId,
    playlistId: v.playlistId,
    startTimeUtc: v.startTimeUtc,
    endTimeUtc: v.endTimeUtc,
    repeatType: v.repeatType,
    repeatEndUtc: strOrNull(v.repeatEndUtc),
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
 * GET /api/schedules — paged list with optional filters.
 *
 * **Backend validation rules** match the create/update contract for
 * the date-range filter pair:
 *   1. `from` must be ≤ `to` — inverted ranges → 400.
 *   2. Date range must be ≤ 90 days — `to - from > 90d` → 400.
 *
 * Both surface as thrown axios errors; the global response interceptor
 * does NOT toast 4xx, so callers should narrow on
 * `err.response?.status === 400` and render inline form errors on the
 * date inputs.
 */
export const listSchedules = async (
  filters: ScheduleListFilters,
  pageable: Pageable,
): Promise<Page<ScheduleSummary>> => {
  const params = dropUndefined({
    assignmentId: filters.assignmentId,
    repeatType: filters.repeatType,
    from: filters.from,
    to: filters.to,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/schedules', { params });
  return parsePage(data, parseScheduleSummary);
};

/**
 * GET /api/schedules/{id} — full detail including `nextOccurrenceUtc`
 * for repeating schedules. Verbatim pass-through; consumers can read
 * `nextOccurrenceUtc === null` to detect both NONE-repeat and
 * past-`repeatEndUtc` cases.
 */
export const getSchedule = async (id: number): Promise<ScheduleDetail> => {
  const { data } = await http.get<ScheduleDetail>(`/api/schedules/${String(id)}`);
  return data;
};
