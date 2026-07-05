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
  readonly openedAt: string;
  readonly updatedAt: string;
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
  readonly invalidReason?: string;
  readonly progressPct?: number;
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
  typeof v.openedAt === 'string' &&
  typeof v.updatedAt === 'string' &&
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
    const reasonOk = v.invalidReason === undefined || typeof v.invalidReason === 'string';
    const pctOk =
      v.progressPct === undefined ||
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

class WsClient {
  private socket: WebSocket | null = null;
  private status: WsStatus = 'idle';
  private failures = 0;
  private retryTimer: number | null = null;
  private intentionalClose = false;
  // Token used for the current/most-recent connect attempt. Forwarded to
  // refreshOnce() on auth-driven closes so the coalescer knows which token
  // was rejected and can short-circuit if another tab has already rotated.
  private currentAttemptToken: string | null = null;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly eventListeners = new Set<AnyEventListener>();

  connect(): void {
    if (this.status === 'open' || this.status === 'connecting') return;
    this.intentionalClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearRetry();
    if (this.socket) {
      this.socket.close(1000, 'client disconnect');
      this.socket = null;
    }
    this.failures = 0;
    this.setStatus('idle');
  }

  getStatus(): WsStatus {
    return this.status;
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
    this.setStatus(this.failures === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${env.wsUrl}/dashboard?access_token=${encodeURIComponent(token)}`,
      );
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.failures = 0;
      this.setStatus('open');
    });
    socket.addEventListener('message', (e: MessageEvent<unknown>) => {
      this.handleMessage(e);
    });
    socket.addEventListener('close', (e: CloseEvent) => {
      this.handleClose(e);
    });
    socket.addEventListener('error', () => {
      // 'close' will fire after 'error'; backoff lives there.
    });
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    if (typeof event.data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isWsEvent(parsed)) return;
    this.eventListeners.forEach((fn) => {
      fn(parsed);
    });
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    if (this.intentionalClose) {
      this.setStatus('idle');
      return;
    }
    if (this.isAuthClose(event)) {
      // Server rejected our token. Refresh BEFORE retrying — otherwise we'd
      // bounce off /dashboard with the same stale token, get closed again,
      // and burn through PAUSE_AFTER_FAILURES into the 5-minute pause for no
      // good reason. Auth lapses aren't network problems and don't count
      // toward the pause budget either.
      void this.handleAuthClose();
      return;
    }
    this.failures += 1;
    if (this.failures >= PAUSE_AFTER_FAILURES) {
      // Proxy/firewall likely blocking WS — degrade gracefully and try again
      // later. App continues to function without real-time updates.
      this.setStatus('paused');
      this.scheduleRetry(PAUSE_RETRY_MS);
      return;
    }
    this.scheduleRetry();
  }

  private isAuthClose(event: CloseEvent): boolean {
    if (AUTH_CLOSE_CODES.has(event.code)) return true;
    return AUTH_REASON_PATTERN.test(event.reason);
  }

  private async handleAuthClose(): Promise<void> {
    this.setStatus('reconnecting');
    try {
      // refreshOnce coalesces with REST refreshes (per-tab Promise dedup) and
      // serialises across tabs (Web Locks API). MUST go through it — calling
      // refreshAccessToken() directly would risk concurrent /auth/refresh
      // requests, and the spec rotates the refresh token on every call.
      await refreshOnce(this.currentAttemptToken);
      // disconnect() may have fired during the refresh await; respect it.
      if (this.intentionalClose) return;
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
      this.failures = 0;
      if (!this.intentionalClose) this.setStatus('idle');
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
