// Render-level tests for the playlist media reorder UX in PlaylistsPage.
//
// The pure reorder math is covered in playlistsPage.helpers.test.ts; this file
// pins the *wiring* end-to-end through the real component tree (Drawer, Table,
// Button) with only the `@api` resource layer, `@api/notify`, and `useRole`
// mocked. It asserts the contract from PLAYLIST_REORDER_PROMPT.md:
//
//   1. A mouse DRAG and a keyboard/Move-button reorder each build the SAME
//      orderedItemIds and call reorderPlaylistItems exactly once.
//   2. A no-op reorder (ArrowUp on the first row) never calls the API.
//   3. On a 400 the optimistic order rolls back to the server order and the
//      backend message is surfaced verbatim.
//
// Reorder commits are async (PUT /reorder → GET /playlists/{id} refresh), so
// assertions wait via findBy*/waitFor. The Drawer renders through a portal into
// document.body, which `screen` (rooted at document.body) queries transparently.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// useRole gates every mutation control (drag handle, Move buttons, tabIndex).
// Pin it to 'admin' so canMutate is true and the reorder affordances render.
vi.mock('@hooks/useRole', () => ({
  useRole: () => 'admin',
}));

// Admin is unrestricted: not an operator, scope resolves immediately so the
// page renders without the operator render-gate.
vi.mock('@hooks/useAssignedProjects', () => ({
  useAssignedProjects: () => ({ isOperator: false, projectIds: [], scopeResolved: true }),
}));

// notify is fired on a successful reorder; stub it so the toast bus and its
// Date.now()/dedup state stay out of the test.
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  onToast: vi.fn(() => () => undefined),
}));

// Full manual mock of the @api barrel. Mocking the barrel (not the real module
// graph) also short-circuits http.ts / wsClient / BroadcastChannel side effects
// that the page would otherwise drag in. Only the four functions the test
// exercises carry behaviour; the rest are inert stubs so an accidental call is
// a no-op rather than a "not a function" crash. isErrorResponse mirrors the
// real runtime guard (src/api/resources/_types.ts) so extractMessage surfaces
// the backend message verbatim.
vi.mock('@api', () => ({
  listProjects: vi.fn(),
  listPlaylists: vi.fn(),
  getPlaylist: vi.fn(),
  reorderPlaylistItems: vi.fn(),
  addPlaylistItem: vi.fn(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  listContent: vi.fn(),
  removePlaylistItem: vi.fn(),
  renamePlaylist: vi.fn(),
  setItemDurationOverride: vi.fn(),
  isErrorResponse: (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof value.status === 'number' &&
    typeof value.error === 'string' &&
    typeof value.message === 'string' &&
    typeof value.correlationId === 'string' &&
    typeof value.timestamp === 'string',
}));

import {
  addPlaylistItem,
  getPlaylist,
  listContent,
  listPlaylists,
  listProjects,
  reorderPlaylistItems,
  setItemDurationOverride,
} from '@api';
import { PlaylistsPage } from '../PlaylistsPage';

const SUMMARY = {
  id: 10,
  projectId: 1,
  name: 'Morning Loop',
  itemCount: 3,
  totalDurationSeconds: 90,
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T11:00:00Z',
};

const PAGE = { content: [SUMMARY], totalPages: 1, totalElements: 1, number: 0, size: 20 };

// Empty content page — the picker tests assert the *request params*, not the
// rendered rows, so the body can be empty.
const CONTENT_PAGE = { content: [], totalPages: 0, totalElements: 0, number: 0, size: 50 };

const item = (id, name, position) => ({
  id,
  position,
  contentFileId: id,
  contentFileName: name,
  durationSeconds: 30,
  durationOverride: null,
});

// Fresh detail each call: a successful reorder refetches the server order, and
// returning a new object keeps callers from sharing a mutable reference.
const detail = () => ({
  ...SUMMARY,
  items: [item(101, 'Clip A', 0), item(102, 'Clip B', 1), item(103, 'Clip C', 2)],
});

// Open the drawer for the single seeded playlist and wait until its item list
// (the reorderable listbox) is on screen.
const openDrawer = async () => {
  render(<PlaylistsPage />);
  fireEvent.click(await screen.findByText('Morning Loop'));
  await screen.findByRole('option', { name: /Clip A — position 1 of 3/i });
};

const option = (name) => screen.getByRole('option', { name });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjects).mockResolvedValue([{ id: 1, name: 'Default' }]);
  vi.mocked(listPlaylists).mockResolvedValue(PAGE);
  vi.mocked(getPlaylist).mockImplementation(() => Promise.resolve(detail()));
  vi.mocked(reorderPlaylistItems).mockResolvedValue([]);
  vi.mocked(listContent).mockResolvedValue(CONTENT_PAGE);
});

describe('PlaylistsPage — reorder wiring', () => {
  it('persists a keyboard (ArrowDown) reorder exactly once with the new order', async () => {
    await openDrawer();

    fireEvent.keyDown(option(/Clip A — position 1 of 3/i), { key: 'ArrowDown' });

    await waitFor(() => {
      expect(reorderPlaylistItems).toHaveBeenCalledTimes(1);
    });
    expect(reorderPlaylistItems).toHaveBeenCalledWith(10, [102, 101, 103]);
    // Success path refetches the authoritative server order.
    await waitFor(() => {
      expect(getPlaylist).toHaveBeenCalledTimes(2);
    });
  });

  it('persists a Move-down button reorder once, identical to the keyboard order', async () => {
    await openDrawer();

    const rowA = option(/Clip A — position 1 of 3/i);
    fireEvent.click(within(rowA).getByTitle('Move down'));

    await waitFor(() => {
      expect(reorderPlaylistItems).toHaveBeenCalledTimes(1);
    });
    // Same orderedItemIds the keyboard test produced — both go through
    // moveItemByIndex, so drag/keyboard/button can't drift apart.
    expect(reorderPlaylistItems).toHaveBeenCalledWith(10, [102, 101, 103]);
    await waitFor(() => {
      expect(getPlaylist).toHaveBeenCalledTimes(2);
    });
  });

  it('persists a mouse drag reorder exactly once with the dragged-to order', async () => {
    await openDrawer();

    // Drag Clip A (slot 1) onto Clip C (slot 3) → [B, C, A].
    fireEvent.dragStart(option(/Clip A/i));
    fireEvent.dragOver(option(/Clip C/i));
    fireEvent.dragEnd(option(/Clip A/i));

    await waitFor(() => {
      expect(reorderPlaylistItems).toHaveBeenCalledTimes(1);
    });
    expect(reorderPlaylistItems).toHaveBeenCalledWith(10, [102, 103, 101]);
    await waitFor(() => {
      expect(getPlaylist).toHaveBeenCalledTimes(2);
    });
  });

  it('does not call the API for a no-op reorder (ArrowUp on the first row)', async () => {
    await openDrawer();

    fireEvent.keyDown(option(/Clip A — position 1 of 3/i), { key: 'ArrowUp' });

    // Flush any microtasks the handler might have scheduled, then confirm the
    // clamp short-circuited before any network call.
    await Promise.resolve();
    expect(reorderPlaylistItems).not.toHaveBeenCalled();
    // getPlaylist was called once (drawer open) and not again — no refresh.
    expect(getPlaylist).toHaveBeenCalledTimes(1);
  });

  it('rolls back to the server order and shows the backend message verbatim on 400', async () => {
    const BACKEND_MSG = 'Playlist items changed in another tab — refresh and retry.';
    // Shape extractMessage expects: an axios error whose response.data is a
    // well-formed ErrorResponse. `isAxiosError: true` is all axios.isAxiosError
    // checks for, so a plain branded object is enough.
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          status: 400,
          error: 'Bad Request',
          message: BACKEND_MSG,
          correlationId: 'corr-test',
          timestamp: '2026-06-01T12:00:00Z',
        },
      },
    });
    vi.mocked(reorderPlaylistItems).mockRejectedValueOnce(axiosError);

    await openDrawer();

    const rowA = option(/Clip A — position 1 of 3/i);
    fireEvent.click(within(rowA).getByTitle('Move down'));

    // Backend message surfaced verbatim.
    expect(await screen.findByText(BACKEND_MSG)).toBeInTheDocument();
    expect(reorderPlaylistItems).toHaveBeenCalledTimes(1);

    // Optimistic order rolled back: Clip A is back in slot 1, Clip B in slot 2.
    // Scope to the reorderable listbox — the Project filter <select> also
    // exposes role="option" children ("All projects", project names).
    const list = screen.getByRole('listbox', { name: /Playlist items/i });
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveAccessibleName(/Clip A — position 1 of 3/i);
    expect(options[1]).toHaveAccessibleName(/Clip B — position 2 of 3/i);
    // A failed reorder must NOT refetch (no spurious GET).
    expect(getPlaylist).toHaveBeenCalledTimes(1);
  });
});

// The "+ Add item" picker forwards the playlist's projectId to GET /api/content.
// A playlist bound to the seeded "Unassigned" project carries projectId = -1 (and
// an orphan playlist carries null); forwarding either makes the backend filter
// content to a project nothing is bound to and return an EMPTY picker. The guard
// in openContentPicker omits the filter for any non-positive/null project so the
// picker lists all READY content.
describe('PlaylistsPage — content picker projectId guard', () => {
  const detailWithProject = (projectId) => ({ ...detail(), projectId });

  // Same Pageable every caller sends — pinned so a regression in the page/size/
  // sort triple is also caught.
  const PAGEABLE = { page: 0, size: 50, sort: 'name,asc' };

  const openAddItemPicker = async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await waitFor(() => {
      expect(listContent).toHaveBeenCalledTimes(1);
    });
  };

  it('omits projectId for the -1 "Unassigned" sentinel so the picker lists all READY content', async () => {
    vi.mocked(getPlaylist).mockImplementation(() => Promise.resolve(detailWithProject(-1)));

    await openAddItemPicker();

    expect(listContent).toHaveBeenCalledWith({ status: 'READY' }, PAGEABLE);
    // Stronger than toHaveBeenCalledWith (which ignores undefined keys): assert
    // the projectId key is absent entirely, not merely undefined.
    const [filters] = vi.mocked(listContent).mock.calls[0]!;
    expect('projectId' in filters).toBe(false);
  });

  it('omits projectId for a null (orphan) project as well', async () => {
    vi.mocked(getPlaylist).mockImplementation(() => Promise.resolve(detailWithProject(null)));

    await openAddItemPicker();

    expect(listContent).toHaveBeenCalledWith({ status: 'READY' }, PAGEABLE);
    const [filters] = vi.mocked(listContent).mock.calls[0]!;
    expect('projectId' in filters).toBe(false);
  });

  it('forwards a real positive projectId unchanged (no regression)', async () => {
    vi.mocked(getPlaylist).mockImplementation(() => Promise.resolve(detailWithProject(7)));

    await openAddItemPicker();

    expect(listContent).toHaveBeenCalledWith({ status: 'READY', projectId: 7 }, PAGEABLE);
  });
});

// §2 — dwell-time editor on existing item rows. An image (natural
// durationSeconds 0) MUST carry a positive override; a video may clear its
// override to fall back to the source duration.
describe('PlaylistsPage — dwell-time editor', () => {
  // durationSeconds 0 == image (no natural duration); durationOverride null ==
  // effective 0 (the bug we flag). The video carries an explicit override.
  const imgItem = {
    id: 201,
    position: 0,
    contentFileId: 201,
    contentFileName: 'Poster',
    durationSeconds: 0,
    durationOverride: null,
  };
  const vidItem = {
    id: 202,
    position: 1,
    contentFileId: 202,
    contentFileName: 'Promo clip',
    durationSeconds: 30,
    durationOverride: 45,
  };
  const mixedDetail = () => ({ ...SUMMARY, items: [{ ...imgItem }, { ...vidItem }] });

  beforeEach(() => {
    vi.mocked(getPlaylist).mockImplementation(() => Promise.resolve(mixedDetail()));
    vi.mocked(setItemDurationOverride).mockResolvedValue({ ...imgItem, durationOverride: 20 });
  });

  const open = async () => {
    render(<PlaylistsPage />);
    fireEvent.click(await screen.findByText('Morning Loop'));
    await screen.findByLabelText('Dwell time in seconds for Poster');
  };

  it('flags a zero-dwell image with a warning badge and blocks an empty save', async () => {
    await open();

    // The image row (effective duration 0) surfaces the warning badge; the
    // video row (override 45) does not — exactly one badge on the page.
    expect(screen.getByRole('img', { name: /No dwell time set/i })).toBeInTheDocument();

    const input = screen.getByLabelText('Dwell time in seconds for Poster');
    fireEvent.blur(input); // empty → blocked

    expect(setItemDurationOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/Images need a positive dwell time/i)).toBeInTheDocument();
  });

  it('rejects an out-of-range dwell without calling the API', async () => {
    await open();

    const input = screen.getByLabelText('Dwell time in seconds for Poster');
    fireEvent.change(input, { target: { value: '999999' } }); // > 86400
    fireEvent.blur(input);

    expect(setItemDurationOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number of seconds between 1 and 86400/i)).toBeInTheDocument();
  });

  it('persists a positive image dwell via setItemDurationOverride', async () => {
    await open();

    const input = screen.getByLabelText('Dwell time in seconds for Poster');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(setItemDurationOverride).toHaveBeenCalledWith(10, 201, 20);
    });
  });

  it('allows clearing a video override (falls back to the source duration)', async () => {
    await open();

    const input = screen.getByLabelText('Dwell time in seconds for Promo clip');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(setItemDurationOverride).toHaveBeenCalledWith(10, 202, null);
    });
  });
});

// §2c — adding image content requires an operator-set dwell time, forwarded to
// addPlaylistItem. Uses the default (video) detail from the global beforeEach so
// the drawer opens on the seeded playlist, then overrides listContent with an
// image row.
describe('PlaylistsPage — add image requires a dwell time', () => {
  const imageContent = {
    id: 501,
    projectId: 1,
    name: 'Banner.png',
    contentType: 'image/png',
    sizeBytes: 1000,
    durationSeconds: null,
    status: 'READY',
    invalidReason: null,
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    thumbnailUrl: null,
    thumbnailExpiresAt: null,
    uploadedByUsername: null,
    canManage: true,
  };
  const CONTENT = {
    content: [imageContent],
    totalPages: 1,
    totalElements: 1,
    number: 0,
    size: 50,
  };

  beforeEach(() => {
    vi.mocked(listContent).mockResolvedValue(CONTENT);
    vi.mocked(addPlaylistItem).mockResolvedValue({
      id: 999,
      position: 3,
      contentFileId: 501,
      contentFileName: 'Banner.png',
      durationSeconds: 0,
      durationOverride: 12,
    });
  });

  const openPicker = async () => {
    render(<PlaylistsPage />);
    fireEvent.click(await screen.findByText('Morning Loop'));
    await screen.findByRole('option', { name: /Clip A — position 1 of 3/i });
    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    await screen.findByText('Banner.png');
  };

  it('disables Add until a valid dwell is entered, then forwards durationSeconds', async () => {
    await openPicker();

    const addBtn = screen.getByRole('button', { name: 'Add' });
    expect(addBtn).toBeDisabled();

    const dwell = screen.getByLabelText('Dwell time in seconds for Banner.png');
    fireEvent.change(dwell, { target: { value: '12' } });
    expect(addBtn).toBeEnabled();

    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(addPlaylistItem).toHaveBeenCalledWith(10, { contentFileId: 501, durationSeconds: 12 });
    });
  });
});
