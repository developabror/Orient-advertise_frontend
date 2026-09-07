// Vitest unit tests for src/api/resources/remoteControl.ts.
//
// Two things these pin that nothing else can:
//   1. `GET` never yields a `viewerTicket` — structurally, not by convention.
//   2. No code path on start/get writes the ticket to a persisted store. That
//      assertion is deliberately made against real spies on localStorage /
//      sessionStorage rather than by reading the source, because the failure
//      mode is a future edit adding a "helpful" cache.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import { tokenStore } from '../../tokenStore';
import {
  getDeviceConnection,
  getRemoteSession,
  isTerminalStatus,
  startRemoteSession,
  stopRemoteSession,
  stopRemoteSessionBeacon,
} from '../remoteControl';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const TICKET = 'vt_super_secret_single_use';

const sessionBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionId: 'rs_7f3a91c4b8e24d5a',
  deviceId: 12,
  status: 'PENDING',
  relayUrl: 'wss://relay.example.uz/viewer',
  viewerTicket: TICKET,
  expiresAt: '2026-08-27T10:45:00Z',
  viewOnly: false,
  deliveredVia: 'WS',
  capability: {
    supported: true,
    input: 'ROOT',
    transport: 'SCRCPY_WS',
    maxWidth: 1280,
    maxHeight: 720,
    reportedAt: '2026-08-27T10:12:00Z',
  },
  ...over,
});

const axiosError = (status: number): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: { status, statusText: '', data: {}, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  vi.restoreAllMocks();
  tokenStore.set(null);
});

describe('startRemoteSession', () => {
  it('POSTs to the device remote endpoint and returns the parsed session', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody() });

    const session = await startRemoteSession(12);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0] as [string, unknown];
    expect(url).toBe('/api/devices/12/remote');
    expect(body).toEqual({ viewOnly: false });
    expect(session.sessionId).toBe('rs_7f3a91c4b8e24d5a');
    expect(session.viewerTicket).toBe(TICKET);
    expect(session.capability?.input).toBe('ROOT');
  });

  it('passes viewOnly through', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody({ viewOnly: true }) });

    const session = await startRemoteSession(12, true);

    expect((mockPost.mock.calls[0] as [string, unknown])[1]).toEqual({ viewOnly: true });
    expect(session.viewOnly).toBe(true);
  });

  it('suppresses the global toast AND modal, because the page renders the message itself', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody() });

    await startRemoteSession(12);

    const config = (mockPost.mock.calls[0] as [string, unknown, Record<string, unknown>])[2];
    expect(config._suppressErrorToast).toBe(true);
    expect(config._suppressErrorModal).toBe(true);
  });

  it('reads deliveredVia HEARTBEAT verbatim — an offline device is not an error', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody({ deliveredVia: 'HEARTBEAT' }) });

    await expect(startRemoteSession(12)).resolves.toMatchObject({ deliveredVia: 'HEARTBEAT' });
  });

  it('rejects a response with no ticket rather than returning a session that cannot pair', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody({ viewerTicket: undefined }) });

    await expect(startRemoteSession(12)).rejects.toThrow(/viewerTicket/);
  });

  it('rejects an unknown status rather than guessing at the lifecycle', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody({ status: 'REBOOTING' }) });

    await expect(startRemoteSession(12)).rejects.toThrow('status');
  });

  it('treats a malformed capability block as unknown instead of failing the session', async () => {
    mockPost.mockResolvedValueOnce({ data: sessionBody({ capability: { input: 'ROOT' } }) });

    await expect(startRemoteSession(12)).resolves.toMatchObject({ capability: null });
  });
});

describe('stopRemoteSession', () => {
  it('DELETEs the session under the device', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    await stopRemoteSession(12, 'rs_7f3a91c4b8e24d5a');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect((mockDelete.mock.calls[0] as [string])[0]).toBe(
      '/api/devices/12/remote/rs_7f3a91c4b8e24d5a',
    );
  });

  it('encodes the session id', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    await stopRemoteSession(12, 'rs_a/b');

    expect((mockDelete.mock.calls[0] as [string])[0]).toBe('/api/devices/12/remote/rs_a%2Fb');
  });
});

describe('getRemoteSession', () => {
  it('GETs the live session and strips the ticket', async () => {
    mockGet.mockResolvedValueOnce({ data: sessionBody({ status: 'ACTIVE' }) });

    const view = await getRemoteSession(12);

    expect((mockGet.mock.calls[0] as [string])[0]).toBe('/api/devices/12/remote');
    expect(view?.status).toBe('ACTIVE');
    // Structural, not incidental: the key must not survive the parse even
    // though the (hypothetical) body carried one.
    expect(view).not.toHaveProperty('viewerTicket');
    expect(JSON.stringify(view)).not.toContain(TICKET);
  });

  it('maps 404 to null — no live session is a normal state, not an error', async () => {
    mockGet.mockRejectedValueOnce(axiosError(404));

    await expect(getRemoteSession(12)).resolves.toBeNull();
  });

  it('propagates any other failure', async () => {
    mockGet.mockRejectedValueOnce(axiosError(403));

    await expect(getRemoteSession(12)).rejects.toBeDefined();
  });
});

describe('ticket hygiene', () => {
  it('never writes the viewer ticket to localStorage or sessionStorage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    mockPost.mockResolvedValueOnce({ data: sessionBody() });
    mockGet.mockResolvedValueOnce({ data: sessionBody() });

    await startRemoteSession(12);
    await getRemoteSession(12);

    expect(local).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('viewerTicket')).toBeNull();
    expect(window.sessionStorage.getItem('viewerTicket')).toBeNull();
  });
});

describe('stopRemoteSessionBeacon', () => {
  it('sends a keepalive DELETE carrying the bearer token', () => {
    // navigator.sendBeacon cannot do either of these — see the docstring.
    tokenStore.set('jwt-abc');
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);

    stopRemoteSessionBeacon(12, 'rs_1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/devices/12/remote/rs_1');
    expect(init.method).toBe('DELETE');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
  });

  it('does nothing without a token rather than firing an unauthenticated call', () => {
    tokenStore.set(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    stopRemoteSessionBeacon(12, 'rs_1');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getDeviceConnection', () => {
  it('reads live socket liveness', async () => {
    mockGet.mockResolvedValueOnce({ data: { deviceId: 12, connected: true } });

    await expect(getDeviceConnection(12)).resolves.toEqual({ connected: true });
    expect((mockGet.mock.calls[0] as [string])[0]).toBe('/api/devices/12/connection');
  });

  it('defaults to not-connected on a malformed body', async () => {
    mockGet.mockResolvedValueOnce({ data: null });

    await expect(getDeviceConnection(12)).resolves.toEqual({ connected: false });
  });
});

describe('isTerminalStatus', () => {
  it('separates the states that can still become ACTIVE from those that cannot', () => {
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('ACTIVE')).toBe(false);
    expect(isTerminalStatus('ENDED')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('EXPIRED')).toBe(true);
  });
});
