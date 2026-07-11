// Sync groups resource — typed wrappers around /api/sync-groups,
// /api/sync-groups/{id}, and /api/sync-groups/{id}/devices.
//
// A **sync group** is a first-class grouping distinct from
// region/facility/device_group: "these TVs are one sales point" and must
// play the same frame at the same moment. It is a **playback-coordination**
// grouping only — it carries **no volume** (that lives on device_group via
// `../deviceGroups.ts`). This file mirrors `deviceGroups.ts` shape-for-shape
// **minus the volume fields/endpoints**.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';
// The add-devices response envelope is structurally identical to the
// device-group one (addedCount / alreadyMember / movedFrom), so reuse it
// rather than re-declaring an identical type.
import type { AddDevicesResult } from './deviceGroups';

export type { AddDevicesResult };

export interface SyncGroupSummary {
  readonly id: number;
  readonly projectId: number;
  readonly projectName: string;
  readonly name: string;
  readonly deviceCount: number;
  readonly createdAt: string;
}

/**
 * Single device entry inside `SyncGroupDetail.devices`. Mirrors the
 * backend `DeviceSummary` schema — full device records remain on
 * /api/devices/{id}. Unlike {@link import('./deviceGroups').DeviceGroupMember}
 * there are **no volume fields**: sync groups coordinate playback, not audio.
 */
export interface SyncGroupMember {
  readonly id: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: string;
}

export interface SyncGroupDetail extends SyncGroupSummary {
  readonly devices: readonly SyncGroupMember[];
}

/**
 * One pickable entry in a sync group's shared playback order. `index` is the
 * **0-based deliverable index** — the value you POST to jump the whole group
 * to this video. Treat it as opaque and match on it; it is NOT guaranteed to
 * equal the item's position in {@link SyncGroupPlaybackView.items}.
 */
export interface SyncGroupPlaybackItem {
  readonly index: number;
  readonly fileId: number;
  readonly title: string;
  readonly durationSeconds: number;
}

/**
 * The group's shared, pickable playback view (GET .../playback).
 *
 * `coherent: false` means the members currently resolve **different** content
 * (different playlists / schedules), so there is no single order to jump as a
 * unit — render `reason` and disable jumping. `activeJump`, when present, is a
 * jump already scheduled for the group: a coordinated cut-over at `activateAt`.
 */
export interface SyncGroupPlaybackView {
  readonly coherent: boolean;
  readonly reason: string | null;
  readonly playlistId: number | null;
  readonly playlistName: string | null;
  readonly loopDurationMs: number;
  readonly items: readonly SyncGroupPlaybackItem[];
  readonly activeJump: { readonly index: number; readonly activateAt: string } | null;
  readonly memberCount: number;
}

/**
 * Result of POST .../playback/jump. The jump is **not instantaneous**: every
 * member flips together at `activateAt` (a few seconds out, per the backend's
 * `app.sync.jump-min-lead`) so offline devices converge on their next beat.
 */
export interface SyncGroupJumpResult {
  readonly syncGroupId: number;
  readonly index: number;
  readonly activateAt: string;
  readonly memberCount: number;
}

export interface SyncGroupListFilters {
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

const parseSyncGroupSummary = (raw: unknown): SyncGroupSummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.projectId !== 'number' || !Number.isFinite(v.projectId))
    throw new Error('projectId');
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.deviceCount !== 'number' || !Number.isFinite(v.deviceCount))
    throw new Error('deviceCount');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  return {
    id: v.id,
    projectId: v.projectId,
    projectName: typeof v.projectName === 'string' ? v.projectName : '',
    name: v.name,
    deviceCount: v.deviceCount,
    createdAt: v.createdAt,
  };
};

/** GET /api/sync-groups. */
export const listSyncGroups = async (
  filters: SyncGroupListFilters,
  pageable: Pageable,
): Promise<Page<SyncGroupSummary>> => {
  const params = dropUndefined({
    projectId: filters.projectId,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/sync-groups', { params });
  return parsePage(data, parseSyncGroupSummary);
};

/** GET /api/sync-groups/{id} — includes the member device summaries. */
export const getSyncGroup = async (id: number): Promise<SyncGroupDetail> => {
  const { data } = await http.get<SyncGroupDetail>(`/api/sync-groups/${String(id)}`);
  return data;
};

/**
 * POST /api/sync-groups.
 *
 * **409 on duplicate** — unique key is `(project_id, name)`; the 409 means a
 * sync group with that name already exists in this **project**. Surface
 * inline on the name input. A sync group belongs to a project and spans the
 * project's regions.
 */
export const createSyncGroup = async (req: {
  projectId: number;
  name: string;
}): Promise<SyncGroupDetail> => {
  const { data } = await http.post<SyncGroupDetail>('/api/sync-groups', req);
  return data;
};

/** PUT /api/sync-groups/{id} body `{ name }`. Same 409 contract as create. */
export const renameSyncGroup = async (
  id: number,
  name: string,
): Promise<SyncGroupDetail> => {
  const { data } = await http.put<SyncGroupDetail>(
    `/api/sync-groups/${String(id)}`,
    { name },
  );
  return data;
};

/**
 * DELETE /api/sync-groups/{id}. **ADMIN only.**
 *
 * **409 if the group still has member devices** (or is otherwise blocked).
 * The backend response body's `message` field carries the count/names of the
 * blocking entities; surface that **verbatim** so the operator can decide
 * whether to detach the devices first.
 */
export const deleteSyncGroup = async (id: number): Promise<void> => {
  await http.delete(`/api/sync-groups/${String(id)}`);
};

/**
 * POST /api/sync-groups/{groupId}/devices body `{ deviceIds }`.
 * Devices that already belong to a different sync group are MOVED, not
 * rejected — the operator's intent is "make these the members of this sync
 * group", which implies removing them from any prior sync group. Response
 * mirrors the device-group `AddDevicesResult`.
 */
export const addDevicesToSyncGroup = async (
  groupId: number,
  deviceIds: readonly number[],
): Promise<AddDevicesResult> => {
  const { data } = await http.post<AddDevicesResult>(
    `/api/sync-groups/${String(groupId)}/devices`,
    { deviceIds },
  );
  return data;
};

/**
 * DELETE /api/sync-groups/{groupId}/devices/{deviceId}. The device is
 * detached from the sync group but not deleted; it returns to the
 * "unassigned" pool for that project.
 */
export const removeDeviceFromSyncGroup = async (
  groupId: number,
  deviceId: number,
): Promise<void> => {
  await http.delete(
    `/api/sync-groups/${String(groupId)}/devices/${String(deviceId)}`,
  );
};

const parseSyncGroupPlaybackItem = (raw: unknown): SyncGroupPlaybackItem => {
  if (typeof raw !== 'object' || raw === null) throw new Error('playback item is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.index !== 'number' || !Number.isFinite(v.index)) throw new Error('index');
  if (typeof v.fileId !== 'number' || !Number.isFinite(v.fileId)) throw new Error('fileId');
  if (typeof v.durationSeconds !== 'number' || !Number.isFinite(v.durationSeconds))
    throw new Error('durationSeconds');
  return {
    index: v.index,
    fileId: v.fileId,
    title: typeof v.title === 'string' ? v.title : '',
    durationSeconds: v.durationSeconds,
  };
};

const parseActiveJump = (
  raw: unknown,
): { readonly index: number; readonly activateAt: string } | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new Error('activeJump is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.index !== 'number' || !Number.isFinite(v.index)) throw new Error('activeJump.index');
  if (typeof v.activateAt !== 'string') throw new Error('activeJump.activateAt');
  return { index: v.index, activateAt: v.activateAt };
};

// Liberal on read (mirrors parseRemoteActionDto in deviceDiagnostics.ts): a
// missing `items` coerces to [], and `coherent` defaults to false so a partial
// or unexpected payload disables jumping rather than throwing mid-render.
const parseSyncGroupPlaybackView = (raw: unknown): SyncGroupPlaybackView => {
  if (typeof raw !== 'object' || raw === null) throw new Error('playback view is not an object');
  const v = raw as Record<string, unknown>;
  return {
    coherent: v.coherent === true,
    reason: typeof v.reason === 'string' ? v.reason : null,
    playlistId:
      typeof v.playlistId === 'number' && Number.isFinite(v.playlistId) ? v.playlistId : null,
    playlistName: typeof v.playlistName === 'string' ? v.playlistName : null,
    loopDurationMs:
      typeof v.loopDurationMs === 'number' && Number.isFinite(v.loopDurationMs)
        ? v.loopDurationMs
        : 0,
    items: Array.isArray(v.items) ? v.items.map(parseSyncGroupPlaybackItem) : [],
    activeJump: parseActiveJump(v.activeJump),
    memberCount:
      typeof v.memberCount === 'number' && Number.isFinite(v.memberCount) ? v.memberCount : 0,
  };
};

const parseSyncGroupJumpResult = (raw: unknown): SyncGroupJumpResult => {
  if (typeof raw !== 'object' || raw === null) throw new Error('jump result is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.syncGroupId !== 'number' || !Number.isFinite(v.syncGroupId))
    throw new Error('syncGroupId');
  if (typeof v.index !== 'number' || !Number.isFinite(v.index)) throw new Error('index');
  if (typeof v.activateAt !== 'string') throw new Error('activateAt');
  if (typeof v.memberCount !== 'number' || !Number.isFinite(v.memberCount))
    throw new Error('memberCount');
  return {
    syncGroupId: v.syncGroupId,
    index: v.index,
    activateAt: v.activateAt,
    memberCount: v.memberCount,
  };
};

/**
 * GET /api/sync-groups/{id}/playback — the group's shared, pickable order.
 *
 * Returns `coherent: false` (a 200, **not** an error) when members resolve
 * different content; callers render `reason` and disable jumping. A genuine
 * load failure (5xx / network) surfaces through the caller's own error state.
 */
export const getSyncGroupPlayback = async (id: number): Promise<SyncGroupPlaybackView> => {
  const { data } = await http.get<unknown>(`/api/sync-groups/${String(id)}/playback`);
  return parseSyncGroupPlaybackView(data);
};

/**
 * POST /api/sync-groups/{id}/playback/jump body `{ index }`.
 *
 * **400** when `index` is out of range; **409** when the group is empty or
 * incoherent. Both arrive in the standard envelope with an operator-facing
 * `message` that should be surfaced **verbatim**. `_suppressErrorToast`
 * silences the generic 5xx/network toast; the caller claims the deferred 4xx
 * modal with `markErrorHandled(err)` and renders the message itself (see
 * `SyncGroupPlaybackPanel`, mirroring `ActivePlaylistPanel.sendControl`).
 */
export const jumpSyncGroupToIndex = async (
  id: number,
  index: number,
): Promise<SyncGroupJumpResult> => {
  const { data } = await http.post<unknown>(
    `/api/sync-groups/${String(id)}/playback/jump`,
    { index },
    { _suppressErrorToast: true },
  );
  return parseSyncGroupJumpResult(data);
};
