// Remote-control resource — typed wrappers around /api/devices/{id}/remote
// and /api/devices/{id}/connection.
//
// This is the **control plane only**. No video byte ever crosses these calls:
// the backend hands out a `relayUrl` + a single-use `viewerTicket`, and the
// viewer dials the relay directly (see `../../pages/deviceRemoteViewer.ts`).
// Canonical wire contract: `../../../../REMOTE_CONTROL_CONTRACT.md` §3.
//
// Authorization is handled by the global request interceptor in `../http.ts`;
// resource layers MUST NOT set the Authorization header themselves. The one
// exception is {@link stopRemoteSessionBeacon}, which deliberately bypasses
// axios — see its docstring for why, and note it still reads the token from
// the same `tokenStore`, never from a second source.
//
// ── Ticket hygiene (non-negotiable) ────────────────────────────────────────
// `viewerTicket` is a **bearer credential for the relay** and is issued once.
//   - `GET` never returns it — that's enforced by the backend AND by the
//     return type of {@link getRemoteSession}.
//   - It is never persisted (no localStorage / sessionStorage / IndexedDB),
//     never put in the browser URL bar, and never logged.
//   - A viewer that loses its socket must call {@link startRemoteSession}
//     again; reconnecting with a spent ticket is rejected `1008` by the relay.

import { http } from '../http';
import { env } from '../env';
import { tokenStore } from '../tokenStore';
import axios from 'axios';

/**
 * How the device can inject input, as it last reported on its heartbeat.
 *
 * `NONE` is a first-class outcome, not a failure: the box streams video but
 * accepts no input, and the viewer renders a **View only** badge. Whether the
 * fleet reports `ROOT` or `NONE` is still open with the Android team — both
 * paths must be correct with no code change (contract §8).
 */
export type RemoteInputMode = 'ROOT' | 'ACCESSIBILITY' | 'NONE';

/** Session lifecycle, backend `RemoteSession.Status` verbatim (contract §2). */
export type RemoteSessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED' | 'FAILED' | 'EXPIRED';

/** Terminal states. A session in one of these will never become `ACTIVE`. */
const TERMINAL_STATUSES: ReadonlySet<RemoteSessionStatus> = new Set<RemoteSessionStatus>([
  'ENDED',
  'FAILED',
  'EXPIRED',
]);

export const isTerminalStatus = (status: RemoteSessionStatus): boolean =>
  TERMINAL_STATUSES.has(status);

/**
 * The device's last-reported remote capability. `null` on a session means the
 * device has never reported one — treat that as "unknown", not "unsupported":
 * a box that has simply not beaten since the feature shipped is still worth
 * trying (contract §8, rollout order).
 */
export interface RemoteCapability {
  readonly supported: boolean;
  readonly input: RemoteInputMode;
  readonly transport: 'SCRCPY_WS' | 'NONE';
  readonly maxWidth: number | null;
  readonly maxHeight: number | null;
  readonly reportedAt: string | null;
}

export interface RemoteSession {
  readonly sessionId: string;
  readonly deviceId: number;
  readonly status: RemoteSessionStatus;
  readonly relayUrl: string;
  /** Single-issue relay credential. Present **only** on the POST response. */
  readonly viewerTicket: string;
  readonly expiresAt: string;
  readonly viewOnly: boolean;
  /**
   * How the device will learn about the session.
   *
   * `HEARTBEAT` means its WebSocket is down and it will pick the session up on
   * its next 2-minute beat — **not an error**, and the reason the viewer has a
   * real, visible `waitingForDevice` state instead of a bare spinner.
   */
  readonly deliveredVia: 'WS' | 'HEARTBEAT';
  readonly capability: RemoteCapability | null;
}

/**
 * What `GET` returns. The `viewerTicket` omission is structural, not a
 * convention: there is no way to read a ticket back out of a session.
 */
export type RemoteSessionView = Omit<RemoteSession, 'viewerTicket'>;

const INPUT_MODES: ReadonlySet<string> = new Set(['ROOT', 'ACCESSIBILITY', 'NONE']);
const STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'ACTIVE',
  'ENDED',
  'FAILED',
  'EXPIRED',
]);

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error('expected number or null');
};

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new Error('expected string or null');
};

/**
 * `capability` is nullable by design (never reported). A malformed block is
 * parsed as `null` rather than failing the whole session: an unusable
 * capability hint must not cost the operator a working session — the viewer
 * degrades to the "unknown capability" path, which is the safe default.
 */
const parseCapability = (raw: unknown): RemoteCapability | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.supported !== 'boolean') return null;
  const input = typeof v.input === 'string' && INPUT_MODES.has(v.input) ? v.input : 'NONE';
  const transport = v.transport === 'SCRCPY_WS' ? 'SCRCPY_WS' : 'NONE';
  return {
    supported: v.supported,
    input: input as RemoteInputMode,
    transport,
    maxWidth: numOrNull(v.maxWidth),
    maxHeight: numOrNull(v.maxHeight),
    reportedAt: strOrNull(v.reportedAt),
  };
};

/**
 * Strict parse of the session envelope. Unlike `capability`, the core fields
 * throw on a bad shape — a session we can't read is a session we must not
 * pretend to have opened, because the operator would sit in front of a viewer
 * that never pairs while the box streams on a metered link.
 */
const parseSession = (raw: unknown, ticket: string): RemoteSession => {
  if (typeof raw !== 'object' || raw === null) throw new Error('session is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.sessionId !== 'string' || v.sessionId === '') throw new Error('sessionId');
  if (typeof v.deviceId !== 'number' || !Number.isFinite(v.deviceId)) throw new Error('deviceId');
  if (typeof v.status !== 'string' || !STATUSES.has(v.status)) throw new Error('status');
  if (typeof v.relayUrl !== 'string' || v.relayUrl === '') throw new Error('relayUrl');
  if (typeof v.expiresAt !== 'string' || v.expiresAt === '') throw new Error('expiresAt');
  const deliveredVia = v.deliveredVia === 'HEARTBEAT' ? 'HEARTBEAT' : 'WS';
  return {
    sessionId: v.sessionId,
    deviceId: v.deviceId,
    status: v.status as RemoteSessionStatus,
    relayUrl: v.relayUrl,
    viewerTicket: ticket,
    expiresAt: v.expiresAt,
    viewOnly: v.viewOnly === true,
    deliveredVia,
    capability: parseCapability(v.capability),
  };
};

/**
 * `POST /api/devices/{id}/remote` — mint a session. **201.**
 *
 * Both global error surfaces are suppressed on purpose: `DeviceRemotePage`
 * renders every start failure (409 / 422 / 403 / 503) inline in its own error
 * region, including the backend's `message` **verbatim**, so the modal and the
 * toast would each be a second copy of a message the operator is already
 * reading. That inline rendering is the precondition for suppressing — do not
 * copy this pair into a caller that swallows the error.
 *
 * Failure modes the caller must handle (contract §3):
 *  - **403** — VIEWER/ADVERTISER, or the device is outside the operator's scope.
 *  - **404** — unknown or soft-deleted device.
 *  - **409** — a PENDING/ACTIVE session already exists. The envelope `message`
 *    names it; offer "Take over" (DELETE then POST again).
 *  - **422** — the device reported `capability.supported == false`. Terminal
 *    for this device: do not offer a retry.
 *  - **503** — remote control is disabled server-side (`app.remote.enabled`).
 */
export const startRemoteSession = async (
  deviceId: number,
  viewOnly = false,
): Promise<RemoteSession> => {
  const { data } = await http.post<unknown>(
    `/api/devices/${String(deviceId)}/remote`,
    { viewOnly },
    { _suppressErrorToast: true, _suppressErrorModal: true },
  );
  const ticket =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).viewerTicket
      : undefined;
  if (typeof ticket !== 'string' || ticket === '') {
    throw new Error('Remote session response carried no viewerTicket');
  }
  return parseSession(data, ticket);
};

/**
 * `DELETE /api/devices/{id}/remote/{sessionId}` — stop. **204**, idempotent:
 * stopping an already-terminal session is a 204, so a double-click and a
 * teardown racing the countdown both land safely.
 *
 * Errors are suppressed rather than surfaced: this runs on unmount and on
 * navigation, where a modal has nothing to attach to and nothing useful to
 * offer. The device's own `expiresAt` timer is the backstop (contract §7 rule 4).
 */
export const stopRemoteSession = async (deviceId: number, sessionId: string): Promise<void> => {
  await http.delete(`/api/devices/${String(deviceId)}/remote/${encodeURIComponent(sessionId)}`, {
    _suppressErrorToast: true,
    _suppressErrorModal: true,
  });
};

/**
 * Fire-and-forget stop for `beforeunload` / `pagehide`, where the tab is going
 * away before an axios promise could ever settle.
 *
 * **Why not `navigator.sendBeacon`:** beacon can only issue a `POST` and cannot
 * carry an `Authorization` header. Our stop is a `DELETE` behind a bearer JWT,
 * so a beacon would be rejected 401/405 and the session would leak — which is
 * the exact failure this handler exists to prevent. `fetch(…, {keepalive: true})`
 * is the same "outlive the document" guarantee with a real method and headers,
 * and is supported by every Chromium browser the operators run.
 *
 * Never awaited and never throws; a leaked session is still caught by the
 * device-side `expiresAt` kill timer.
 *
 * **Accepted limitation:** `tokenStore` may hold an access token that has just
 * expired (15-minute tokens against a 30-minute session ceiling), and a
 * keepalive fetch cannot run the 401 → refresh → retry interceptor — the
 * document is already going away. That stop then fails and the session lives
 * until the device's own `expiresAt` timer. Closing that gap properly means
 * stopping earlier, on `visibilitychange`, through the axios path that *can*
 * refresh; this call stays the last resort.
 */
export const stopRemoteSessionBeacon = (deviceId: number, sessionId: string): void => {
  const token = tokenStore.get();
  if (token === null) return;
  // Match axios's own `combineURLs`, which strips trailing slashes off baseURL.
  // Without this a `VITE_API_URL` with a trailing slash — the documented common
  // Dockerfile typo, see env.ts — yields `//api/devices/…`, which Spring treats
  // as a different path: the DELETE 404s and the session leaks silently.
  const origin = env.apiUrl.replace(/\/+$/, '');
  const url = `${origin}/api/devices/${String(deviceId)}/remote/${encodeURIComponent(sessionId)}`;
  try {
    void fetch(url, {
      method: 'DELETE',
      keepalive: true,
      // This route authenticates by bearer header. The long-lived HttpOnly
      // refresh cookie has no business on a request whose response nobody can
      // read, so don't send it.
      credentials: 'omit',
      // Never replay the Authorization header at a redirect target.
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      /* the tab is closing; the device's expiresAt timer is the backstop */
    });
  } catch {
    /* fetch itself can throw synchronously on a torn-down document */
  }
};

/**
 * `GET /api/devices/{id}/remote` — the device's current non-terminal session,
 * **without** a ticket.
 *
 * **404 maps to `null`.** "No session is open" is the normal resting state of
 * every device in the fleet, not an error, and rendering it as one would put a
 * not-found on screen every time an operator opens the viewer cold.
 */
export const getRemoteSession = async (deviceId: number): Promise<RemoteSessionView | null> => {
  try {
    const { data } = await http.get<unknown>(`/api/devices/${String(deviceId)}/remote`);
    // The empty ticket never escapes: the return type omits `viewerTicket`, and
    // the destructure below drops it before the value reaches the caller.
    const { viewerTicket: _ignored, ...view } = parseSession(data, '');
    return view;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
};

/**
 * `GET /api/devices/{id}/connection` — is a device socket open **right now**.
 *
 * Deliberately not `device_status_view`, whose computed status lags up to 16
 * minutes and is useless for deciding whether a Connect will pair in seconds
 * or in two minutes (contract §3).
 */
export const getDeviceConnection = async (
  deviceId: number,
): Promise<{ readonly connected: boolean }> => {
  const { data } = await http.get<unknown>(`/api/devices/${String(deviceId)}/connection`);
  const connected =
    typeof data === 'object' && data !== null && (data as Record<string, unknown>).connected === true;
  return { connected };
};
