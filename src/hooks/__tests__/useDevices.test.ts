// Tests for useDevices — the device-list query-param mapping and row sanitiser,
// focused on the new tri-state playlist filter and the activePlaylist projection.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// vi.hoisted so the spy exists when the hoisted vi.mock factory builds http.get.
const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));
vi.mock('@api/http', () => ({ http: { get: getSpy } }));

import { useDevices, type DevicesQuery } from '../useDevices';

const baseQuery = (over: Partial<DevicesQuery> = {}): DevicesQuery => ({
  page: 1,
  size: 20,
  region: '',
  facility: '',
  status: '',
  facilityId: '',
  deviceGroupId: '',
  playlistState: '',
  ...over,
});

const lastParams = (): Record<string, unknown> =>
  (getSpy.mock.calls[0]![1] as { params: Record<string, unknown> }).params;

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockResolvedValue({ data: { content: [] } });
});

describe('useDevices — playlistState → hasActivePlaylist param', () => {
  it("maps 'assigned' → hasActivePlaylist: true", async () => {
    renderHook(() => useDevices(baseQuery({ playlistState: 'assigned' })));
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(lastParams().hasActivePlaylist).toBe(true);
  });

  it("maps 'unassigned' → hasActivePlaylist: false", async () => {
    renderHook(() => useDevices(baseQuery({ playlistState: 'unassigned' })));
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(lastParams().hasActivePlaylist).toBe(false);
  });

  it("omits hasActivePlaylist entirely for '' (all devices)", async () => {
    renderHook(() => useDevices(baseQuery({ playlistState: '' })));
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect('hasActivePlaylist' in lastParams()).toBe(false);
  });
});

describe('useDevices — sanitizeDevice activePlaylist mapping', () => {
  it('derives hasActivePlaylist from id presence and maps the name (empty name still counts)', async () => {
    getSpy.mockResolvedValue({
      data: {
        content: [
          { id: 1, computedStatus: 'ONLINE', activePlaylistId: 15, activePlaylistName: 'Summer Promo' },
          { id: 2, computedStatus: 'ONLINE', activePlaylistId: null, activePlaylistName: null },
          // valid id but a defensive empty-string name — still "has playlist".
          { id: 3, computedStatus: 'ONLINE', activePlaylistId: 7, activePlaylistName: '' },
          // name present but no id → presence is keyed off the id, so false.
          { id: 4, computedStatus: 'ONLINE', activePlaylistId: null, activePlaylistName: 'Ghost' },
        ],
      },
    });

    const { result } = renderHook(() => useDevices(baseQuery()));
    await waitFor(() => expect(result.current.devices).toHaveLength(4));

    const byId = (id: string) => result.current.devices.find((d) => d.id === id)!;

    expect(byId('1').hasActivePlaylist).toBe(true);
    expect(byId('1').activePlaylistName).toBe('Summer Promo');

    expect(byId('2').hasActivePlaylist).toBe(false);
    expect(byId('2').activePlaylistName).toBeNull();

    expect(byId('3').hasActivePlaylist).toBe(true);
    expect(byId('3').activePlaylistName).toBe('');

    expect(byId('4').hasActivePlaylist).toBe(false);
    expect(byId('4').activePlaylistName).toBe('Ghost');
  });

  it('maps the device name from the wire and falls back to the id when absent/blank', async () => {
    getSpy.mockResolvedValue({
      data: {
        content: [
          { id: 1, name: 'Lobby Screen', computedStatus: 'ONLINE' },
          { id: 2, name: '', computedStatus: 'ONLINE' }, // blank name → fall back to id
          { id: 3, computedStatus: 'ONLINE' }, // no name on the wire → fall back to id
        ],
      },
    });

    const { result } = renderHook(() => useDevices(baseQuery()));
    await waitFor(() => expect(result.current.devices).toHaveLength(3));

    const byId = (id: string) => result.current.devices.find((d) => d.id === id)!;
    expect(byId('1').name).toBe('Lobby Screen');
    expect(byId('2').name).toBe('2');
    expect(byId('3').name).toBe('3');
  });

  it('degrades gracefully when both fields are absent (current backend) → no playlist, no crash', async () => {
    // The backend half ships the fields separately; until then rows omit them.
    getSpy.mockResolvedValue({ data: { content: [{ id: 1, computedStatus: 'ONLINE' }] } });

    const { result } = renderHook(() => useDevices(baseQuery()));
    await waitFor(() => expect(result.current.devices).toHaveLength(1));

    expect(result.current.devices[0]!.hasActivePlaylist).toBe(false);
    expect(result.current.devices[0]!.activePlaylistName).toBeNull();
  });
});
