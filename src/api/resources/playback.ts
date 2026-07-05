// Playback reporting resource — typed wrapper around
// POST /api/devices/{deviceId}/playback.
//
// **Audience.** This endpoint is normally called by the **TV-Box
// devices** themselves on a periodic schedule (every N seconds the
// player drains its local queue and POSTs accumulated playback events).
// It is NOT a normal browser-FE concern. This wrapper exists for two
// specific FE use cases:
//
//   1. **Admin manual recording** — when a device was offline during
//      playback, an operator can backfill the missed events from the
//      admin UI so the per-content stats line up with reality.
//   2. **Integration tests** — drive the endpoint from the FE harness
//      to validate the full ingestion pipeline end-to-end.
//
// If you're reaching for this from a normal user-facing flow, double-
// check the design — most pages should consume `/api/stats/content/*`
// instead, which serves the rolled-up view.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';

/**
 * Single playback event. `playedAt` is an ISO-8601 instant in UTC;
 * `durationSeconds` is optional because some sources (e.g. partial
 * play resumed from a pause) don't have a meaningful duration.
 */
export interface PlaybackEntry {
  readonly contentFileId: number;
  readonly playedAt: string;
  readonly durationSeconds?: number;
}

/**
 * Per-row rejection inside `BatchResponse.rejections`. `index` is the
 * position of the offending entry in the input — 0 when the caller
 * passed a single object, otherwise the array index.
 */
export interface BatchRejection {
  readonly index: number;
  readonly reason: string;
}

/**
 * Mirror of the backend `BatchResponse`. The four counters always sum
 * to `total` (`created + duplicate + rejected === total`) so consumers
 * can sanity-check the response without round-trip arithmetic.
 */
export interface BatchResponse {
  readonly total: number;
  readonly created: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly rejections: readonly BatchRejection[];
}

/**
 * POST /api/devices/{deviceId}/playback.
 *
 * Accepts a **single `PlaybackEntry`** or an **array** of them — the
 * wire shape is pass-through. The backend handles both forms (a single
 * object is treated as a one-element batch under the hood) so the FE
 * doesn't need to coerce.
 *
 * Returns a {@link BatchResponse} summarising what was created vs
 * duplicated vs rejected. **Duplicates are not failures**: the server
 * idempotently dedupes on `(deviceId, contentFileId, playedAt)`, so a
 * client-side retry after a flaky network won't double-count plays.
 * Caller should surface `rejections[]` to the operator (for the manual-
 * backfill flow) but treat `duplicate` as silent success.
 */
export const reportPlayback = async (
  deviceId: number,
  entries: PlaybackEntry | readonly PlaybackEntry[],
): Promise<BatchResponse> => {
  const { data } = await http.post<BatchResponse>(
    `/api/devices/${String(deviceId)}/playback`,
    entries,
  );
  return data;
};
