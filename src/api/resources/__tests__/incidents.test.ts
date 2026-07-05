// Vitest unit tests for src/api/resources/incidents.ts.
//
// Run with `vitest run src/api/resources/__tests__/incidents.test.ts`
// once the project's test framework is installed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the http and criticalAlerts modules with controllable mocks.
// Mocking http transitively avoids loading env.ts at module-init.
vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../criticalAlerts', () => ({
  criticalAlerts: {
    dismiss: vi.fn(),
  },
}));

import { criticalAlerts } from '../../criticalAlerts';
import { http } from '../../http';
import {
  acknowledgeIncident,
  listOpenIncidents,
  resolveIncident,
  type IncidentDto,
} from '../incidents';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDismiss = criticalAlerts.dismiss as unknown as ReturnType<typeof vi.fn>;

const fixture = (over: Partial<IncidentDto> = {}): IncidentDto => ({
  id: 42,
  deviceId: 7,
  eventType: 'DEVICE_OFFLINE',
  status: 'OPEN',
  priority: 'CRITICAL',
  description: 'Device 7 went offline',
  occurrenceCount: 1,
  openedAt: '2026-05-08T10:00:00Z',
  updatedAt: '2026-05-08T10:00:00Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
  ...over,
});

// Minimal axios-error shape with a 409 response. axios.isAxiosError() only
// checks for the `isAxiosError === true` brand on a non-null object — no
// real axios involvement needed.
const make409 = (): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: {
    status: 409,
    statusText: 'Conflict',
    data: {
      status: 409,
      error: 'Conflict',
      message: 'Incident already acknowledged',
      correlationId: 'corr-409',
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDismiss.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDismiss.mockReset();
});

describe('listOpenIncidents', () => {
  it('GETs /api/incidents/open without query params when priority is omitted', async () => {
    const arr = [fixture()];
    mockGet.mockResolvedValueOnce({ data: arr });

    const result = await listOpenIncidents();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/incidents/open', undefined);
    // Verbatim pass-through — same array reference.
    expect(result).toBe(arr);
  });

  it('GETs /api/incidents/open with ?priority=CRITICAL when filtered', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    await listOpenIncidents('CRITICAL');

    expect(mockGet).toHaveBeenCalledWith('/api/incidents/open', {
      params: { priority: 'CRITICAL' },
    });
  });

  it('passes every priority enum value through verbatim', async () => {
    const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
    for (const priority of priorities) {
      mockGet.mockResolvedValueOnce({ data: [] });
      await listOpenIncidents(priority);
      expect(mockGet).toHaveBeenLastCalledWith('/api/incidents/open', {
        params: { priority },
      });
    }
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);
    await expect(listOpenIncidents()).rejects.toBe(err);
  });
});

describe('acknowledgeIncident', () => {
  it('POSTs to /api/incidents/{id}/acknowledge and returns the updated DTO', async () => {
    const acked = fixture({
      status: 'ACKNOWLEDGED',
      acknowledgedAt: '2026-05-08T10:01:00Z',
      acknowledgedBy: 'operator@orient',
    });
    mockPost.mockResolvedValueOnce({ data: acked });

    const result = await acknowledgeIncident(42);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/incidents/42/acknowledge');
    // Single positional arg = no body, no per-request config (no
    // Authorization-header overrides leaking out of the resource).
    expect(mockPost.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(acked);
  });

  it('lets a 409 axios error bubble unchanged for the caller to narrow on', async () => {
    const err = make409();
    mockPost.mockRejectedValueOnce(err);

    // Same reference, not a wrapped/replaced error — the caller's
    // narrowing pattern from the JSDoc relies on this contract.
    await expect(acknowledgeIncident(42)).rejects.toBe(err);
    const surface = err as { response?: { status?: number } };
    expect(surface.response?.status).toBe(409);
  });

  it('does not double-call http.post on failure', async () => {
    mockPost.mockRejectedValueOnce(make409());
    await expect(acknowledgeIncident(42)).rejects.toBeDefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('resolveIncident', () => {
  it('POSTs to /api/incidents/{id}/resolve, dismisses the alert, returns the DTO', async () => {
    const resolved = fixture({
      status: 'RESOLVED',
      resolvedAt: '2026-05-08T10:05:00Z',
      resolvedBy: 'operator@orient',
    });
    mockPost.mockResolvedValueOnce({ data: resolved });

    const result = await resolveIncident(42);

    expect(mockPost).toHaveBeenCalledWith('/api/incidents/42/resolve');
    expect(result).toBe(resolved);
    // Stringified id — must match the format used when the alert was added
    // by the WS handler (`incidentId: string`).
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledWith('42');
  });

  it('lets a 409 axios error bubble unchanged and does NOT dismiss the alert', async () => {
    const err = make409();
    mockPost.mockRejectedValueOnce(err);

    await expect(resolveIncident(42)).rejects.toBe(err);
    // Critical: a failed resolve must NOT dismiss the alert. The
    // operator's bar should keep showing the unresolved incident so the
    // race-loser realises another operator (or earlier action) already
    // resolved it, or the request actually failed.
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('does not call dismiss when http.post throws a non-axios error', async () => {
    const err = new Error('boom');
    mockPost.mockRejectedValueOnce(err);

    await expect(resolveIncident(42)).rejects.toBe(err);
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});
