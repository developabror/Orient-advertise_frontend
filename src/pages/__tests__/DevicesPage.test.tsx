// Render-level tests for the Devices page "Active playlist" column + "Playlist"
// filter. The data hook (useDevices), region/role hooks, and the @api barrel are
// mocked so the test pins the wiring: the column renders an Antimetal pill for a
// row with a playlist and a muted dash for one without, and the Playlist <Select>
// drives the `playlistState` URL param (incl. Clear-filters).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type { Device } from '@hooks/useDevices';

const useDevicesMock = vi.fn();
vi.mock('@hooks/useDevices', () => ({ useDevices: (q: unknown) => useDevicesMock(q) }));
vi.mock('@hooks/useRegions', () => ({ useRegions: () => [] }));
vi.mock('@hooks/useRole', () => ({ useRole: () => 'admin' }));
vi.mock('@hooks/useAssignedProjects', () => ({
  useAssignedProjects: () => ({ isOperator: false, projectIds: [], scopeResolved: true }),
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  onToast: vi.fn(() => () => undefined),
}));
vi.mock('@api', () => ({
  listFacilities: vi.fn().mockResolvedValue({ content: [] }),
  listDeviceGroups: vi.fn().mockResolvedValue({ content: [] }),
  setAllDevicesVolume: vi.fn(),
  isErrorResponse: () => false,
}));

import { DevicesPage } from '../DevicesPage';
import { setAllDevicesVolume } from '@api';
import { notify } from '@api/notify';

const mockSetAllVolume = setAllDevicesVolume as unknown as ReturnType<typeof vi.fn>;

const row = (over: Partial<Device> = {}): Device => ({
  id: '1',
  name: 'Lobby Screen',
  facility: 'HQ',
  region: '10',
  status: 'online',
  contentVersion: 'v1',
  lastSeen: '2026-05-08T10:00:00Z',
  groupId: null,
  groupName: null,
  activePlaylistName: null,
  hasActivePlaylist: false,
  ...over,
});

const setDevices = (devices: readonly Device[]): void => {
  useDevicesMock.mockReturnValue({
    devices,
    totalItems: devices.length,
    totalPages: 1,
    isLoading: false,
    isStale: false,
  });
};

// Probe the live URL so we can assert filter changes write the query string.
let lastSearch = '';
const LocationProbe = () => {
  lastSearch = useLocation().search;
  return null;
};

const renderPage = (path = '/devices') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <DevicesPage />
      <LocationProbe />
    </MemoryRouter>,
  );

beforeEach(() => {
  useDevicesMock.mockReset();
  lastSearch = '';
});

describe('DevicesPage — Active playlist column', () => {
  it('renders a non-interactive pill for a row with a playlist and a muted dash for one without', () => {
    setDevices([
      row({ id: '1', hasActivePlaylist: true, activePlaylistName: 'Summer Promo' }),
      row({ id: '2', hasActivePlaylist: false, activePlaylistName: null }),
    ]);
    renderPage();

    const badge = screen.getByText('Summer Promo');
    expect(badge).toHaveClass('oa-badge-pill');
    expect(badge.tagName).toBe('SPAN'); // non-interactive, not a link
    expect(badge).not.toHaveAttribute('href');

    // The "no playlist" row shows the muted dash with the detail-page wording.
    expect(screen.getByTitle('No active playlist')).toBeInTheDocument();
  });

  it('keys the pill on name !== null — an id-present row with an empty name is still a pill, not the dash', () => {
    setDevices([row({ id: '1', hasActivePlaylist: true, activePlaylistName: '' })]);
    renderPage();
    // Per the spec render condition (hasActivePlaylist && activePlaylistName !==
    // null), a defensive empty-but-present name still produces the pill (title
    // "Active playlist"), never the "no playlist" dash.
    expect(screen.getByTitle('Active playlist')).toBeInTheDocument();
    expect(screen.queryByTitle('No active playlist')).not.toBeInTheDocument();
  });
});

describe('DevicesPage — Playlist filter', () => {
  it('writes the playlistState URL param when the Playlist filter changes', () => {
    setDevices([]);
    renderPage();

    const select = screen.getByLabelText('Playlist');
    fireEvent.change(select, { target: { value: 'assigned' } });
    expect(lastSearch).toContain('playlistState=assigned');

    fireEvent.change(screen.getByLabelText('Playlist'), { target: { value: 'unassigned' } });
    expect(lastSearch).toContain('playlistState=unassigned');

    fireEvent.change(screen.getByLabelText('Playlist'), { target: { value: '' } });
    expect(lastSearch).not.toContain('playlistState');
  });

  it('reflects the URL value and includes playlistState in hasFilters / Clear filters', () => {
    setDevices([]);
    renderPage('/devices?playlistState=unassigned');

    expect((screen.getByLabelText('Playlist') as HTMLSelectElement).value).toBe('unassigned');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('DevicesPage — set volume for all', () => {
  it('applies a volume to all devices and toasts the affected count', async () => {
    mockSetAllVolume.mockResolvedValue({ affected: 5 });
    setDevices([]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Set volume for all' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockSetAllVolume).toHaveBeenCalledWith(60);
    });
    expect(notify.success).toHaveBeenCalledWith('Applied to 5 device(s).');
  });
});
