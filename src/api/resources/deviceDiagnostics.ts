// Device diagnostics + actions resource — typed wrappers around
// /api/devices/{id}/diagnostics, /api/devices/{id}/actions
// (POST issues an action, GET returns the operator-facing history),
// and /api/devices/{id}/playlist/control.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';
import type { DeviceWsStatus } from '../wsClient';

/**
 * Backend `Device.Status` enum verbatim — aliased from
 * {@link DeviceWsStatus} so the WS event payload, REST list/detail
 * responses, and diagnostics view all share one source of truth.
 */
export type DeviceStatus = DeviceWsStatus;

/**
 * Single event row inside `DeviceDiagnostics.recentEvents`. Mirrors the
 * backend `EventSummary` schema verbatim; priority follows the same
 * five-level enum used by incidents and the WS feed.
 */
export interface EventEntry {
  readonly id: number;
  readonly eventType: string;
  readonly priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  readonly payload: string | null;
  readonly occurredAt: string;
}

/**
 * Single remote-action row inside `DeviceDiagnostics.recentActions`.
 * Mirrors the backend `ActionSummary` schema verbatim. `actionType`
 * and `status` are kept as plain strings (rather than narrowed unions)
 * because the diagnostics view includes historical actions — being
 * liberal in what we accept on read avoids a parser change every time
 * the server adds an action type.
 */
export interface ActionEntry {
  readonly id: number;
  readonly actionType: string;
  readonly status: string;
  readonly payload: string | null;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
}

/**
 * Mirrors `DeviceDiagnosticsService.DiagnosticsView` — a single payload
 * combining the device's status snapshot, recent events, and recent
 * remote-action history. `generatedAt` is the server's wall-clock at
 * cache build time.
 */
export interface DeviceDiagnostics {
  readonly deviceId: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: DeviceStatus;
  readonly lastHeartbeatAt: string | null;
  readonly currentContentVersion: string | null;
  readonly lastKnownIp: string | null;
  readonly pendingActionCount: number;
  readonly recentEvents: readonly EventEntry[];
  readonly recentActions: readonly ActionEntry[];
  readonly generatedAt: string;
}

/** Backend `DeviceActionType` enum verbatim. */
export type DeviceActionType =
  | 'REBOOT'
  | 'SYNC_CONTENT'
  | 'VOLUME_SET'
  | 'PLAYBACK_PAUSE'
  | 'PLAYBACK_RESUME'
  | 'GET_DIAGNOSTICS';

/**
 * Body shape for POST /api/devices/{id}/actions. `volume` is only valid
 * for `VOLUME_SET` and MUST be 0..100; the backend validates twice (Bean
 * validation + service guard), so a malformed request fails fast with a
 * 400. Kept as a flat shape (rather than a discriminated union) because
 * the wire body is flat — caller is responsible for the constraint.
 */
export interface DeviceActionRequest {
  readonly type: DeviceActionType;
  readonly volume?: number;
}

/** Backend `PlaylistControlAction` enum. */
export type PlaylistControlAction = 'PREV' | 'NEXT' | 'JUMP';

/**
 * Body shape for POST /api/devices/{id}/playlist/control. `position` is
 * required only for `JUMP`; the backend ignores it for `PREV` / `NEXT`.
 */
export interface PlaylistControlRequest {
  readonly action: PlaylistControlAction;
  readonly position?: number;
}

/**
 * Response envelope for both action endpoints. Mirrors the backend
 * `DeviceActionResponse` / `PlaylistControlResponse` schemas verbatim
 * (they share the same field set). `actionType` and `status` are kept
 * as strings because the server may add states (e.g. ENQUEUED, RETRYING)
 * without a FE deploy — be liberal on read.
 */
export interface RemoteActionResponse {
  readonly actionId: number;
  readonly deviceId: number;
  readonly actionType: string;
  readonly status: string;
  readonly payload: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuedBy: string;
}

/**
 * GET /api/devices/{id}/diagnostics.
 *
 * Returns the diagnostics snapshot. **The response is cached server-side
 * for ~30 seconds**, so polling this endpoint at higher cadence is
 * wasteful. For live state (status flips, new incidents, action
 * completions) consumers should subscribe to the WebSocket feed —
 * `DEVICE_STATUS_CHANGE` and `INCIDENT_*` events — and only fall back
 * to this endpoint on initial load or while the WS is in `paused` state.
 */
export const getDiagnostics = async (deviceId: number): Promise<DeviceDiagnostics> => {
  const { data } = await http.get<DeviceDiagnostics>(
    `/api/devices/${String(deviceId)}/diagnostics`,
  );
  return data;
};

/**
 * POST /api/devices/{id}/actions.
 *
 * **409 contracts** (both surface as a thrown axios error with status
 * 409; the global interceptor does NOT toast 4xx, so the caller decides
 * the messaging):
 *
 *  1. **Duplicate pending action** — the device already has a pending
 *     action of the same type. Caller behavior depends on idempotency:
 *     a SYNC_CONTENT can usually be skipped silently; a REBOOT should be
 *     surfaced so the operator knows it's already queued.
 *  2. **Pending queue full at 10** — the device's action queue is at
 *     max depth. The caller should ask the user to wait until the queue
 *     drains; do NOT retry on a backoff loop, as the device may simply
 *     be offline and unable to consume the queue.
 *
 * Both 409s share the same status code; narrow on
 * `err.response?.data.message` to distinguish them.
 *
 * `volume` MUST be 0..100 and MUST only be present when
 * `type === 'VOLUME_SET'`. Backend validates twice (Bean validation +
 * service guard).
 */
export const issueDeviceAction = async (
  deviceId: number,
  req: DeviceActionRequest,
): Promise<RemoteActionResponse> => {
  const { data } = await http.post<RemoteActionResponse>(
    `/api/devices/${String(deviceId)}/actions`,
    req,
  );
  return data;
};

/**
 * POST /api/devices/{id}/playlist/control.
 *
 * `position` is REQUIRED only when `action === 'JUMP'`; the backend
 * ignores it for `PREV` / `NEXT`. Same 409 contracts as
 * {@link issueDeviceAction} apply (duplicate pending, queue full).
 */
export const playlistControl = async (
  deviceId: number,
  req: PlaylistControlRequest,
): Promise<RemoteActionResponse> => {
  const { data } = await http.post<RemoteActionResponse>(
    `/api/devices/${String(deviceId)}/playlist/control`,
    req,
  );
  return data;
};

/**
 * Backend `RemoteAction.Status` enum verbatim. Distinct from
 * {@link RemoteActionResponse.status} (which stays a plain string for
 * forward-compat) — the history view's status is a closed set the UI
 * renders as differently-coloured badges.
 */
export type RemoteActionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CONFIRMED_LATE'
  | 'EXPIRED'
  | 'FAILED';

export interface DeviceActionHistoryFilters {
  readonly status?: RemoteActionStatus;
  readonly actionType?: DeviceActionType;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Mirror of the backend `RemoteActionDto` — the operator-facing
 * history view of issued device actions. Distinct from the device-side
 * `/api/devices/{id}/actions/pending` queue (that one is for the
 * device polling its own pending queue; this one is for operators
 * viewing history).
 */
export interface RemoteActionDto {
  readonly actionId: number;
  readonly actionType: string;
  readonly status: RemoteActionStatus;
  readonly payload: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
  readonly issuedBy: string;
  readonly result: string | null;
}

const isRemoteActionStatus = (v: unknown): v is RemoteActionStatus =>
  v === 'PENDING' ||
  v === 'CONFIRMED' ||
  v === 'CONFIRMED_LATE' ||
  v === 'EXPIRED' ||
  v === 'FAILED';

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new Error('expected string or null');
};

const parseRemoteActionDto = (raw: unknown): RemoteActionDto => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.actionId !== 'number' || !Number.isFinite(v.actionId)) throw new Error('actionId');
  if (typeof v.actionType !== 'string') throw new Error('actionType');
  if (!isRemoteActionStatus(v.status)) throw new Error('status');
  if (typeof v.issuedAt !== 'string') throw new Error('issuedAt');
  if (typeof v.expiresAt !== 'string') throw new Error('expiresAt');
  if (typeof v.issuedBy !== 'string') throw new Error('issuedBy');
  return {
    actionId: v.actionId,
    actionType: v.actionType,
    status: v.status,
    payload: strOrNull(v.payload),
    issuedAt: v.issuedAt,
    expiresAt: v.expiresAt,
    confirmedAt: strOrNull(v.confirmedAt),
    issuedBy: v.issuedBy,
    result: strOrNull(v.result),
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
 * GET /api/devices/{deviceId}/actions.
 *
 * **Audience: operators viewing history.** Distinct from
 * `/api/devices/{id}/actions/pending`, which is the device-side queue
 * the TV-Box polls — this endpoint is the human-facing audit trail of
 * actions ever issued to the device. The same path serves POST (issue
 * action) and GET (history) — Spring routes by method.
 *
 * **Default time window is the trailing 30 days** when `from` / `to`
 * are omitted. The backend caps the range at **90 days**; longer
 * ranges return 400 the same way /api/events does.
 */
export const listDeviceActionHistory = async (
  deviceId: number,
  filters: DeviceActionHistoryFilters,
  pageable: Pageable,
): Promise<Page<RemoteActionDto>> => {
  const params = dropUndefined({
    status: filters.status,
    actionType: filters.actionType,
    from: filters.from,
    to: filters.to,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>(
    `/api/devices/${String(deviceId)}/actions`,
    { params },
  );
  return parsePage(data, parseRemoteActionDto);
};
