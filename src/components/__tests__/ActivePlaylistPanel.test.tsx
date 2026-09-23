// Tests for the device page's active-playlist panel (VG-02).
//
// What used to be broken and is asserted here: the panel rendered "No playlist
// assigned" for everyone (the load failure was swallowed), the Prev/Next
// buttons could never enable, and rows were keyed and jumped by fileId — so a
// playlist that schedules the same clip twice jumped to the wrong slot.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@api/http', () => ({ http: { post: vi.fn() } }));
vi.mock('@api/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import { http } from '@api/http';
import { notify } from '@api/notify';
import { ActivePlaylistPanel } from '../ActivePlaylistPanel';
import type { DeviceActivePlaylist } from '@api';
import type { DeviceActivePlaylistState } from '@hooks';

const mockPost = vi.mocked(http.post);

const playlist = (over: Partial<DeviceActivePlaylist> = {}): DeviceActivePlaylist => ({
  playlistId: '100',
  name: 'Mall Loop',
  totalDurationSeconds: 45,
  scheduled: false,
  items: [
    { index: 0, position: 0, fileId: '10', title: 'Intro', durationSeconds: 30 },
    { index: 1, position: 2, fileId: '12', title: 'Promo', durationSeconds: 15 },
  ],
  ...over,
});

const ready = (over: Partial<DeviceActivePlaylist> = {}): DeviceActivePlaylistState => ({
  state: 'ready',
  playlist: playlist(over),
});

const renderPanel = (state: DeviceActivePlaylistState, controlsEnabled = true) =>
  render(<ActivePlaylistPanel deviceId="11" state={state} controlsEnabled={controlsEnabled} />);

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} } as never);
});

describe('ActivePlaylistPanel', () => {
  it('lists the items the device holds', () => {
    renderPanel(ready());

    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Promo')).toBeInTheDocument();
  });

  it('renders the load failure instead of claiming nothing is assigned', () => {
    renderPanel({ state: 'error', message: 'Access denied' });

    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText(/No playlist assigned/i)).not.toBeInTheDocument();
  });

  it('says so when the device really has no playlist', () => {
    renderPanel({ state: 'ready', playlist: null });

    expect(screen.getByText(/No playlist assigned/i)).toBeInTheDocument();
  });

  it('enables Prev/Next even though no item is marked as playing', () => {
    renderPanel(ready());

    // The endpoint carries no "currently playing" signal; the old panel keyed
    // these off one and so left them permanently disabled.
    expect(screen.getByRole('button', { name: /Previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Next/i })).toBeEnabled();
  });

  it('disables stepping for a single-item playlist', () => {
    renderPanel(
      ready({ items: [{ index: 0, position: 0, fileId: '10', title: 'Only', durationSeconds: 5 }] }),
    );

    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();
  });

  it('sends the row index as the JUMP position', async () => {
    renderPanel(ready());

    fireEvent.click(screen.getByRole('button', { name: /Jump to Promo/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/devices/11/playlist/control',
        { action: 'JUMP', position: 1 },
        { _suppressErrorToast: true },
      );
    });
  });

  it('jumps to the right slot when one clip is scheduled twice', async () => {
    renderPanel(
      ready({
        items: [
          { index: 0, position: 0, fileId: '10', title: 'Ad', durationSeconds: 10 },
          { index: 1, position: 1, fileId: '10', title: 'Ad', durationSeconds: 10 },
        ],
      }),
    );

    // Same fileId on both rows: keying or searching by it would send 0 for both.
    const rows = screen.getAllByRole('button', { name: /Jump to Ad/i });
    fireEvent.click(rows[1]!);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/devices/11/playlist/control',
        { action: 'JUMP', position: 1 },
        { _suppressErrorToast: true },
      );
    });
  });

  it('hides the controls from a viewer', () => {
    renderPanel(ready(), false);

    expect(screen.queryByRole('button', { name: /Next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Jump to/i })).not.toBeInTheDocument();
  });

  it('offers the sync group instead of per-device transport in schedule mode', () => {
    renderPanel(ready({ scheduled: true }));

    // The device would answer PLAYLIST_CONTROL with FAILED "SCHEDULE_MODE".
    expect(screen.queryByRole('button', { name: /Next/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sync/i)).toBeInTheDocument();
  });

  it('surfaces a failed command', async () => {
    mockPost.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          status: 409,
          error: 'Conflict',
          message: 'A command is already pending',
          correlationId: 'c-1',
          timestamp: '2026-09-23T10:00:00Z',
        },
      },
    });

    renderPanel(ready());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(vi.mocked(notify.error)).toHaveBeenCalledWith('A command is already pending');
    });
  });
});
