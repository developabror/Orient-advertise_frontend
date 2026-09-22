// Vitest unit tests for the WebSocket handshake auth wiring.
//
// The browser WebSocket API cannot set custom headers, so the backend
// `DashboardHandshakeInterceptor` accepts an `access_token` query
// parameter as the only viable handshake credential. These tests assert:
//   1. when a token is in the store, connect() builds a URL whose
//      `access_token` param is URL-encoded;
//   2. when no token is present, connect() never constructs a WebSocket
//      and the client stays idle (so we don't burn through the 5-attempt
//      pause budget in unauthenticated states).
//
// Run with `vitest run src/api/__tests__/wsClient.test.ts` once the
// project's test framework is installed (see README / packages.json).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the env module so the test doesn't require VITE_API_URL /
// VITE_WS_URL to be defined in the runtime env.
vi.mock('../env', () => ({
  env: { apiUrl: 'http://localhost:8080', wsUrl: 'ws://localhost:8080' },
}));

// Mock the http module to control refreshOnce() outcomes deterministically.
// We don't exercise the real axios instance from these tests; we only care
// that wsClient routes auth-driven closes through the coalesced refresh.
vi.mock('../http', () => ({
  http: {},
  refreshOnce: vi.fn(),
}));

import { refreshOnce } from '../http';
import { tokenStore } from '../tokenStore';
import { isWsEvent, wsClient } from '../wsClient';

const mockRefreshOnce = refreshOnce as unknown as ReturnType<typeof vi.fn>;

interface MockCloseEvent {
  readonly code: number;
  readonly reason: string;
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  private readonly closeListeners: Array<(ev: MockCloseEvent) => void> = [];
  private readonly messageListeners: Array<(ev: { data: unknown }) => void> = [];
  private readonly openListeners: Array<() => void> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: never) => void): void {
    if (type === 'close') {
      this.closeListeners.push(listener as (ev: MockCloseEvent) => void);
    } else if (type === 'message') {
      this.messageListeners.push(listener as (ev: { data: unknown }) => void);
    } else if (type === 'open') {
      this.openListeners.push(listener as () => void);
    }
    // 'error' listeners are intentionally dropped.
  }
  removeEventListener(): void {}
  // Recorded, not dispatched: a real socket's close event arrives later and
  // asynchronously, so tests fire it explicitly with simulateClose().
  closeCode: number | null = null;
  close(code?: number): void {
    this.closeCode = code ?? 1005;
  }
  send(): void {}

  // Test-only helper: dispatches a synthetic CloseEvent to every listener
  // the wsClient registered via addEventListener('close', ...).
  simulateClose(code: number, reason = ''): void {
    const event: MockCloseEvent = { code, reason };
    for (const fn of this.closeListeners) fn(event);
  }

  simulateOpen(): void {
    for (const fn of this.openListeners) fn();
  }

  // `data` is passed through verbatim so a test can drive both the happy
  // path (a JSON string) and the malformed cases (non-string, unparseable).
  simulateMessage(data: unknown): void {
    for (const fn of this.messageListeners) fn({ data });
  }
}

const realWebSocket: typeof globalThis.WebSocket | undefined = globalThis.WebSocket;

describe('wsClient handshake', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    tokenStore.set(null);
    mockRefreshOnce.mockReset();
    wsClient.disconnect();
  });

  afterEach(() => {
    wsClient.disconnect();
    tokenStore.set(null);
    mockRefreshOnce.mockReset();
    if (realWebSocket !== undefined) {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
    }
  });

  it('appends a URL-encoded access_token query param when a token is present', () => {
    // Token deliberately contains characters that REQUIRE percent-encoding
    // (`+`, `/`, `=`, space) — encodeURIComponent must transform all of them.
    const token = 'aaa.bbb+ccc/ddd=eee fff.ggg';
    tokenStore.set(token);

    wsClient.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    const url = MockWebSocket.instances[0]!.url;
    expect(url).toContain(`access_token=${encodeURIComponent(token)}`);
    // Sanity: the unencoded token must NOT appear verbatim in the URL.
    expect(url).not.toContain(token);
    // Sanity: each special character must be encoded, not raw.
    expect(url).not.toMatch(/access_token=[^&]*\+/);
    expect(url).not.toMatch(/access_token=[^&]*\//);
    expect(url).not.toMatch(/access_token=[^&]*=/);
    expect(url).not.toMatch(/access_token=[^&]* /);
  });

  it('does not construct a WebSocket and stays idle when no token is present', () => {
    tokenStore.set(null);

    wsClient.connect();

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(wsClient.getStatus()).toBe('idle');
  });

  it('does not construct a WebSocket when the token is the empty string', () => {
    tokenStore.set('');

    wsClient.connect();

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(wsClient.getStatus()).toBe('idle');
  });

  // (a) Auth-related close (code 1008) → refresh → reconnect with new token.
  it('refreshes the token and reconnects after an auth-related close (code 1008)', async () => {
    vi.useFakeTimers();
    try {
      const newToken = 'rotated-token';
      mockRefreshOnce.mockImplementationOnce(async () => {
        // refreshAccessToken's real behavior: writes the new access token to
        // tokenStore (the rotated refresh token is set by the backend as a
        // Set-Cookie out-of-band). The test mock mirrors that in-memory side
        // effect so the reconnect attempt picks it up.
        tokenStore.set(newToken);
        return newToken;
      });

      tokenStore.set('stale-token');
      wsClient.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0]!.url).toContain('access_token=stale-token');

      MockWebSocket.instances[0]!.simulateClose(1008, 'token expired');
      // Flush microtasks (refreshOnce promise resolution) AND the 0-ms
      // scheduleRetry timer that handleAuthClose enqueues on success.
      await vi.runAllTimersAsync();

      expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
      expect(mockRefreshOnce).toHaveBeenCalledWith('stale-token');
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1]!.url).toContain(`access_token=${newToken}`);
    } finally {
      vi.useRealTimers();
    }
  });

  // (b) Auth close + refresh fails → idle, no further reconnect attempts.
  it('goes idle and does not retry when refresh fails after an auth close', async () => {
    vi.useFakeTimers();
    try {
      mockRefreshOnce.mockRejectedValueOnce(new Error('Refresh token revoked'));

      tokenStore.set('stale-token');
      wsClient.connect();

      expect(MockWebSocket.instances).toHaveLength(1);

      MockWebSocket.instances[0]!.simulateClose(1008, 'unauthorized');
      // Advance well past any backoff that the non-auth path would have
      // scheduled — to assert nothing fires from this branch.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(wsClient.getStatus()).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  // (c) Non-auth close (network drop) → existing exponential-backoff path,
  // refresh NOT called, eventually reconnects with the same token.
  it('uses the existing exponential backoff on a non-auth close, without refreshing', async () => {
    vi.useFakeTimers();
    try {
      tokenStore.set('valid-token');
      wsClient.connect();

      expect(MockWebSocket.instances).toHaveLength(1);

      // 1006 = abnormal closure (TCP RST, network drop, proxy timeout).
      // First-failure backoff is BASE_DELAY_MS * 2^0 = 1000ms with jitter
      // capped well under 60s, so advancing 60s definitely fires the retry.
      MockWebSocket.instances[0]!.simulateClose(1006, '');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRefreshOnce).not.toHaveBeenCalled();
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[1]!.url).toContain('access_token=valid-token');
    } finally {
      vi.useRealTimers();
    }
  });

  // Reason-string fallback: if the server doesn't use 1008 but the close
  // reason includes an auth keyword, we still take the refresh path.
  it('treats a close whose reason matches the auth pattern as an auth close', async () => {
    vi.useFakeTimers();
    try {
      mockRefreshOnce.mockImplementationOnce(async () => {
        tokenStore.set('rotated');
        return 'rotated';
      });

      tokenStore.set('stale-token');
      wsClient.connect();
      MockWebSocket.instances[0]!.simulateClose(1011, 'token expired');
      await vi.runAllTimersAsync();

      expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isWsEvent — INCIDENT_UPDATED', () => {
  // Mirror of the backend `IncidentPayload` envelope. Numeric ids,
  // `description` (no `message`), `openedAt`/`updatedAt` (no
  // `occurredAt`/`occurrenceCount`).
  const validPayload = (): Record<string, unknown> => ({
    type: 'INCIDENT_UPDATED',
    incidentId: 42,
    deviceId: 7,
    eventType: 'DEVICE_OFFLINE',
    status: 'ACKNOWLEDGED',
    priority: 'HIGH',
    description: 'Device went offline at lobby kiosk',
    openedAt: '2026-05-08T10:00:00Z',
    updatedAt: '2026-05-08T10:05:00Z',
    actor: 'operator@orient',
  });

  it('accepts a fully-formed INCIDENT_UPDATED payload', () => {
    expect(isWsEvent(validPayload())).toBe(true);
  });

  it('accepts actor === null (system-driven transition)', () => {
    expect(isWsEvent({ ...validPayload(), actor: null })).toBe(true);
  });

  // `RedisDashboardEventBroadcaster.incidentJson` renders these two as an
  // explicit JSON `null` when the payload has none — exactly the pattern that
  // made `invalidReason` drop every CONTENT_STATUS_CHANGE READY frame. A
  // `typeof === 'string'` guard here would silently discard the incident.
  it('accepts openedAt === null (explicit null on the wire, not an omission)', () => {
    expect(isWsEvent({ ...validPayload(), openedAt: null })).toBe(true);
  });

  it('accepts updatedAt === null', () => {
    expect(isWsEvent({ ...validPayload(), updatedAt: null })).toBe(true);
  });

  it('accepts openedAt, updatedAt and actor all null at once', () => {
    expect(
      isWsEvent({ ...validPayload(), openedAt: null, updatedAt: null, actor: null }),
    ).toBe(true);
  });

  // Admitting null must not become admitting anything.
  it('still rejects non-string, non-null timestamps', () => {
    expect(isWsEvent({ ...validPayload(), openedAt: 1_749_000_000 })).toBe(false);
    expect(isWsEvent({ ...validPayload(), updatedAt: { at: 'now' } })).toBe(false);
  });

  it('accepts every valid status value', () => {
    for (const status of ['OPEN', 'ACKNOWLEDGED', 'RESOLVED']) {
      expect(isWsEvent({ ...validPayload(), status })).toBe(true);
    }
  });

  it('accepts every valid priority value', () => {
    for (const priority of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) {
      expect(isWsEvent({ ...validPayload(), priority })).toBe(true);
    }
  });

  it('rejects a payload missing required fields', () => {
    const required = [
      'incidentId',
      'deviceId',
      'eventType',
      'status',
      'priority',
      'description',
      'openedAt',
      'updatedAt',
      'actor',
    ];
    for (const field of required) {
      const p = validPayload();
      delete p[field];
      expect(isWsEvent(p)).toBe(false);
    }
  });

  it('rejects an invalid status enum value', () => {
    expect(isWsEvent({ ...validPayload(), status: 'open' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), status: 'CLOSED' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), status: '' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), status: null })).toBe(false);
    expect(isWsEvent({ ...validPayload(), status: 1 })).toBe(false);
  });

  it('rejects an invalid priority enum value', () => {
    expect(isWsEvent({ ...validPayload(), priority: 'critical' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), priority: 'URGENT' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), priority: null })).toBe(false);
  });

  it('rejects an invalid actor type (numeric)', () => {
    expect(isWsEvent({ ...validPayload(), actor: 42 })).toBe(false);
  });

  // Nullable is not the same as optional: the broadcaster always renders the
  // key, so an *absent* one is a malformed frame even though `null` is fine.
  it('rejects an omitted openedAt/updatedAt even though null is accepted', () => {
    for (const field of ['openedAt', 'updatedAt', 'actor']) {
      const p = validPayload();
      delete p[field];
      expect(isWsEvent(p)).toBe(false);
      expect(isWsEvent({ ...validPayload(), [field]: null })).toBe(true);
    }
  });

  it('rejects non-numeric or non-finite ids', () => {
    expect(isWsEvent({ ...validPayload(), incidentId: '42' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), incidentId: Number.NaN })).toBe(false);
    expect(isWsEvent({ ...validPayload(), deviceId: '7' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), deviceId: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects an unknown discriminator', () => {
    expect(isWsEvent({ ...validPayload(), type: 'INCIDENT_RESOLVED' })).toBe(false);
  });

  // Regression guard: INCIDENT_CRITICAL shares the IncidentPayload shape;
  // only the `type` discriminator differs.
  it('accepts INCIDENT_CRITICAL with the same IncidentPayload shape', () => {
    expect(isWsEvent({ ...validPayload(), type: 'INCIDENT_CRITICAL' })).toBe(true);
  });

  it('rejects the legacy `message`/`occurredAt` shape that no longer ships', () => {
    expect(
      isWsEvent({
        type: 'INCIDENT_CRITICAL',
        incidentId: 'inc-1',
        deviceId: 'dev-1',
        message: 'Critical event',
        occurredAt: '2026-05-08T10:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('isWsEvent — DEVICE_STATUS_CHANGE', () => {
  // Mirrors the README "Dashboard Live Feed" payload shape: backend emits the
  // uppercase Device.Status enum AND carries oldStatus + newStatus separately.
  const validPayload = (): Record<string, unknown> => ({
    type: 'DEVICE_STATUS_CHANGE',
    deviceId: 'dev-7',
    oldStatus: 'OFFLINE',
    newStatus: 'ONLINE',
    changedAt: '2026-05-08T10:00:00Z',
  });

  it('accepts a fully-formed payload with string deviceId', () => {
    expect(isWsEvent(validPayload())).toBe(true);
  });

  it('accepts a numeric deviceId (backend Long)', () => {
    expect(isWsEvent({ ...validPayload(), deviceId: 12_345 })).toBe(true);
  });

  it('accepts every Device.Status enum value in oldStatus and newStatus', () => {
    const values: readonly string[] = ['ONLINE', 'OFFLINE', 'NO_CONTENT', 'UNREGISTERED'];
    for (const oldStatus of values) {
      for (const newStatus of values) {
        expect(isWsEvent({ ...validPayload(), oldStatus, newStatus })).toBe(true);
      }
    }
  });

  it('accepts a NO_CONTENT transition (the case the previous validator dropped)', () => {
    expect(
      isWsEvent({ ...validPayload(), oldStatus: 'UNREGISTERED', newStatus: 'NO_CONTENT' }),
    ).toBe(true);
  });

  it('rejects lowercase enum values (legacy FE shape)', () => {
    expect(isWsEvent({ ...validPayload(), oldStatus: 'offline' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), newStatus: 'online' })).toBe(false);
    // The pre-fix shape used a single `status: 'degraded'`; that field/value
    // must not validate under the new schema.
    expect(
      isWsEvent({
        type: 'DEVICE_STATUS_CHANGE',
        deviceId: 'dev-7',
        status: 'degraded',
        changedAt: '2026-05-08T10:00:00Z',
      }),
    ).toBe(false);
  });

  it('rejects unknown enum values', () => {
    expect(isWsEvent({ ...validPayload(), oldStatus: 'DEGRADED' })).toBe(false);
    expect(isWsEvent({ ...validPayload(), newStatus: 'PROVISIONING' })).toBe(false);
  });

  it('rejects payloads missing required fields', () => {
    for (const field of ['deviceId', 'oldStatus', 'newStatus', 'changedAt']) {
      const p = validPayload();
      delete p[field];
      expect(isWsEvent(p)).toBe(false);
    }
  });

  it('rejects an invalid deviceId type', () => {
    expect(isWsEvent({ ...validPayload(), deviceId: null })).toBe(false);
    expect(isWsEvent({ ...validPayload(), deviceId: { id: 1 } })).toBe(false);
    expect(isWsEvent({ ...validPayload(), deviceId: Number.NaN })).toBe(false);
    expect(isWsEvent({ ...validPayload(), deviceId: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects a non-string changedAt', () => {
    expect(isWsEvent({ ...validPayload(), changedAt: Date.now() })).toBe(false);
    expect(isWsEvent({ ...validPayload(), changedAt: null })).toBe(false);
  });

  // Sibling-guard audit: unlike the incident and content frames, the
  // DEVICE_STATUS_CHANGE template has NO nullable field —
  // `RedisDashboardEventBroadcaster.deviceStatusChanged` renders `deviceId`
  // as `%d` and the other three inside quotes. Every field is therefore
  // required-and-non-null, and an explicit null in any of them is a
  // malformed frame, not the "explicit null" pattern seen elsewhere.
  it('rejects an explicit null in every field (no nullable field on this frame)', () => {
    for (const field of ['deviceId', 'oldStatus', 'newStatus', 'changedAt']) {
      expect(isWsEvent({ ...validPayload(), [field]: null })).toBe(false);
    }
  });
});

describe('isWsEvent — CONTENT_STATUS_CHANGE', () => {
  const valid = (): Record<string, unknown> => ({
    type: 'CONTENT_STATUS_CHANGE',
    contentId: 123,
    status: 'READY',
  });

  it('accepts a minimal valid payload', () => {
    expect(isWsEvent(valid())).toBe(true);
  });

  it('accepts every transcoding status value', () => {
    for (const status of ['TRANSCODING', 'READY', 'FAILED', 'INVALID']) {
      expect(isWsEvent({ ...valid(), status })).toBe(true);
    }
  });

  it('accepts optional invalidReason and progressPct when well-typed', () => {
    expect(isWsEvent({ ...valid(), status: 'INVALID', invalidReason: 'bad codec' })).toBe(true);
    expect(isWsEvent({ ...valid(), status: 'TRANSCODING', progressPct: 42 })).toBe(true);
    expect(isWsEvent({ ...valid(), status: 'TRANSCODING', progressPct: 0 })).toBe(true);
  });

  // THE regression case. `RedisDashboardEventBroadcaster.contentStatusChanged`
  // renders `invalidReason` unconditionally —
  // `p.invalidReason() == null ? "null" : "\"…\""` — so every non-INVALID
  // frame carries an explicit JSON null. JSON has no `undefined` and
  // `typeof null === 'object'`, so the old
  // `=== undefined || typeof === 'string'` guard rejected the whole frame.
  // Only INVALID survived (markInvalid always supplies a string), which meant
  // READY — the one transition the operator waits on — was silently dropped.
  it('accepts invalidReason === null on a READY frame (the explicit wire null)', () => {
    expect(isWsEvent({ ...valid(), invalidReason: null })).toBe(true);
  });

  it('accepts invalidReason === null for every status value', () => {
    for (const status of ['TRANSCODING', 'READY', 'FAILED', 'INVALID']) {
      expect(isWsEvent({ ...valid(), status, invalidReason: null })).toBe(true);
    }
  });

  it('accepts progressPct === null (same explicit-null publisher style)', () => {
    expect(isWsEvent({ ...valid(), progressPct: null })).toBe(true);
    expect(isWsEvent({ ...valid(), invalidReason: null, progressPct: null })).toBe(true);
  });

  it('rejects a non-numeric / non-finite contentId', () => {
    expect(isWsEvent({ ...valid(), contentId: '123' })).toBe(false);
    expect(isWsEvent({ ...valid(), contentId: Number.NaN })).toBe(false);
    expect(isWsEvent({ ...valid(), contentId: null })).toBe(false);
  });

  it('rejects an unknown, lowercase, or pre-transcode status', () => {
    // UPLOADED is the pre-transcode state the uploader already holds locally —
    // it is not broadcast and must not validate here.
    expect(isWsEvent({ ...valid(), status: 'UPLOADED' })).toBe(false);
    expect(isWsEvent({ ...valid(), status: 'ready' })).toBe(false);
    expect(isWsEvent({ ...valid(), status: 'DONE' })).toBe(false);
    expect(isWsEvent({ ...valid(), status: null })).toBe(false);
  });

  // Admitting `null` must not slide into admitting anything: these are the
  // negative half of the widened guard.
  it('rejects malformed optional fields', () => {
    expect(isWsEvent({ ...valid(), invalidReason: 5 })).toBe(false);
    expect(isWsEvent({ ...valid(), invalidReason: 0 })).toBe(false);
    expect(isWsEvent({ ...valid(), invalidReason: false })).toBe(false);
    expect(isWsEvent({ ...valid(), invalidReason: {} })).toBe(false);
    expect(isWsEvent({ ...valid(), invalidReason: ['bad codec'] })).toBe(false);
    expect(isWsEvent({ ...valid(), progressPct: 'lots' })).toBe(false);
    expect(isWsEvent({ ...valid(), progressPct: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isWsEvent({ ...valid(), progressPct: Number.NaN })).toBe(false);
  });

  it('rejects payloads missing a required field', () => {
    for (const field of ['contentId', 'status']) {
      const p = valid();
      delete p[field];
      expect(isWsEvent(p)).toBe(false);
    }
  });
});

// Delivery path, not just the validator: a frame has to survive JSON.parse,
// isWsEvent AND handleMessage's dispatch to reach a consumer. The production
// bug lived in the gap between "the guard is wrong" and "nothing says so" —
// handleMessage returned early with no log and no counter, so a dead live
// feed looked exactly like a quiet one.
describe('wsClient — handleMessage delivery and dropped-frame accounting', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const connectAndOpen = (): MockWebSocket => {
    tokenStore.set('test-token');
    wsClient.connect();
    const socket = MockWebSocket.instances[0];
    if (socket === undefined) throw new Error('no socket was constructed');
    socket.simulateOpen();
    return socket;
  };

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    tokenStore.set(null);
    mockRefreshOnce.mockReset();
    wsClient.disconnect();
    wsClient.resetDroppedFrames();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    wsClient.disconnect();
    wsClient.resetDroppedFrames();
    tokenStore.set(null);
    if (realWebSocket !== undefined) {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
    }
  });

  it('delivers a READY frame carrying invalidReason: null to its consumer', () => {
    const received: unknown[] = [];
    const unsub = wsClient.onEvent('CONTENT_STATUS_CHANGE', (e) => {
      received.push(e);
    });
    const socket = connectAndOpen();

    // Byte-for-byte the frame the backend broadcaster emits for a completed
    // transcode: explicit `null` reason, plus the `at` field the FE type does
    // not declare (extra keys are not a rejection reason).
    socket.simulateMessage(
      '{"type":"CONTENT_STATUS_CHANGE","contentId":41,"status":"READY",' +
        '"invalidReason":null,"at":"2026-09-06T09:12:00Z"}',
    );

    expect(received).toEqual([
      {
        type: 'CONTENT_STATUS_CHANGE',
        contentId: 41,
        status: 'READY',
        invalidReason: null,
        at: '2026-09-06T09:12:00Z',
      },
    ]);
    expect(wsClient.getDroppedFrames()['rejected-by-guard']).toBe(0);
    unsub();
  });

  it('counts and warns when a frame parses but fails the guard', () => {
    const received: unknown[] = [];
    const unsub = wsClient.onEvent('CONTENT_STATUS_CHANGE', (e) => {
      received.push(e);
    });
    const socket = connectAndOpen();

    socket.simulateMessage('{"type":"CONTENT_STATUS_CHANGE","contentId":41,"status":"DONE"}');

    expect(received).toHaveLength(0);
    expect(wsClient.getDroppedFrames()['rejected-by-guard']).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('rejected-by-guard');
    unsub();
  });

  it('counts an unparseable frame separately from a rejected one', () => {
    const socket = connectAndOpen();

    socket.simulateMessage('{not json');

    expect(wsClient.getDroppedFrames()).toMatchObject({
      unparseable: 1,
      'rejected-by-guard': 0,
    });
  });

  it('counts a non-string payload (binary frame)', () => {
    const socket = connectAndOpen();

    socket.simulateMessage(new ArrayBuffer(4));

    expect(wsClient.getDroppedFrames()['non-string']).toBe(1);
  });

  // Out of scope by design: a double-JSON-encoded frame is a backend
  // publisher bug (it was fixed by switching to StringRedisTemplate).
  // Unwrapping it here would hide the regression and break once the
  // publisher is correct — so it must land in the dropped-frame count,
  // loudly, rather than be silently repaired.
  it('drops (and counts) a double-encoded frame instead of unwrapping it', () => {
    const received: unknown[] = [];
    const unsub = wsClient.onEvent('CONTENT_STATUS_CHANGE', (e) => {
      received.push(e);
    });
    const socket = connectAndOpen();

    const inner = '{"type":"CONTENT_STATUS_CHANGE","contentId":41,"status":"READY","invalidReason":null}';
    socket.simulateMessage(JSON.stringify(inner));

    expect(received).toHaveLength(0);
    expect(wsClient.getDroppedFrames()['rejected-by-guard']).toBe(1);
    unsub();
  });

  it('delivers an INCIDENT_CRITICAL frame with null openedAt/updatedAt/actor', () => {
    const received: unknown[] = [];
    const unsub = wsClient.onEvent('INCIDENT_CRITICAL', (e) => {
      received.push(e);
    });
    const socket = connectAndOpen();

    socket.simulateMessage(
      '{"type":"INCIDENT_CRITICAL","incidentId":9,"deviceId":3,"eventType":"DEVICE_OFFLINE",' +
        '"status":"OPEN","priority":"CRITICAL","description":"offline",' +
        '"openedAt":null,"updatedAt":null,"actor":null}',
    );

    expect(received).toHaveLength(1);
    expect(wsClient.getDroppedFrames()['rejected-by-guard']).toBe(0);
    unsub();
  });
});

// FE-02. One socket at a time, and nothing from an old one ever reaches a
// listener. Before this, connect() opened a second socket whenever the status
// was not open/connecting — during every backoff, pause and token refresh —
// while the pending retry opened another; events arrived twice, disconnect()
// closed only the newest socket, and the orphan kept streaming the previous
// user's events to whoever signed in next in the tab.
describe('wsClient — one socket at a time (FE-02)', () => {
  const INCIDENT =
    '{"type":"INCIDENT_CRITICAL","incidentId":9,"deviceId":3,"eventType":"DEVICE_OFFLINE",' +
    '"status":"OPEN","priority":"CRITICAL","description":"offline",' +
    '"openedAt":null,"updatedAt":null,"actor":null}';

  const socketAt = (i: number): MockWebSocket => {
    const socket = MockWebSocket.instances[i];
    if (socket === undefined) throw new Error(`no socket #${String(i)}`);
    return socket;
  };

  let received: unknown[];
  let unsub: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    mockRefreshOnce.mockReset();
    wsClient.disconnect();
    tokenStore.set('user-a-token');
    received = [];
    unsub = wsClient.onEvent('INCIDENT_CRITICAL', (e) => {
      received.push(e);
    });
  });

  afterEach(() => {
    unsub();
    wsClient.disconnect();
    tokenStore.set(null);
    mockRefreshOnce.mockReset();
    vi.useRealTimers();
    if (realWebSocket !== undefined) {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
    }
  });

  it('connect() during a backoff opens nothing; the retry opens exactly one socket', async () => {
    wsClient.connect();
    socketAt(0).simulateOpen();
    socketAt(0).simulateClose(1006);
    expect(wsClient.getStatus()).toBe('reconnecting');

    wsClient.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('connect() while a reconnect attempt is still connecting opens nothing', async () => {
    wsClient.connect();
    socketAt(0).simulateClose(1006);
    await vi.advanceTimersByTimeAsync(60_000); // retry socket #1 is now connecting
    expect(wsClient.getStatus()).toBe('reconnecting');

    wsClient.connect();

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('connect() while paused opens nothing until the pause ends', async () => {
    wsClient.connect();
    for (let i = 0; i < 5; i++) {
      socketAt(MockWebSocket.instances.length - 1).simulateClose(1006);
      if (wsClient.getStatus() !== 'paused') await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(wsClient.getStatus()).toBe('paused');
    const before = MockWebSocket.instances.length;

    wsClient.connect();

    expect(MockWebSocket.instances).toHaveLength(before);
  });

  it('connect() while an auth refresh is in flight ends with exactly one socket', async () => {
    let resolveRefresh: (token: string) => void = () => undefined;
    mockRefreshOnce.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = (t) => {
            tokenStore.set(t);
            resolve(t);
          };
        }),
    );
    wsClient.connect();
    socketAt(0).simulateClose(1008, 'token expired');

    wsClient.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    resolveRefresh('rotated');
    await vi.runAllTimersAsync();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(socketAt(1).url).toContain('access_token=rotated');
  });

  it('a refresh that resolves after a logout and a new login does not open a second socket', async () => {
    let resolveRefresh: (token: string) => void = () => undefined;
    mockRefreshOnce.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = (t) => {
            resolve(t);
          };
        }),
    );
    wsClient.connect();
    socketAt(0).simulateClose(1008, 'token expired');

    wsClient.disconnect(); // user A logs out mid-refresh
    tokenStore.set('user-b-token');
    wsClient.connect(); // user B signs in
    expect(MockWebSocket.instances).toHaveLength(2);

    resolveRefresh('user-a-rotated');
    await vi.runAllTimersAsync();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(socketAt(1).url).toContain('access_token=user-b-token');
  });

  it("never delivers a disconnected socket's frames — not the previous user's events after a logout", () => {
    wsClient.connect();
    const userA = socketAt(0);
    userA.simulateOpen();
    wsClient.disconnect();
    expect(userA.closeCode).toBe(1000);

    tokenStore.set('user-b-token');
    wsClient.connect();
    const userB = socketAt(1);
    userB.simulateOpen();

    userA.simulateMessage(INCIDENT); // still in flight from the old connection
    expect(received).toHaveLength(0);

    userB.simulateMessage(INCIDENT);
    expect(received).toHaveLength(1);
  });

  it("an old socket's close neither detaches the current socket nor schedules a reconnect", async () => {
    wsClient.connect();
    const old = socketAt(0);
    wsClient.disconnect();
    wsClient.connect();
    const current = socketAt(1);
    current.simulateOpen();

    old.simulateClose(1006); // the browser delivers the old socket's close late
    await vi.advanceTimersByTimeAsync(60_000);

    expect(wsClient.getStatus()).toBe('open');
    expect(MockWebSocket.instances).toHaveLength(2);
    wsClient.disconnect();
    expect(current.closeCode).toBe(1000); // still reachable, so it can still be closed
  });

  // --- the client follows the session's token (review follow-ups) ---

  const base64Url = (value: string): string =>
    btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (sub: string, nonce = 0): string =>
    [
      base64Url(JSON.stringify({ alg: 'none' })),
      base64Url(JSON.stringify({ sub, role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600, nonce })),
      'sig',
    ].join('.');

  it('comes back when a new token arrives after a refresh that failed without ending the session', async () => {
    // A 429/5xx/network refresh failure keeps the session (http.ts), so the feed must not stay dead.
    mockRefreshOnce.mockRejectedValueOnce(new Error('503 from /api/auth/refresh'));
    tokenStore.set(jwt('alice'));
    wsClient.connect();
    socketAt(0).simulateClose(1008, 'token expired');
    await vi.runAllTimersAsync();
    expect(wsClient.getStatus()).toBe('idle');
    expect(MockWebSocket.instances).toHaveLength(1);

    tokenStore.set(jwt('alice', 1)); // REST refreshed successfully later

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('a fresh token ends a pause at once instead of waiting out five minutes', async () => {
    tokenStore.set(jwt('alice'));
    wsClient.connect();
    for (let i = 0; i < 5; i++) {
      socketAt(MockWebSocket.instances.length - 1).simulateClose(1006);
      if (wsClient.getStatus() !== 'paused') await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(wsClient.getStatus()).toBe('paused');
    const before = MockWebSocket.instances.length;

    tokenStore.set(jwt('alice', 1));

    expect(MockWebSocket.instances).toHaveLength(before + 1);
    await vi.advanceTimersByTimeAsync(10 * 60_000); // the cancelled pause timer opens nothing more
    expect(MockWebSocket.instances).toHaveLength(before + 1);
  });

  it('a token rotation while the socket is live does not churn it', () => {
    tokenStore.set(jwt('alice'));
    wsClient.connect();
    socketAt(0).simulateOpen();

    tokenStore.set(jwt('alice', 1));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socketAt(0).closeCode).toBeNull();
  });

  it("a different user's token drops the socket in the same step — no frame of the old user gets through", () => {
    tokenStore.set(jwt('alice'));
    wsClient.connect();
    const alice = socketAt(0);
    alice.simulateOpen();

    tokenStore.set(jwt('bob')); // another tab signed in as bob — before any React effect runs
    alice.simulateMessage(INCIDENT);

    expect(received).toHaveLength(0);
    expect(alice.closeCode).toBe(1000);
    expect(wsClient.getStatus()).toBe('idle');
  });

  it('a cleared token drops the socket in the same step', () => {
    tokenStore.set(jwt('alice'));
    wsClient.connect();
    const alice = socketAt(0);
    alice.simulateOpen();

    tokenStore.set(null);
    alice.simulateMessage(INCIDENT);

    expect(received).toHaveLength(0);
    expect(alice.closeCode).toBe(1000);
  });

  it('a WebSocket constructor that keeps throwing backs off into a pause, not a tight loop', async () => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
      constructor() {
        throw new SyntaxError('invalid url');
      }
    };
    wsClient.connect();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(wsClient.getStatus()).toBe('paused');
  });

  it('disconnect() cancels a pending retry, and connect() afterwards opens exactly one socket', async () => {
    wsClient.connect();
    socketAt(0).simulateClose(1006);
    wsClient.disconnect();

    wsClient.connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('an old socket that opens late does not flip the status of the current one', () => {
    wsClient.connect();
    const old = socketAt(0);
    wsClient.disconnect();

    old.simulateOpen();

    expect(wsClient.getStatus()).toBe('idle');
  });
});
