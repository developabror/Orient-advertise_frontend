// Tests for useIncidentSummary's report-job handling. GET /api/reports/events
// can answer synchronously (200 rollup) or asynchronously (202 PENDING + jobId).
// On the async path the rollup fields are absent, so before the fix the hook
// rendered an EMPTY table (RS-3). It must now poll the job to completion.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/http', () => ({ http: { get: vi.fn() } }));

import { http } from '@api/http';
import { useIncidentSummary } from '../useIncidentSummary';

const FILTER = { dateFrom: '2026-05-01', dateTo: '2026-05-08', region: '', facility: '' };

const ROLLUP = {
  topAffectedDevices: [{ deviceId: 1, deviceName: 'Lobby', eventCount: 5 }],
  incidentCount: 5,
  avgResolutionSeconds: 120,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIncidentSummary', () => {
  it('renders rows directly on a synchronous (200) rollup', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: ROLLUP } as never);

    const { result } = renderHook(() => useIncidentSummary(FILTER));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('polls a PENDING (202) job to completion instead of rendering an empty table (RS-3)', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get).mockImplementation((url: string) =>
      url.includes('/jobs/')
        ? Promise.resolve({ data: { jobId: 'job-1', status: 'COMPLETED', result: ROLLUP } } as never)
        : Promise.resolve({ data: { status: 'PENDING', jobId: 'job-1' } } as never),
    );

    const { result } = renderHook(() => useIncidentSummary(FILTER));

    // First GET resolves to PENDING → still "generating", no rows yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.rows).toHaveLength(0);

    // After the poll delay the job completes and rows populate.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('treats a COMPLETED job with a null result as "no data" (empty table, no error), matching the sync path', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get).mockImplementation((url: string) =>
      url.includes('/jobs/')
        ? Promise.resolve({ data: { jobId: 'job-1', status: 'COMPLETED', result: null } } as never)
        : Promise.resolve({ data: { status: 'PENDING', jobId: 'job-1' } } as never),
    );

    const { result } = renderHook(() => useIncidentSummary(FILTER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    // Completed-but-empty must NOT surface the "still generating" timeout error.
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces an error when the report job FAILS', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get).mockImplementation((url: string) =>
      url.includes('/jobs/')
        ? Promise.resolve({ data: { jobId: 'job-1', status: 'FAILED', error: 'boom' } } as never)
        : Promise.resolve({ data: { status: 'PENDING', jobId: 'job-1' } } as never),
    );

    const { result } = renderHook(() => useIncidentSummary(FILTER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });

    expect(result.current.error).toMatch(/failed/i);
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });
});
