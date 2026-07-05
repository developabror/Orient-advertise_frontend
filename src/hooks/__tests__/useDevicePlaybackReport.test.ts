import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@api/resources/playbackReport', () => ({ getDevicePlaybackReport: vi.fn() }));

import { getDevicePlaybackReport, type PlaybackReportResponse } from '@api/resources/playbackReport';
import {
  useDevicePlaybackReport,
  type DevicePlaybackReportFilter,
} from '../useDevicePlaybackReport';

const mockReport = vi.mocked(getDevicePlaybackReport);

const response = (over: Partial<PlaybackReportResponse> = {}): PlaybackReportResponse => ({
  scope: { type: 'DEVICE', id: 42, name: 'Lobby' },
  from: '',
  to: '',
  totalPlayCount: 5,
  totalDurationSeconds: 100,
  durationComplete: true,
  perContent: [],
  ...over,
});

const axiosError = (status: number): unknown =>
  Object.assign(new Error(`Request failed with status code ${String(status)}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });

const filter: DevicePlaybackReportFilter = {
  deviceId: 42,
  dateFrom: '2026-06-17',
  dateTo: '2026-06-24',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDevicePlaybackReport', () => {
  it('is inert when the filter is null (no request)', () => {
    const { result } = renderHook(() => useDevicePlaybackReport(null));
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('loads the report for a valid filter and toggles isLoading', async () => {
    mockReport.mockResolvedValueOnce(response());
    const { result } = renderHook(() => useDevicePlaybackReport(filter));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(result.current.isLoading).toBe(false);
    expect(mockReport).toHaveBeenCalledWith(
      42,
      { from: '2026-06-17', to: '2026-06-24' },
      expect.any(AbortSignal),
    );
  });

  it('sets notFound on a 404 (data null, error null)', async () => {
    mockReport.mockRejectedValueOnce(axiosError(404));
    const { result } = renderHook(() => useDevicePlaybackReport(filter));

    await waitFor(() => {
      expect(result.current.notFound).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('sets error (not notFound) on other failures', async () => {
    mockReport.mockRejectedValueOnce(axiosError(500));
    const { result } = renderHook(() => useDevicePlaybackReport(filter));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.notFound).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('drops a stale response that resolves after the filter changed', async () => {
    let resolveFirst!: (v: PlaybackReportResponse) => void;
    const firstPending = new Promise<PlaybackReportResponse>((res) => {
      resolveFirst = res;
    });
    mockReport.mockReturnValueOnce(firstPending); // first request hangs
    mockReport.mockResolvedValueOnce(response({ totalPlayCount: 999 })); // second resolves now

    const { result, rerender } = renderHook(
      ({ f }: { f: DevicePlaybackReportFilter }) => useDevicePlaybackReport(f),
      { initialProps: { f: filter } },
    );

    // Changing the filter cancels the first request and fires the second.
    rerender({ f: { ...filter, dateTo: '2026-06-25' } });
    await waitFor(() => {
      expect(result.current.data?.totalPlayCount).toBe(999);
    });
    expect(mockReport).toHaveBeenCalledTimes(2);

    // The first (now-stale) request resolves late — the cancelled/aborted guard
    // must drop it so it can't clobber the second response. Remove that guard
    // and this assertion flips to 5.
    await act(async () => {
      resolveFirst(response({ totalPlayCount: 5 }));
      await Promise.resolve();
    });
    expect(result.current.data?.totalPlayCount).toBe(999);
  });

  it('does not update state when an in-flight request resolves after unmount', async () => {
    let resolveIt!: (v: PlaybackReportResponse) => void;
    const pending = new Promise<PlaybackReportResponse>((res) => {
      resolveIt = res;
    });
    mockReport.mockReturnValueOnce(pending);

    const { unmount } = renderHook(() => useDevicePlaybackReport(filter));
    unmount();

    // Cleanup set `cancelled` + aborted the controller; resolving now must be a
    // no-op (no setState on an unmounted hook, no surfaced rejection).
    await act(async () => {
      resolveIt(response());
      await Promise.resolve();
    });
  });
});
