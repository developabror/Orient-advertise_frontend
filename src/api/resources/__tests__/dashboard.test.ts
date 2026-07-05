// Vitest unit test for src/api/resources/dashboard.ts.
//
// Mocks the http module (the project's axios instance) so the test never
// hits the network. Asserts the resource sends GET to the spec'd path and
// returns the response body verbatim — the resource layer must not reshape
// or default the response.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the entire http module with a controllable mock. The real module
// would otherwise transitively import env.ts (which requires VITE_API_URL
// at module load) — mocking http means that import never runs.
vi.mock('../../http', () => ({
  http: { get: vi.fn() },
}));

import { http } from '../../http';
import { getDashboardSummary, type DashboardSummary } from '../dashboard';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

describe('getDashboardSummary', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  afterEach(() => {
    mockGet.mockReset();
  });

  it('calls GET /api/dashboard/summary and returns the response body verbatim', async () => {
    const fixture: DashboardSummary = {
      totalDevices: 42,
      onlineCount: 30,
      offlineCount: 8,
      noContentCount: 4,
      openIncidents: { critical: 1, warning: 3 },
      regionSummary: [
        { regionId: 1, regionName: 'Tashkent', onlineCount: 12, totalCount: 15 },
        { regionId: 2, regionName: 'Samarkand', onlineCount: 18, totalCount: 27 },
      ],
    };
    mockGet.mockResolvedValueOnce({ data: fixture });

    const result = await getDashboardSummary();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/dashboard/summary');
    // Verbatim contract: the resource must return the exact reference it
    // received, not a copy or a reshape. `toBe` (not `toEqual`) enforces it.
    expect(result).toBe(fixture);
  });

  it('does not pass an Authorization header or any per-request config', async () => {
    // Auth is handled by the http request interceptor; the resource layer
    // calling http.get with explicit headers/params would (a) duplicate
    // the bearer token, or (b) accidentally clobber it. Lock that down.
    mockGet.mockResolvedValueOnce({ data: {} as DashboardSummary });

    await getDashboardSummary();

    const calls = mockGet.mock.calls;
    expect(calls).toHaveLength(1);
    // Single positional arg = URL only. No second `AxiosRequestConfig`
    // argument, so no headers / params / withCredentials override leaks
    // out of this resource.
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/dashboard/summary');
  });

  it('propagates errors from http.get unchanged', async () => {
    const networkErr = new Error('Network Error');
    mockGet.mockRejectedValueOnce(networkErr);

    await expect(getDashboardSummary()).rejects.toBe(networkErr);
  });
});
