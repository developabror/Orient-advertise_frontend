// Reports resource — typed wrappers around /api/reports/events,
// /api/reports/events/jobs/{jobId}, and /api/reports/export.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import axios from 'axios';
import { http } from '../http';

/**
 * Single row inside `EventReport.topAffectedDevices`. Mirrors the
 * backend `TopDeviceDto` (or equivalent) — devices ranked by event
 * frequency over the report window.
 */
export interface TopAffectedDevice {
  readonly deviceId: number;
  readonly deviceName: string;
  readonly eventCount: number;
}

/**
 * The payload of a completed event report. Used both as the inline body
 * of a synchronous `getEventReport` response and as the `result` field
 * of `pollReportJob` once the async job finishes.
 */
export interface EventReport {
  readonly facilityId: number | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly incidentCount: number;
  readonly avgResolutionSeconds: number | null;
  readonly topAffectedDevices: readonly TopAffectedDevice[];
  /** Total events emitted in the report window (all priorities, all types). */
  readonly totalEvents: number;
  /**
   * Event-count breakdown keyed by backend `Event.Type` enum string
   * (e.g. `DEVICE_OFFLINE`, `CONTENT_INVALID`). Empty object when there
   * are no events in the window — never null.
   */
  readonly countsByType: Record<string, number>;
}

/**
 * Discriminated union returned by `getEventReport`. The discriminator
 * is the body's `status` field — NOT the HTTP status code (the backend
 * returns 200 for COMPLETED and 202 for PENDING, but the resource
 * collapses both onto the body shape so callers don't have to inspect
 * the response envelope).
 */
export type EventReportResponse =
  | (EventReport & { readonly status: 'COMPLETED' })
  | { readonly status: 'PENDING'; readonly jobId: string };

export interface EventReportFilters {
  readonly facilityId?: number;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Job-poll envelope. `result` is present when `status === 'COMPLETED'`,
 * `error` when `status === 'FAILED'`. `expiresAt` is when the server
 * will garbage-collect the job record — clients should stop polling
 * before then.
 */
export interface JobResponse {
  readonly jobId: string;
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED';
  readonly result?: EventReport;
  readonly error?: string;
  readonly expiresAt: string;
}

export type ExportType = 'EVENTS' | 'DEVICES' | 'STATS';

export interface ExportFilters {
  readonly facilityId?: number;
  readonly deviceId?: number;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Thrown by `exportExcel` when the server returns 429. Surfaced as a
 * dedicated class (not a generic axios error) so the page can branch on
 * `instanceof RateLimitedError` (or `err.code === 'RATE_LIMITED'`)
 * without inspecting `err.response?.status` itself.
 */
export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * GET /api/reports/events.
 *
 * Returns either a synchronous COMPLETED response (HTTP 200) or an async
 * PENDING response (HTTP 202). **202 is treated as success** — axios's
 * default `validateStatus` already considers 2xx successful, and the
 * global response interceptor only toasts 401/403/503/5xx, so a 202 is
 * never surfaced as an error.
 *
 * Discriminate on the body's `status` field; do NOT inspect the HTTP
 * status code yourself.
 */
export const getEventReport = async (
  filters: EventReportFilters,
): Promise<EventReportResponse> => {
  const params = dropUndefined({
    facilityId: filters.facilityId,
    from: filters.from,
    to: filters.to,
  });
  const { data } = await http.get<EventReportResponse>('/api/reports/events', { params });
  return data;
};

/**
 * GET /api/reports/events/jobs/{jobId}. Used to poll a PENDING report
 * job to completion. Implementations should poll with backoff and stop
 * when `status !== 'PENDING'` or the wall clock crosses `expiresAt`.
 */
export const pollReportJob = async (jobId: string): Promise<JobResponse> => {
  const { data } = await http.get<JobResponse>(
    `/api/reports/events/jobs/${encodeURIComponent(jobId)}`,
  );
  return data;
};

const FILENAME_RE = /filename="([^"]+)"/;
const FALLBACK_FILENAME = 'export.xlsx';

const parseFilename = (headers: unknown): string => {
  if (typeof headers !== 'object' || headers === null) return FALLBACK_FILENAME;
  // axios returns headers as a plain object with lowercased keys, but
  // newer versions wrap them in `AxiosHeaders` with a `.get()` method.
  // Try the plain-object access first, then fall back to `.get()`.
  let raw: unknown = (headers as Record<string, unknown>)['content-disposition'];
  if (raw === undefined) {
    const get = (headers as { get?: unknown }).get;
    if (typeof get === 'function') {
      raw = (get as (k: string) => unknown).call(headers, 'content-disposition');
    }
  }
  if (typeof raw !== 'string') return FALLBACK_FILENAME;
  const match = FILENAME_RE.exec(raw);
  return match?.[1] ?? FALLBACK_FILENAME;
};

/**
 * GET /api/reports/export — streams an Excel workbook.
 *
 * Returns the raw `Blob` plus a filename parsed from the
 * `Content-Disposition` response header. Falls back to `'export.xlsx'`
 * if the header is missing or malformed.
 *
 * **Rate limiting.** The backend caps each user at 2 concurrent exports.
 * A 429 from this endpoint is rethrown as a {@link RateLimitedError}
 * (with `code: 'RATE_LIMITED'`) so the page can render
 * "You already have 2 exports running, please wait" inline without
 * inspecting the underlying axios error envelope.
 *
 * The default request timeout is overridden to `0` because large exports
 * can exceed the standard 10s timeout — the server holds the connection
 * open while the workbook is built.
 */
export const exportExcel = async (
  type: ExportType,
  filters: ExportFilters,
): Promise<{ readonly blob: Blob; readonly filename: string }> => {
  const params = dropUndefined({
    type,
    facilityId: filters.facilityId,
    deviceId: filters.deviceId,
    from: filters.from,
    to: filters.to,
  });
  try {
    const response = await http.get<Blob>('/api/reports/export', {
      params,
      responseType: 'blob',
      timeout: 0,
    });
    return {
      blob: response.data,
      filename: parseFilename(response.headers),
    };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      throw new RateLimitedError(
        'You already have 2 exports running, please wait for one to finish.',
      );
    }
    throw err;
  }
};
