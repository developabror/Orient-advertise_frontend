// Playlists resource — typed wrappers around /api/playlists,
// /api/playlists/{id}, and /api/playlists/{id}/items.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

/**
 * Mirror of the backend `PlaylistSummary` row shape returned by
 * GET /api/playlists. Total duration is the sum of item override
 * durations or, when null, the source file durations.
 *
 * `projectId` is **nullable**: a genuinely orphan playlist serializes its
 * project as `null` (`PlaylistSummary.java` / `PlaylistDetail.java`:
 * `p.getProject() != null ? p.getProject().getId() : null`), and a playlist
 * bound to the seeded "Unassigned" project carries the `-1` sentinel. Neither
 * is a real project to scope a content query by — see `openContentPicker` in
 * `PlaylistsPage.tsx`.
 */
export interface PlaylistSummary {
  readonly id: number;
  readonly projectId: number | null;
  readonly name: string;
  readonly itemCount: number;
  readonly totalDurationSeconds: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Single row inside `PlaylistDetail.items`. Mirrors the backend
 * `PlaylistItemDto` schema verbatim. `position` is the playback order
 * (always sorted ascending in the response); `durationOverride` is the
 * per-row override (null means "use the content file's own duration",
 * which is exposed separately as `durationSeconds`).
 *
 * `contentFileId` is nullable: the backend may emit `null` for an orphaned
 * row whose source file was hard-deleted. In that case `contentFileName`
 * is normalized to a clear placeholder by {@link getPlaylist} so render
 * code can stay string-only.
 */
export interface PlaylistItemDto {
  readonly id: number;
  readonly position: number;
  readonly contentFileId: number | null;
  readonly contentFileName: string;
  readonly durationSeconds: number;
  readonly durationOverride: number | null;
}

/**
 * GET /api/playlists/{id} response — extends the summary with the
 * full item list, sorted by `position`.
 */
export interface PlaylistDetail extends PlaylistSummary {
  readonly items: readonly PlaylistItemDto[];
}

export interface PlaylistListFilters {
  readonly projectId?: number;
  readonly name?: string;
}

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const parsePlaylistSummary = (raw: unknown): PlaylistSummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  // `projectId` is nullable on the wire (orphan playlist → null; "Unassigned"
  // project → -1 sentinel). Coerce anything non-finite to null instead of
  // throwing — a nullable project must not blank the whole playlist load
  // (mirrors the PlaylistItemDto coercions below).
  const projectId =
    typeof v.projectId === 'number' && Number.isFinite(v.projectId) ? v.projectId : null;
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.itemCount !== 'number' || !Number.isFinite(v.itemCount))
    throw new Error('itemCount');
  if (typeof v.totalDurationSeconds !== 'number' || !Number.isFinite(v.totalDurationSeconds))
    throw new Error('totalDurationSeconds');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  if (typeof v.updatedAt !== 'string') throw new Error('updatedAt');
  return {
    id: v.id,
    projectId,
    name: v.name,
    itemCount: v.itemCount,
    totalDurationSeconds: v.totalDurationSeconds,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
};

/**
 * Validate a single raw item from `PlaylistDetail.items`. Only the row's own
 * structural ids (`id`, `position`) are required and throw on mismatch so a
 * backend rename fails loudly. Everything else is coerced, never thrown — a
 * single bad/nullable field must not blank the entire playlist detail:
 *   - `durationSeconds`: a content file's natural duration is NULLABLE on the
 *     backend (`PlaylistItemDto`); a null/absent/non-finite value coerces to 0
 *     (PL-1 / PL-3 — previously this threw and broke the whole detail load).
 *   - `durationOverride`: null means "use the file's own duration".
 *   - `contentFileId`/`contentFileName`: an orphaned row (source file
 *     hard-deleted) may carry null — widen the id to null and coerce a missing
 *     name to a visible placeholder.
 */
export const parsePlaylistItem = (raw: unknown): PlaylistItemDto => {
  if (typeof raw !== 'object' || raw === null) throw new Error('item is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('item.id');
  if (typeof v.position !== 'number' || !Number.isFinite(v.position))
    throw new Error('item.position');
  const durationSeconds =
    typeof v.durationSeconds === 'number' && Number.isFinite(v.durationSeconds)
      ? v.durationSeconds
      : 0;
  const durationOverride =
    typeof v.durationOverride === 'number' && Number.isFinite(v.durationOverride)
      ? v.durationOverride
      : null;
  const contentFileId =
    typeof v.contentFileId === 'number' && Number.isFinite(v.contentFileId)
      ? v.contentFileId
      : null;
  const contentFileName =
    typeof v.contentFileName === 'string' && v.contentFileName !== ''
      ? v.contentFileName
      : '(file removed)';
  return {
    id: v.id,
    position: v.position,
    contentFileId,
    contentFileName,
    durationSeconds,
    durationOverride,
  };
};

/**
 * Validate a raw GET /api/playlists/{id} body into a `PlaylistDetail`. Reuses
 * {@link parsePlaylistSummary} for the shared header fields, then requires
 * `items` to be an array (throwing otherwise) so a missing/renamed key surfaces
 * as a loud failure at the API boundary instead of a silently-empty playlist.
 */
export const parsePlaylistDetail = (raw: unknown): PlaylistDetail => {
  const summary = parsePlaylistSummary(raw);
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.items)) {
    throw new Error('items: expected an array (playlist detail response missing "items")');
  }
  return { ...summary, items: v.items.map(parsePlaylistItem) };
};

/** GET /api/playlists. */
export const listPlaylists = async (
  filters: PlaylistListFilters,
  pageable: Pageable,
): Promise<Page<PlaylistSummary>> => {
  const params = dropUndefined({
    projectId: filters.projectId,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/playlists', { params });
  return parsePage(data, parsePlaylistSummary);
};

/**
 * GET /api/playlists/{id}. Items are returned sorted by `position`
 * ascending — the FE shouldn't re-sort.
 */
export const getPlaylist = async (id: number): Promise<PlaylistDetail> => {
  const { data } = await http.get<unknown>(`/api/playlists/${String(id)}`);
  return parsePlaylistDetail(data);
};

/**
 * POST /api/playlists.
 *
 * **409 on duplicate** — the unique key is `(project_id, name)`.
 * Surface as inline form error on the name input; the global
 * interceptor doesn't toast 4xx.
 */
export const createPlaylist = async (req: {
  projectId: number;
  name: string;
}): Promise<PlaylistDetail> => {
  const { data } = await http.post<PlaylistDetail>('/api/playlists', req);
  return data;
};

/** PUT /api/playlists/{id} body `{ name }`. Same 409 contract as create. */
export const renamePlaylist = async (id: number, name: string): Promise<PlaylistDetail> => {
  const { data } = await http.put<PlaylistDetail>(`/api/playlists/${String(id)}`, { name });
  return data;
};

/**
 * DELETE /api/playlists/{id}. **ADMIN only.**
 *
 * **409 if in use by active assignments.** The backend message body's
 * `message` field carries the count and names of blocking assignments
 * — surface verbatim so the operator can decide whether to cancel the
 * blocking assignments first.
 */
export const deletePlaylist = async (id: number): Promise<void> => {
  await http.delete(`/api/playlists/${String(id)}`);
};

/**
 * POST /api/playlists/{playlistId}/items.
 *
 * `position` and `durationSeconds` are both optional:
 *   - `position` omitted → server appends to the end of the playlist.
 *   - `durationSeconds` omitted → server uses the content file's own
 *     duration (override stays null).
 *
 * Returns the newly-created item with its server-assigned `id` and
 * `position`.
 */
export const addPlaylistItem = async (
  playlistId: number,
  req: { contentFileId: number; position?: number; durationSeconds?: number },
): Promise<PlaylistItemDto> => {
  const body = dropUndefined({
    contentFileId: req.contentFileId,
    position: req.position,
    durationSeconds: req.durationSeconds,
  });
  const { data } = await http.post<PlaylistItemDto>(
    `/api/playlists/${String(playlistId)}/items`,
    body,
  );
  return data;
};

/**
 * DELETE /api/playlists/{playlistId}/items/{itemId}. Server compacts
 * remaining `position` values automatically — caller doesn't need to
 * reorder afterward.
 */
export const removePlaylistItem = async (
  playlistId: number,
  itemId: number,
): Promise<void> => {
  await http.delete(
    `/api/playlists/${String(playlistId)}/items/${String(itemId)}`,
  );
};

/**
 * PUT /api/playlists/{playlistId}/items/{itemId}/move body
 * `{ toPosition }`. The server shifts other items as needed; returns
 * the moved item with its new `position`.
 */
export const movePlaylistItem = async (
  playlistId: number,
  itemId: number,
  toPosition: number,
): Promise<PlaylistItemDto> => {
  const { data } = await http.put<PlaylistItemDto>(
    `/api/playlists/${String(playlistId)}/items/${String(itemId)}/move`,
    { toPosition },
  );
  return data;
};

/**
 * PUT /api/playlists/{playlistId}/items/reorder body
 * `{ orderedItemIds: number[] }`.
 *
 * **The array must EXACTLY match the playlist's current items** — same
 * length, same id set, just reordered. The backend rejects mismatches
 * (extra ids, missing ids, unknown ids) with 400 and a descriptive
 * `message`. Surface that message **verbatim** so the operator can
 * tell whether they were racing another tab's edit or whether their
 * UI state is just stale.
 */
export const reorderPlaylistItems = async (
  playlistId: number,
  orderedItemIds: readonly number[],
): Promise<PlaylistItemDto[]> => {
  const { data } = await http.put<PlaylistItemDto[]>(
    `/api/playlists/${String(playlistId)}/items/reorder`,
    { orderedItemIds },
  );
  return data;
};

/**
 * PUT /api/playlists/{playlistId}/items/{itemId}/duration body
 * `{ durationSeconds }`. Pass `null` to clear the override (item falls
 * back to the content file's own duration); pass a positive number to
 * set a custom duration in seconds. The wire field name matches the
 * backend `SetDurationRequest` exactly.
 */
export const setItemDurationOverride = async (
  playlistId: number,
  itemId: number,
  durationSeconds: number | null,
): Promise<PlaylistItemDto> => {
  const { data } = await http.put<PlaylistItemDto>(
    `/api/playlists/${String(playlistId)}/items/${String(itemId)}/duration`,
    { durationSeconds },
  );
  return data;
};
