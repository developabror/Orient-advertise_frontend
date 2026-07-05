// Vitest unit tests for src/api/resources/deviceDiagnostics.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  getDiagnostics,
  issueDeviceAction,
  playlistControl,
  type DeviceActionType,
  type DeviceDiagnostics,
  type RemoteActionResponse,
} from '../deviceDiagnostics';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;

const make409 = (message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: {
    status: 409,
    statusText: 'Conflict',
    data: {
      status: 409,
      error: 'Conflict',
      message,
      correlationId: 'corr-409',
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const fixtureDiagnostics = (over: Partial<DeviceDiagnostics> = {}): DeviceDiagnostics => ({
  deviceId: 7,
  serialNumber: 'SN-7',
  name: 'Atrium screen',
  status: 'ONLINE',
  lastHeartbeatAt: '2026-05-08T10:00:00Z',
  currentContentVersion: 'v3.1.0',
  lastKnownIp: '10.0.0.7',
  pendingActionCount: 0,
  recentEvents: [],
  recentActions: [],
  generatedAt: '2026-05-08T10:00:30Z',
  ...over,
});

const fixtureAction = (over: Partial<RemoteActionResponse> = {}): RemoteActionResponse => ({
  actionId: 100,
  deviceId: 7,
  actionType: 'REBOOT',
  status: 'PENDING',
  payload: null,
  issuedAt: '2026-05-08T10:00:00Z',
  expiresAt: '2026-05-08T10:05:00Z',
  issuedBy: 'admin',
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('getDiagnostics', () => {
  it('GETs /api/devices/{id}/diagnostics and returns the DTO verbatim', async () => {
    const fixture = fixtureDiagnostics();
    mockGet.mockResolvedValueOnce({ data: fixture });

    const result = await getDiagnostics(7);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/devices/7/diagnostics');
    // Single positional arg: no query params, no per-request config.
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(fixture);
  });

  it('returns null-valued snapshot fields verbatim (no defaulting)', async () => {
    const fixture = fixtureDiagnostics({
      lastHeartbeatAt: null,
      lastKnownIp: null,
      currentContentVersion: null,
      pendingActionCount: 5,
    });
    mockGet.mockResolvedValueOnce({ data: fixture });

    const result = await getDiagnostics(7);
    expect(result.lastHeartbeatAt).toBeNull();
    expect(result.lastKnownIp).toBeNull();
    expect(result.currentContentVersion).toBeNull();
    expect(result.pendingActionCount).toBe(5);
  });

  it('propagates non-2xx errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);
    await expect(getDiagnostics(7)).rejects.toBe(err);
  });
});

describe('issueDeviceAction — body assembly', () => {
  it('POSTs to /api/devices/{id}/actions with a single positional body arg', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await issueDeviceAction(7, { type: 'REBOOT' });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/actions', { type: 'REBOOT' });
    // Two positional args (url, body) — NO third arg, so no per-request
    // headers/params override leaks out of the resource.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
  });

  it('forwards a volume value for VOLUME_SET', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction({ actionType: 'VOLUME_SET' }) });

    await issueDeviceAction(7, { type: 'VOLUME_SET', volume: 50 });

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/actions', {
      type: 'VOLUME_SET',
      volume: 50,
    });
  });

  it('does not synthesize a volume key when caller omits it', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await issueDeviceAction(7, { type: 'SYNC_CONTENT' });

    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ type: 'SYNC_CONTENT' });
    // The wire body must NOT include a `volume: undefined` entry — that
    // would still serialise to JSON's default omission, but it would
    // also confuse Bean validation in older Spring versions and trip
    // the service-layer guard.
    expect('volume' in body).toBe(false);
  });

  it('passes every action enum value through verbatim', async () => {
    const types: readonly DeviceActionType[] = [
      'REBOOT',
      'SYNC_CONTENT',
      'VOLUME_SET',
      'PLAYBACK_PAUSE',
      'PLAYBACK_RESUME',
      'GET_DIAGNOSTICS',
    ];
    for (const type of types) {
      mockPost.mockResolvedValueOnce({ data: fixtureAction({ actionType: type }) });
      await issueDeviceAction(7, { type });
      expect(mockPost).toHaveBeenLastCalledWith('/api/devices/7/actions', { type });
    }
    expect(mockPost).toHaveBeenCalledTimes(types.length);
  });

  it('returns the RemoteActionResponse verbatim', async () => {
    const action = fixtureAction({ actionId: 999 });
    mockPost.mockResolvedValueOnce({ data: action });

    const result = await issueDeviceAction(7, { type: 'REBOOT' });
    expect(result).toBe(action);
  });
});

describe('issueDeviceAction — 409 contracts', () => {
  it('lets a 409 "duplicate pending" axios error bubble unchanged', async () => {
    const err = make409('Duplicate pending action of type REBOOT');
    mockPost.mockRejectedValueOnce(err);

    await expect(issueDeviceAction(7, { type: 'REBOOT' })).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    // The narrowing surface from the JSDoc:
    expect(surface.response?.data?.message).toContain('Duplicate pending');
  });

  it('lets a 409 "pending queue full" axios error bubble unchanged', async () => {
    const err = make409('Pending action queue is full (max=10)');
    mockPost.mockRejectedValueOnce(err);

    await expect(issueDeviceAction(7, { type: 'SYNC_CONTENT' })).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toContain('queue is full');
  });

  it('does not double-call http.post on failure', async () => {
    mockPost.mockRejectedValueOnce(make409('Duplicate pending action'));
    await expect(issueDeviceAction(7, { type: 'REBOOT' })).rejects.toBeDefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('playlistControl — body assembly', () => {
  it('POSTs PREV without a position field', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await playlistControl(7, { action: 'PREV' });

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playlist/control', {
      action: 'PREV',
    });
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect('position' in body).toBe(false);
  });

  it('POSTs NEXT without a position field', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await playlistControl(7, { action: 'NEXT' });

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playlist/control', {
      action: 'NEXT',
    });
  });

  it('POSTs JUMP with the supplied position', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await playlistControl(7, { action: 'JUMP', position: 3 });

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playlist/control', {
      action: 'JUMP',
      position: 3,
    });
  });

  it('POSTs JUMP with position 0 (start of playlist) without dropping the field', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAction() });

    await playlistControl(7, { action: 'JUMP', position: 0 });

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playlist/control', {
      action: 'JUMP',
      position: 0,
    });
  });

  it('lets a 409 axios error bubble unchanged for retry decisioning', async () => {
    const err = make409('Duplicate pending action');
    mockPost.mockRejectedValueOnce(err);

    await expect(playlistControl(7, { action: 'NEXT' })).rejects.toBe(err);
    const surface = err as { response?: { status?: number } };
    expect(surface.response?.status).toBe(409);
  });
});
