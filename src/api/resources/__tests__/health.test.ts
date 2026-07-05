// Vitest unit tests for src/api/resources/health.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  getHealth,
  type HealthResponse,
  type HealthStatus,
} from '../health';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

const fixture = (over: Partial<HealthResponse> = {}): HealthResponse => ({
  overallStatus: 'UP',
  components: [
    { name: 'database', status: 'UP', timestamp: '2026-05-08T10:00:00Z' },
    { name: 'minio', status: 'UP', timestamp: '2026-05-08T10:00:00Z' },
    { name: 'websocket-broker', status: 'UP', timestamp: '2026-05-08T10:00:00Z' },
  ],
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
});

describe('getHealth', () => {
  it('GETs /api/health and returns the response verbatim', async () => {
    const response = fixture();
    mockGet.mockResolvedValueOnce({ data: response });

    const result = await getHealth();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/health');
    // Single positional arg — no per-request config (no params,
    // headers, withCredentials override leaking out of the resource).
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    // Verbatim reference — the JSDoc explicitly promises no defaulting.
    expect(result).toBe(response);
  });

  it('passes every overallStatus value through unchanged', async () => {
    const statuses: readonly HealthStatus[] = ['UP', 'DEGRADED', 'DOWN'];
    for (const overallStatus of statuses) {
      mockGet.mockResolvedValueOnce({ data: fixture({ overallStatus }) });
      const result = await getHealth();
      expect(result.overallStatus).toBe(overallStatus);
    }
  });

  it('preserves per-component status + timestamp on a DEGRADED rollup', async () => {
    const response = fixture({
      overallStatus: 'DEGRADED',
      components: [
        { name: 'database', status: 'UP', timestamp: '2026-05-08T10:00:00Z' },
        { name: 'minio', status: 'DEGRADED', timestamp: '2026-05-08T10:00:30Z' },
      ],
    });
    mockGet.mockResolvedValueOnce({ data: response });

    const result = await getHealth();

    expect(result.overallStatus).toBe('DEGRADED');
    expect(result.components).toHaveLength(2);
    expect(result.components[1]!.name).toBe('minio');
    expect(result.components[1]!.status).toBe('DEGRADED');
    // The timestamp on the wire is the spec field (NOT `details`) —
    // this assertion locks down the divergence-from-stale-doc note in
    // the resource's file header.
    expect(result.components[1]!.timestamp).toBe('2026-05-08T10:00:30Z');
  });

  it('passes through richer per-component statuses (e.g. "INITIALISING") as plain strings', async () => {
    // Per-component status is a plain string, not the top-level union,
    // so unfamiliar states pass through untouched.
    const response = fixture({
      overallStatus: 'DEGRADED',
      components: [
        { name: 'cache', status: 'INITIALISING', timestamp: '2026-05-08T10:00:00Z' },
      ],
    });
    mockGet.mockResolvedValueOnce({ data: response });

    const result = await getHealth();
    expect(result.components[0]!.status).toBe('INITIALISING');
  });

  it('returns an empty components array verbatim (e.g. before any health checks have run)', async () => {
    const response = fixture({ overallStatus: 'UP', components: [] });
    mockGet.mockResolvedValueOnce({ data: response });

    const result = await getHealth();
    expect(result.components).toEqual([]);
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);

    await expect(getHealth()).rejects.toBe(err);
  });
});
