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
