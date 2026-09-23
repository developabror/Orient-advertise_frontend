// Tests for useDeviceActivePlaylist — the device page's playlist source.
//
// The bug it replaces (VG-02): the playlist rode along inside useDevice behind
// `.catch(() => null)`, so the endpoint's permanent 403 looked exactly like "no
// playlist assigned". A failure must now reach the operator as an error state.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api')>();
  return { ...actual, getDeviceActivePlaylist: vi.fn() };
});

import { getDeviceActivePlaylist, type DeviceActivePlaylist } from '@api';
import { useDeviceActivePlaylist } from '../useDeviceActivePlaylist';

const mockFetch = vi.mocked(getDeviceActivePlaylist);

const playlist = (over: Partial<DeviceActivePlaylist> = {}): DeviceActivePlaylist => ({
  playlistId: '100',
  name: 'Mall Loop',
  totalDurationSeconds: 45,
  scheduled: false,
  items: [{ index: 0, position: 0, fileId: '10', title: 'Intro', durationSeconds: 30 }],
  ...over,
});

// The backend's error envelope, as GlobalExceptionHandler serialises it.
const axiosError = (status: number, message?: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed',
  response: {
    status,
    data:
      message === undefined
        ? {}
        : {
            status,
            error: 'Forbidden',
            message,
            correlationId: 'c-1',
            timestamp: '2026-09-23T10:00:00Z',
          },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDeviceActivePlaylist', () => {
  it('loads the playlist for the device', async () => {
    mockFetch.mockResolvedValueOnce(playlist());

    const { result } = renderHook(() => useDeviceActivePlaylist('11'));

    expect(result.current.state).toBe('loading');
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    expect(mockFetch).toHaveBeenCalledWith('11', expect.any(AbortSignal));
    if (result.current.state !== 'ready') throw new Error('expected ready');
    expect(result.current.playlist?.items).toHaveLength(1);
  });

  it('treats a null playlistId as "nothing assigned", not an error', async () => {
    mockFetch.mockResolvedValueOnce(playlist({ playlistId: null, items: [] }));

    const { result } = renderHook(() => useDeviceActivePlaylist('11'));

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('expected ready');
    expect(result.current.playlist).toBeNull();
  });

  it('surfaces a 403 as an error state carrying the backend message', async () => {
    mockFetch.mockRejectedValueOnce(axiosError(403, 'Access denied'));

    const { result } = renderHook(() => useDeviceActivePlaylist('11'));

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    if (result.current.state !== 'error') throw new Error('expected error');
    expect(result.current.message).toBe('Access denied');
  });

  it('reports an error even when the response carries no message', async () => {
    mockFetch.mockRejectedValueOnce(axiosError(500));

    const { result } = renderHook(() => useDeviceActivePlaylist('11'));

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
  });

  it('does not fetch without a device id', async () => {
    const { result } = renderHook(() => useDeviceActivePlaylist(undefined));

    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
