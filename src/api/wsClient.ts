import { tokenToUser } from './auth';
import { env } from './env';
import { refreshOnce } from './http';
import type { IncidentDto } from './resources/incidents';
import { tokenStore } from './tokenStore';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'paused';

export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type IncidentPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * Mirror of the backend `IncidentPayload` envelope verbatim. Both
 * `INCIDENT_CRITICAL` (initial OPEN broadcast) and `INCIDENT_UPDATED`
 * (status transitions) carry this shape — only the `type` discriminator
 * differs. There is **no** `message`, `occurredAt`, or `occurrenceCount`
 * on the wire; consumers must read `description`, `openedAt`, and so on.
 *
 * `incidentId` and `deviceId` are wire `Long`s — emitted as JSON numbers,
 * not strings. Stringify at the consumer boundary if a string id is
 * needed (e.g. for criticalAlerts store keys).
 */
interface IncidentPayloadFields {
  readonly incidentId: number;
  readonly deviceId: number;
  readonly eventType: string;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly description: string;
  /**
   * **Nullable on the wire.** `RedisDashboardEventBroadcaster.incidentJson`
   * renders `p.openedAt() == null ? "null" : ...` — an explicit JSON `null`,
   * not an omitted key. Typing these as bare `string` (and guarding with
   * `typeof === 'string'`) silently dropped the whole frame; see the
   * `invalidReason` note on {@link ContentStatusChangeEvent}. Consumers
   * coalesce at their own boundary.
   */
  readonly openedAt: string | null;
  readonly updatedAt: string | null;
  readonly actor: string | null;
}

export interface IncidentCriticalEvent extends IncidentPayloadFields {
  readonly type: 'INCIDENT_CRITICAL';
}

/**
 * Backend /ws/dashboard fan-out for ack/resolve transitions. Without
 * subscribing to this, an incident acked or resolved in another tab (or
 * by another operator) stays visible as OPEN here until a manual
 * refresh.
 */
export interface IncidentUpdatedEvent extends IncidentPayloadFields {
  readonly type: 'INCIDENT_UPDATED';
}

// Mirrors the backend Device.Status enum verbatim. Lower-casing for UI
// rendering belongs in the rendering layer, not in the network DTO.
export type DeviceWsStatus = 'ONLINE' | 'OFFLINE' | 'NO_CONTENT' | 'UNREGISTERED';

// README "Dashboard Live Feed" payload: carries oldStatus + newStatus, NOT a
// single status field. The earlier single-`status` shape silently dropped
// every NO_CONTENT transition because the value failed the union check.
//
// `deviceId` is permitted as `string | number`: the backend currently emits
// Long ids unstringified. TODO(backend-alignment): confirm whether ids are
// stringified across all event channels and tighten this type once aligned.
export interface DeviceStatusChangeEvent {
  readonly type: 'DEVICE_STATUS_CHANGE';
  readonly deviceId: string | number;
  readonly oldStatus: DeviceWsStatus;
  readonly newStatus: DeviceWsStatus;
  readonly changedAt: string;
}

/**
 * **Server guarantee: SNAPSHOT is the FIRST frame on every new
 * connection.** Handlers can rely on this ordering — when SNAPSHOT
 * arrives, treat its `openIncidents` as the canonical state at the
 * moment of connect (clear the local store and repopulate). Any
 * INCIDENT_CRITICAL or INCIDENT_UPDATED frames that follow are
 * deltas applied on top.
 *
 * `serverTime` is the wall clock at snapshot generation — useful for
 * "stale-by" comparisons against `incident.openedAt` if the connection
 * went through a long backoff.
 */
export interface SnapshotEvent {
  readonly type: 'SNAPSHOT';
  readonly serverTime: string;
  readonly openIncidents: readonly IncidentDto[];
}

// Mirrors the backend `ContentFile.Status` values that transcoding can move
// through after upload. UPLOADED is the pre-transcode state the uploader
// already knows locally, so it isn't broadcast here.
export type ContentWsStatus = 'TRANSCODING' | 'READY' | 'FAILED' | 'INVALID';

/**
 * `/ws/dashboard` fan-out for content transcoding progress, so the uploader
 * gets live status instead of polling GET /api/content/{id} on a 5s lag.
 *
 * `contentId` is the `ContentFile.id` (wire `Long`, emitted as a JSON number —
 * stringify at the consumer to match the uploader's string-keyed entries).
 * `invalidReason` accompanies FAILED/INVALID; `progressPct` (0–100) is an
 * optional fine-grained transcode percentage when the backend reports one.
 */
export interface ContentStatusChangeEvent {
  readonly type: 'CONTENT_STATUS_CHANGE';
  readonly contentId: number;
  readonly status: ContentWsStatus;
  /**
   * **`null` on every non-INVALID frame, never `undefined`.** The backend
   * renders the key unconditionally —
   * `RedisDashboardEventBroadcaster.contentStatusChanged` emits
   * `p.invalidReason() == null ? "null" : "\"…\""` — and JSON has no
   * `undefined`. A `string`-or-`undefined` guard therefore rejected every
   * `READY` frame (only `INVALID` supplies a reason string), which killed
   * live transcode status outright. Consumers already do
   * `event.invalidReason ?? fallback`, so `null` flows through correctly.
   */
  readonly invalidReason?: string | null;
  /**
   * Fine-grained transcode percentage (0–100). The current broadcaster
   * never emits this key at all, so it reads `undefined` in production;
   * `null` is admitted defensively because that is how this publisher
   * renders every other nullable field.
   */
  readonly progressPct?: number | null;
}

export type WsEvent =
  | IncidentCriticalEvent
  | DeviceStatusChangeEvent
  | IncidentUpdatedEvent
  | ContentStatusChangeEvent
  | SnapshotEvent;
export type WsEventType = WsEvent['type'];

type StatusListener = (status: WsStatus) => void;
type AnyEventListener = (event: WsEvent) => void;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const PAUSE_AFTER_FAILURES = 5;
const PAUSE_RETRY_MS = 5 * 60_000;

const isIncidentStatus = (v: unknown): v is IncidentStatus =>
  v === 'OPEN' || v === 'ACKNOWLEDGED' || v === 'RESOLVED';

const isIncidentPriority = (v: unknown): v is IncidentPriority =>
  v === 'CRITICAL' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' || v === 'INFO';

const isDeviceWsStatus = (v: unknown): v is DeviceWsStatus =>
  v === 'ONLINE' || v === 'OFFLINE' || v === 'NO_CONTENT' || v === 'UNREGISTERED';

const isContentWsStatus = (v: unknown): v is ContentWsStatus =>
  v === 'TRANSCODING' || v === 'READY' || v === 'FAILED' || v === 'INVALID';

// Shared field validator for both incident events — they carry the
// identical IncidentPayload shape; only the `type` discriminator differs.
const isIncidentPayload = (v: Record<string, unknown>): boolean =>
  typeof v.incidentId === 'number' &&
  Number.isFinite(v.incidentId) &&
  typeof v.deviceId === 'number' &&
  Number.isFinite(v.deviceId) &&
  typeof v.eventType === 'string' &&
  isIncidentStatus(v.status) &&
  isIncidentPriority(v.priority) &&
  typeof v.description === 'string' &&
  // Nullable-but-always-present: the broadcaster emits an explicit `null`
  // for these three, never an omitted key. `undefined` therefore still
  // fails — a missing field is a malformed frame, an explicit null is not.
  (v.openedAt === null || typeof v.openedAt === 'string') &&
  (v.updatedAt === null || typeof v.updatedAt === 'string') &&
  (v.actor === null || typeof v.actor === 'string');

// Exported for direct unit testing. Pure function, no side effects.
export const isWsEvent = (value: unknown): value is WsEvent => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'INCIDENT_CRITICAL') {
    return isIncidentPayload(v);
  }
  if (v.type === 'INCIDENT_UPDATED') {
    return isIncidentPayload(v);
  }
  if (v.type === 'DEVICE_STATUS_CHANGE') {
    const deviceIdOk =
      typeof v.deviceId === 'string' ||
      (typeof v.deviceId === 'number' && Number.isFinite(v.deviceId));
    return (
      deviceIdOk &&
      isDeviceWsStatus(v.oldStatus) &&
      isDeviceWsStatus(v.newStatus) &&
      typeof v.changedAt === 'string'
    );
  }
  if (v.type === 'CONTENT_STATUS_CHANGE') {
    const contentIdOk = typeof v.contentId === 'number' && Number.isFinite(v.contentId);
    const reasonOk =
      v.invalidReason === undefined ||
      v.invalidReason === null ||
      typeof v.invalidReason === 'string';
    const pctOk =
      v.progressPct === undefined ||
      v.progressPct === null ||
      (typeof v.progressPct === 'number' && Number.isFinite(v.progressPct));
    return contentIdOk && isContentWsStatus(v.status) && reasonOk && pctOk;
  }
  if (v.type === 'SNAPSHOT') {
    // openIncidents is liberal-on-read: we only validate it's an array.
    // The IncidentDto wire shape comes from the REST resource layer
    // and is trusted at this boundary; a malformed inner row would be
    // caught by the consumer (criticalAlerts handler) when it tries
    // to read fields. The discriminator + array shape are the minimum
    // contract this validator enforces.
    return typeof v.serverTime === 'string' && Array.isArray(v.openIncidents);
  }
  return false;
};

// Auth-flavored close codes. 1008 (policy violation) is what Spring's
// WebSocket layer raises when the handshake interceptor rejects the token.
// 4001/4401 are reserved by some backends in the application-private 4xxx
// range — keep the predicate liberal until the close-code contract with the
// backend is firmed up. Reason-string matching is a belt-and-braces backstop.
const AUTH_CLOSE_CODES = new Set<number>([1008, 4001, 4401]);
const AUTH_REASON_PATTERN = /unauthor|token|auth|expired/i;

/**
 * Reasons {@link WsClient.handleMessage} can discard an inbound frame.
 * Surfaced through {@link WsClient.getDroppedFrames} so a regression in the
 * wire contract is *countable* rather than invisible.
 */
export type DroppedFrameReason = 'non-string' | 'unparseable' | 'rejected-by-guard';

export type DroppedFrameCounts = Readonly<Record<DroppedFrameReason, number>>;

const ZERO_DROPS: DroppedFrameCounts = {
  'non-string': 0,
  unparseable: 0,
  'rejected-by-guard': 0,
};

// Preview cap for the warn line. Frames are dashboard telemetry (ids,
// statuses, incident descriptions) — no credentials ride on this channel;
// the access token travels in the handshake URL, never in a frame. Still
// truncated so a pathological payload can't flood the console.
const DROP_PREVIEW_CHARS = 200;

class WsClient {
  private socket: WebSocket | null = null;
  private status: WsStatus = 'idle';
  private failures = 0;
  // A silently-dropped frame is how a dead live feed survived in production
  // for a full day: `isWsEvent` rejected every READY frame and nothing —
  // no log, no counter — said so. Every discard now increments here and
  // warns once, so the next wire-contract drift is visible in devtools and
  // assertable from a test.
  private droppedFrames: Record<DroppedFrameReason, number> = { ...ZERO_DROPS };
  private retryTimer: number | null = null;
  // A token refresh after an auth close is in flight; its continuation reopens the socket.
  private refreshInFlight = false;
  // Bumped by every disconnect(). An async continuation that started under an older
  // generation (a refresh that resolves after logout) must not reopen anything.
  private generation = 0;
  // connect() was called and disconnect() has not been since: the session wants a live feed.
  private wanted = false;
  // The user whose token the current connection authenticated with.
  private sessionSub: string | null = null;
  // Token used for the current/most-recent connect attempt. Forwarded to
  // refreshOnce() on auth-driven closes so the coalescer knows which token
  // was rejected and can short-circuit if another tab has already rotated.
  private currentAttemptToken: string | null = null;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly eventListeners = new Set<AnyEventListener>();

  constructor() {
    tokenStore.subscribe((token) => {
      this.onTokenChange(token);
    });
  }

  /**
   * Ensure a connection is live or on its way. A no-op while a socket exists (connecting or open),
   * a retry is scheduled, or a token refresh is in flight — each of those already ends in exactly
   * one socket. This used to open a new socket whenever the status was not `open`/`connecting`,
   * i.e. during every backoff and pause, while the pending retry then opened another one (FE-02):
   * two live sockets delivering every event twice, one of which nothing would ever close.
   */
  connect(): void {
    this.wanted = true;
    if (this.socket !== null || this.retryTimer !== null || this.refreshInFlight) return;
    this.openSocket();
  }

  /**
   * Close the connection and cancel everything that could reopen it: the pending retry, and any
   * in-flight refresh continuation (via {@link generation}). The socket is detached before it is
   * closed, so its close event is ignored rather than scheduling a reconnect.
   */
  disconnect(): void {
    this.generation += 1;
    this.wanted = false;
    this.sessionSub = null;
    this.refreshInFlight = false;
    this.clearRetry();
    this.closeCurrentSocket('client disconnect');
    this.failures = 0;
    this.setStatus('idle');
  }

  /**
   * Follow the session's token — in the same task that changes it, not in a React effect a task or
   * two later, while a message for the previous user could still be delivered.
   *
   * - A different user, or none: end this connection now. It authenticated as the previous user at
   *   handshake. The owner (AuthProvider) reconnects for the new user.
   * - A new token for the same user while the feed is down (backing off, paused, or idle after a
   *   refresh that failed without ending the session): reconnect now. The failure was about the old
   *   token and REST has since got a fresh one; before FE-02 this happened by accident, because
   *   AuthProvider called connect() on every token rotation.
   * - A live or connecting socket, or a refresh in flight (whose continuation reopens), is left alone.
   */
  private onTokenChange(token: string | null): void {
    if (!this.wanted) return;
    // Only a token that decodes can prove a different user; one that doesn't is AuthProvider's to
    // judge (it signs such a session out, which disconnects).
    const sub = tokenToUser(token)?.sub ?? null;
    if (token === null || (sub !== null && this.sessionSub !== null && sub !== this.sessionSub)) {
      this.disconnect();
      return;
    }
    if (this.socket !== null || this.refreshInFlight) return;
    this.clearRetry();
    this.failures = 0;
    this.openSocket();
  }

  private closeCurrentSocket(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, reason);
  }

  getStatus(): WsStatus {
    return this.status;
  }

  /**
   * Per-reason tally of frames `handleMessage` refused to deliver. Any
   * non-zero `rejected-by-guard` count means the server is sending a shape
   * {@link isWsEvent} does not admit — i.e. a live feature is silently dead.
   */
  getDroppedFrames(): DroppedFrameCounts {
    return { ...this.droppedFrames };
  }

  /** Test seam — reset the tallies between cases. */
  resetDroppedFrames(): void {
    this.droppedFrames = { ...ZERO_DROPS };
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  onEvent<T extends WsEventType>(
    type: T,
    fn: (event: Extract<WsEvent, { type: T }>) => void,
  ): () => void {
    const wrapper: AnyEventListener = (event) => {
      if (event.type === type) {
        fn(event as Extract<WsEvent, { type: T }>);
      }
    };
    this.eventListeners.add(wrapper);
    return () => {
      this.eventListeners.delete(wrapper);
    };
  }

  private openSocket(): void {
    // Gate on auth: tokenStore must have an access token before we open a
    // socket. The handshake authenticates via ?access_token=<JWT> query param
    // (DashboardHandshakeInterceptor on the server). Token expiry mid-session
    // causes a server-initiated close, which our reconnect path handles by
    // refreshing first.
    //
    // Read once per attempt so retries pick up rotated tokens. Token stays a
    // function-local — never module state, never logged.
    const token = tokenStore.get();
    if (token === null || token === '') {
      this.currentAttemptToken = null;
      this.setStatus('idle');
      return;
    }
    this.currentAttemptToken = token;
    this.sessionSub = tokenToUser(token)?.sub ?? this.sessionSub;
    const generation = this.generation;
    this.setStatus(this.failures === 0 ? 'connecting' : 'reconnecting');
    // A status listener may have called disconnect(); then there is nothing to open.
    if (generation !== this.generation) return;

    // Never two sockets: a previous one is detached and closed before its replacement exists.
    this.closeCurrentSocket('replaced');
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${env.wsUrl}/dashboard?access_token=${encodeURIComponent(token)}`,
      );
    } catch {
      // A failure like any other, so a constructor that keeps throwing (a malformed VITE_WS_URL, a
      // blocked scheme) backs off into a pause instead of retrying every second forever.
      this.onConnectionFailure();
      return;
    }
    this.socket = socket;

    // Every handler first checks that its socket is still the current one. A socket that was
    // replaced or disconnected may still deliver frames (the previous user's, after a logout) and
    // will still fire `close` — which used to null out the CURRENT socket, so that one could never
    // be closed either.
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.failures = 0;
      this.setStatus('open');
    });
    socket.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (socket !== this.socket) return;
      this.handleMessage(e);
    });
    socket.addEventListener('close', (e: CloseEvent) => {
      if (socket !== this.socket) return;
      this.handleClose(e);
    });
    socket.addEventListener('error', () => {
      // 'close' will fire after 'error'; backoff lives there.
    });
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    if (typeof event.data !== 'string') {
      this.dropFrame('non-string', typeof event.data);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      this.dropFrame('unparseable', event.data);
      return;
    }
    if (!isWsEvent(parsed)) {
      // The single most valuable log line in this file. A frame that parses
      // but fails the guard is a *contract* break, not a transport glitch —
      // the payload preview names the field that drifted.
      this.dropFrame('rejected-by-guard', event.data);
      return;
    }
    this.eventListeners.forEach((fn) => {
      fn(parsed);
    });
  }

  private dropFrame(reason: DroppedFrameReason, raw: unknown): void {
    this.droppedFrames[reason] += 1;
    const preview =
      typeof raw === 'string' ? raw.slice(0, DROP_PREVIEW_CHARS) : String(raw);
    console.warn(
      `[wsClient] dropped frame (${reason}); count=${String(this.droppedFrames[reason])}`,
      preview,
    );
  }

  // Only ever called for the current socket (see openSocket), so it is never an intentional close:
  // disconnect() and a replacement both detach the socket before closing it.
  private handleClose(event: CloseEvent): void {
    this.socket = null;
    if (this.isAuthClose(event)) {
      // Server rejected our token. Refresh BEFORE retrying — otherwise we'd
      // bounce off /dashboard with the same stale token, get closed again,
      // and burn through PAUSE_AFTER_FAILURES into the 5-minute pause for no
      // good reason. Auth lapses aren't network problems and don't count
      // toward the pause budget either.
      void this.handleAuthClose();
      return;
    }
    this.onConnectionFailure();
  }

  private onConnectionFailure(): void {
    this.failures += 1;
    if (this.failures >= PAUSE_AFTER_FAILURES) {
      // Proxy/firewall likely blocking WS — degrade gracefully and try again
      // later. App continues to function without real-time updates.
      this.setStatus('paused');
      this.scheduleRetry(PAUSE_RETRY_MS);
      return;
    }
    // Not 'open' any more: without this the indicator kept saying "live" for the whole backoff.
    this.setStatus('reconnecting');
    this.scheduleRetry();
  }

  private isAuthClose(event: CloseEvent): boolean {
    if (AUTH_CLOSE_CODES.has(event.code)) return true;
    return AUTH_REASON_PATTERN.test(event.reason);
  }

  private async handleAuthClose(): Promise<void> {
    const generation = this.generation;
    this.refreshInFlight = true;
    this.setStatus('reconnecting');
    try {
      // refreshOnce coalesces with REST refreshes (per-tab Promise dedup) and
      // serialises across tabs (Web Locks API). MUST go through it — calling
      // refreshAccessToken() directly would risk concurrent /auth/refresh
      // requests, and the spec rotates the refresh token on every call.
      await refreshOnce(this.currentAttemptToken);
      // disconnect() may have fired during the refresh await (a logout, or a different user
      // signing in); this continuation belongs to that ended session and must not reopen.
      if (generation !== this.generation) return;
      this.refreshInFlight = false;
      // Reset the failure budget — auth-driven closes shouldn't accumulate
      // toward the network-failure pause threshold. tokenStore now has the
      // rotated pair; the 0-delay retry yields to the event loop and lets
      // openSocket() pick up the new token on the next tick.
      this.failures = 0;
      this.scheduleRetry(0);
    } catch {
      // Refresh token expired or revoked — the user is effectively logged
      // out. We deliberately don't broadcast logout from here: any subsequent
      // REST call's 401 will trip http.ts's interceptor, which is the
      // canonical owner of session teardown (AuthProvider listens on the
      // auth channel and routes to /login). We just stop trying.
      if (generation !== this.generation) return;
      this.refreshInFlight = false;
      this.failures = 0;
      this.setStatus('idle');
    }
  }

  private scheduleRetry(explicitMs?: number): void {
    this.clearRetry();
    const delay = explicitMs ?? this.computeBackoff();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.status === 'paused') this.failures = 0;
      this.openSocket();
    }, delay);
  }

  private computeBackoff(): number {
    const exp = Math.min(BASE_DELAY_MS * 2 ** (this.failures - 1), MAX_DELAY_MS);
    const jitter = 0.5 + Math.random();
    return Math.min(MAX_DELAY_MS, Math.floor(exp * jitter));
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((fn) => {
      fn(status);
    });
  }
}

export const wsClient = new WsClient();
