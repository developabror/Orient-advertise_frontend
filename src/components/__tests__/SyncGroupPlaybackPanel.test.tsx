// SyncGroupPlaybackPanel — component behaviour. Real i18n (setup.ts loads the
// shared i18next instance), mocked @api + notify + errorDialog. Pins the
// group-jump contract:
//   - a coherent group lists its shared order with clickable rows;
//   - a row click requires confirmation, then jumps the whole group by index;
//   - success surfaces the "switch at HH:MM:SS" banner (the jump is scheduled,
//     not instantaneous);
//   - an incoherent group / read-only viewer renders no jump controls;
//   - a load failure surfaces the backend message inline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@api/errorDialog', () => ({ markErrorHandled: vi.fn() }));
vi.mock('@api', () => ({
  getSyncGroupPlayback: vi.fn(),
  jumpSyncGroupToIndex: vi.fn(),
  extractApiMessage: (err: unknown): string | null => {
    const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof m === 'string' ? m : null;
  },
}));

import { getSyncGroupPlayback, jumpSyncGroupToIndex } from '@api';
import { notify } from '@api/notify';
import { SyncGroupPlaybackPanel } from '../SyncGroupPlaybackPanel';

const mockGetPlayback = getSyncGroupPlayback as unknown as ReturnType<typeof vi.fn>;
const mockJump = jumpSyncGroupToIndex as unknown as ReturnType<typeof vi.fn>;
const mockNotifySuccess = notify.success as unknown as ReturnType<typeof vi.fn>;

const coherentView = {
  coherent: true,
  reason: null,
  playlistId: 5,
  playlistName: 'Lobby loop',
  loopDurationMs: 90000,
  items: [
    { index: 0, fileId: 100, title: 'Intro clip', durationSeconds: 30 },
    { index: 1, fileId: 101, title: 'Promo clip', durationSeconds: 75 },
  ],
  activeJump: null,
  memberCount: 4,
};

beforeEach(() => {
  mockGetPlayback.mockResolvedValue(coherentView);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SyncGroupPlaybackPanel', () => {
  it('lists the shared order for a coherent group', async () => {
    render(<SyncGroupPlaybackPanel groupId={7} canControl />);

    expect(await screen.findByText('Intro clip')).toBeInTheDocument();
    expect(screen.getByText('Promo clip')).toBeInTheDocument();
    // Durations formatted m:ss.
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByText('1:15')).toBeInTheDocument();
    expect(mockGetPlayback).toHaveBeenCalledWith(7);
  });

  it('confirms, then jumps the whole group to the picked index and banners the switch time', async () => {
    mockJump.mockResolvedValue({
      syncGroupId: 7,
      index: 1,
      activateAt: '2026-07-11T10:30:45Z',
      memberCount: 4,
    });

    render(<SyncGroupPlaybackPanel groupId={7} canControl />);

    // Click the row — jump must NOT fire yet (confirmation required).
    fireEvent.click(await screen.findByText('Promo clip'));
    expect(mockJump).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: 'Jump all screens?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jump all screens' }));

    await waitFor(() => {
      expect(mockJump).toHaveBeenCalledWith(7, 1);
    });

    const banner = await screen.findByText(/all screens switch at/i);
    expect(banner).toHaveTextContent('Promo clip');
    expect(banner.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);

    // The queued row is exposed to assistive tech on the operator (button) path,
    // not only the read-only path.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Promo clip/i })).toHaveAttribute(
        'aria-current',
        'true',
      );
    });
    expect(screen.getByRole('button', { name: /Intro clip/i })).not.toHaveAttribute('aria-current');
  });

  it('renders the not-coherent notice with no clickable rows', async () => {
    mockGetPlayback.mockResolvedValue({
      ...coherentView,
      coherent: false,
      reason: 'Members resolve different playlists',
      items: [],
    });

    render(<SyncGroupPlaybackPanel groupId={7} canControl />);

    expect(await screen.findByText(/cannot jump as a unit/i)).toHaveTextContent(
      'Members resolve different playlists',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders read-only for a viewer (canControl=false) — list visible, no jump buttons', async () => {
    render(<SyncGroupPlaybackPanel groupId={7} canControl={false} />);

    expect(await screen.findByText('Intro clip')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('surfaces the backend message inline when the playback view fails to load', async () => {
    mockGetPlayback.mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: { message: 'Playback service is down' } },
    });

    render(<SyncGroupPlaybackPanel groupId={7} canControl />);

    expect(await screen.findByText('Playback service is down')).toBeInTheDocument();
  });

  it('shows a pre-existing scheduled jump as a queued banner on load', async () => {
    mockGetPlayback.mockResolvedValue({
      ...coherentView,
      activeJump: { index: 0, activateAt: '2026-07-11T08:15:00Z' },
    });

    render(<SyncGroupPlaybackPanel groupId={7} canControl />);

    const banner = await screen.findByText(/all screens switch at/i);
    expect(banner).toHaveTextContent('Intro clip');
  });
});
