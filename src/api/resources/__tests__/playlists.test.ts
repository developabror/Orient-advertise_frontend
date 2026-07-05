// Vitest unit tests for src/api/resources/playlists.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistItem,
  removePlaylistItem,
  renamePlaylist,
  reorderPlaylistItems,
  setItemDurationOverride,
  type PlaylistDetail,
  type PlaylistItemDto,
  type PlaylistSummary,
} from '../playlists';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const summary = (over: Partial<PlaylistSummary> = {}): PlaylistSummary => ({
  id: 1,
  projectId: 0,
  name: 'Spring Promo',
  itemCount: 3,
  totalDurationSeconds: 90,
  createdAt: '2026-05-08T09:00:00Z',
  updatedAt: '2026-05-08T09:00:00Z',
  ...over,
});

const item = (over: Partial<PlaylistItemDto> = {}): PlaylistItemDto => ({
  id: 100,
  position: 0,
  contentFileId: 50,
  contentFileName: 'promo.mp4',
  durationSeconds: 30,
  durationOverride: null,
  ...over,
});

const make = (status: number, message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    statusText: '',
    data: { status, error: '', message, correlationId: 'corr', timestamp: '' },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('listPlaylists', () => {
  it('GETs /api/playlists with assembled params and parses page', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [summary()] } });
    await listPlaylists({ projectId: 0, name: 'spring' }, { page: 0, size: 50 });
    expect(mockGet).toHaveBeenCalledWith('/api/playlists', {
      params: { projectId: 0, name: 'spring', page: 0, size: 50 },
    });
  });

  it('omits undefined filters', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listPlaylists({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/playlists', { params: {} });
  });
});

describe('getPlaylist', () => {
  it('GETs /api/playlists/{id} and returns the validated detail (items already sorted)', async () => {
    const detail: PlaylistDetail = {
      ...summary({ id: 7 }),
      items: [item({ id: 1, position: 0 }), item({ id: 2, position: 1 }), item({ id: 3, position: 2 })],
    };
    mockGet.mockResolvedValueOnce({ data: detail });

    const result = await getPlaylist(7);
    expect(mockGet).toHaveBeenCalledWith('/api/playlists/7');
    // getPlaylist now runtime-validates and returns a fresh object (not the
    // raw response reference), so compare by content rather than identity.
    expect(result).toEqual(detail);
    expect(result.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('throws when the "items" key is missing/renamed (loud failure at the boundary)', async () => {
    // A backend rename or a summary-shaped body with no items must NOT
    // silently resolve to an empty playlist.
    mockGet.mockResolvedValueOnce({ data: { ...summary({ id: 7 }) } });
    await expect(getPlaylist(7)).rejects.toThrow(/items/);
  });

  it('throws when "items" is present but not an array', async () => {
    mockGet.mockResolvedValueOnce({ data: { ...summary({ id: 7 }), items: 'nope' } });
    await expect(getPlaylist(7)).rejects.toThrow(/items/);
  });

  it('throws when the structural item field "position" is missing/renamed', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ...summary({ id: 7 }),
        items: [{ id: 1, contentFileId: 50, contentFileName: 'a.mp4', durationSeconds: 30 }],
      },
    });
    // `id`/`position` are the only required structural fields; durationSeconds
    // is coerced (see PL-1 test below), so this row throws specifically on position.
    await expect(getPlaylist(7)).rejects.toThrow(/item\.position/);
  });

  it('coerces an orphaned row (null contentFileId/contentFileName) rather than throwing', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ...summary({ id: 7 }),
        items: [
          {
            id: 1,
            position: 0,
            contentFileId: null,
            contentFileName: null,
            durationSeconds: 30,
            durationOverride: null,
          },
        ],
      },
    });

    const result = await getPlaylist(7);
    expect(result.items[0]?.contentFileId).toBeNull();
    // Coerced to a visible placeholder so list/aria render code stays string-only.
    expect(result.items[0]?.contentFileName).toBe('(file removed)');
  });

  it('coerces a nullable durationSeconds to 0 instead of throwing (PL-1: one bad row must not blank the detail)', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ...summary({ id: 7 }),
        items: [
          // A content file's natural durationSeconds is nullable on the backend.
          { id: 1, position: 0, contentFileId: 50, contentFileName: 'a.mp4', durationSeconds: null },
          item({ id: 2, position: 1, durationSeconds: 30 }),
        ],
      },
    });

    const result = await getPlaylist(7);
    // The whole detail loads (no throw); the null row coerces to 0.
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.durationSeconds).toBe(0);
    expect(result.items[1]?.durationSeconds).toBe(30);
  });

  it('coerces a null projectId to null instead of throwing (orphan playlist must not blank the detail)', async () => {
    // A genuinely orphan playlist serializes its project as null on the backend.
    // The header previously *threw* on this, blanking the whole drawer.
    mockGet.mockResolvedValueOnce({
      data: { ...summary({ id: 7, projectId: null as unknown as number }), items: [item()] },
    });

    const result = await getPlaylist(7);
    expect(result.projectId).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it('preserves the -1 "Unassigned" sentinel projectId verbatim (it is a finite id, not null)', async () => {
    mockGet.mockResolvedValueOnce({
      data: { ...summary({ id: 7, projectId: -1 }), items: [item()] },
    });

    const result = await getPlaylist(7);
    // The parser faithfully reflects the wire value; deciding -1 is "no project
    // to scope by" is the picker's job (PlaylistsPage.openContentPicker), not
    // the parser's.
    expect(result.projectId).toBe(-1);
  });
});

describe('createPlaylist + renamePlaylist', () => {
  it('POSTs /api/playlists with body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...summary(), items: [] } });
    await createPlaylist({ projectId: 0, name: 'New' });
    expect(mockPost).toHaveBeenCalledWith('/api/playlists', { projectId: 0, name: 'New' });
  });

  it('createPlaylist propagates 409 (duplicate project_id+name) unchanged', async () => {
    const err = make(409, 'Playlist with that name already exists in this project');
    mockPost.mockRejectedValueOnce(err);
    await expect(createPlaylist({ projectId: 0, name: 'dup' })).rejects.toBe(err);
  });

  it('renamePlaylist PUTs /api/playlists/{id} with { name } body', async () => {
    mockPut.mockResolvedValueOnce({ data: { ...summary({ name: 'Renamed' }), items: [] } });
    await renamePlaylist(7, 'Renamed');
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/7', { name: 'Renamed' });
  });
});

describe('deletePlaylist', () => {
  it('sends DELETE /api/playlists/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deletePlaylist(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/playlists/7');
  });

  it('lets a 409 (in use by active assignments) bubble unchanged for verbatim message', async () => {
    const err = make(409, 'In use by 2 active assignments: A1, A2');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deletePlaylist(7)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toBe('In use by 2 active assignments: A1, A2');
  });
});

describe('addPlaylistItem', () => {
  it('POSTs to .../items with all three fields when supplied', async () => {
    mockPost.mockResolvedValueOnce({ data: item({ id: 200, position: 5, durationOverride: 45 }) });
    await addPlaylistItem(1, { contentFileId: 50, position: 5, durationSeconds: 45 });
    expect(mockPost).toHaveBeenCalledWith('/api/playlists/1/items', {
      contentFileId: 50,
      position: 5,
      durationSeconds: 45,
    });
  });

  it('omits position and durationSeconds when not supplied', async () => {
    mockPost.mockResolvedValueOnce({ data: item() });
    await addPlaylistItem(1, { contentFileId: 50 });
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ contentFileId: 50 });
    expect('position' in body).toBe(false);
    expect('durationSeconds' in body).toBe(false);
  });
});

describe('removePlaylistItem', () => {
  it('sends DELETE /api/playlists/{playlistId}/items/{itemId}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await removePlaylistItem(1, 100);
    expect(mockDelete).toHaveBeenCalledWith('/api/playlists/1/items/100');
  });
});

describe('movePlaylistItem', () => {
  it('PUTs to .../items/{itemId}/move with { toPosition }', async () => {
    mockPut.mockResolvedValueOnce({ data: item({ id: 100, position: 3 }) });
    await movePlaylistItem(1, 100, 3);
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/1/items/100/move', { toPosition: 3 });
  });

  it('preserves toPosition: 0 (the start) — falsy-defined value not dropped', async () => {
    mockPut.mockResolvedValueOnce({ data: item({ id: 100, position: 0 }) });
    await movePlaylistItem(1, 100, 0);
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/1/items/100/move', { toPosition: 0 });
  });
});

describe('reorderPlaylistItems', () => {
  it('PUTs to .../items/reorder with { orderedItemIds } verbatim', async () => {
    mockPut.mockResolvedValueOnce({ data: [item({ id: 3 }), item({ id: 1 }), item({ id: 2 })] });
    await reorderPlaylistItems(1, [3, 1, 2]);
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/1/items/reorder', {
      orderedItemIds: [3, 1, 2],
    });
  });

  it('lets a 400 (mismatch with current items) bubble unchanged for verbatim message', async () => {
    const err = make(
      400,
      'orderedItemIds must match current playlist items exactly (extras: [99]; missing: [3])',
    );
    mockPut.mockRejectedValueOnce(err);
    await expect(reorderPlaylistItems(1, [1, 2, 99])).rejects.toBe(err);
  });
});

describe('setItemDurationOverride', () => {
  it('PUTs with { durationSeconds: <value> } when setting an override', async () => {
    mockPut.mockResolvedValueOnce({ data: item({ durationOverride: 60 }) });
    await setItemDurationOverride(1, 100, 60);
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/1/items/100/duration', {
      durationSeconds: 60,
    });
  });

  it('PUTs with { durationSeconds: null } to clear the override', async () => {
    mockPut.mockResolvedValueOnce({ data: item({ durationOverride: null }) });
    await setItemDurationOverride(1, 100, null);
    expect(mockPut).toHaveBeenCalledWith('/api/playlists/1/items/100/duration', {
      durationSeconds: null,
    });
  });
});
