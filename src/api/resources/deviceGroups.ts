// Device groups resource — typed wrappers around /api/device-groups,
// /api/device-groups/{id}, and /api/device-groups/{id}/devices.
//
// **Distinct from** src/api/bulkDeviceActions.ts. That file exists for
// the orchestrated bulk-action runner (parallel POSTs across groups
// with progress reporting). This file is the CRUD + membership surface
// for device groups themselves.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

export interface DeviceGroupSummary {
  readonly id: number;
  readonly projectId: number;
  readonly projectName: string;
  readonly name: string;
  readonly deviceCount: number;
  readonly createdAt: string;
}

/**
 * Single device entry inside `DeviceGroupDetail.devices`. Mirrors the
 * backend `DeviceSummary` schema verbatim — full device records remain
 * on /api/devices/{id}.
 */
export interface DeviceGroupMember {
  readonly id: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: string;
  // Per-device volume convergence on the member projection: `effectiveVolume`
  // is what the device runs (override ?? group ?? default), `reportedVolume` is
  // what it last reported (null until it checks in). Lets the operator watch
  // members converge after a group-volume change.
  readonly reportedVolume: number | null;
  readonly effectiveVolume: number;
}

export interface DeviceGroupDetail extends DeviceGroupSummary {
  readonly devices: readonly DeviceGroupMember[];
  // Group default volume (null = no group default; members fall back to their
  // own override or the system default).
  readonly volume: number | null;
}

export interface DeviceGroupListFilters {
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

const parseDeviceGroupSummary = (raw: unknown): DeviceGroupSummary => {
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

/** GET /api/device-groups. */
export const listDeviceGroups = async (
  filters: DeviceGroupListFilters,
  pageable: Pageable,
): Promise<Page<DeviceGroupSummary>> => {
  const params = dropUndefined({
    projectId: filters.projectId,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/device-groups', { params });
  return parsePage(data, parseDeviceGroupSummary);
};

/** GET /api/device-groups/{id} — includes the member device summaries. */
export const getDeviceGroup = async (id: number): Promise<DeviceGroupDetail> => {
  const { data } = await http.get<DeviceGroupDetail>(`/api/device-groups/${String(id)}`);
  return data;
};

/**
 * POST /api/device-groups.
 *
 * **409 on duplicate** — unique key is `(project_id, name)`
 * (`uq_device_group_name_per_project`); the 409 means a group with that
 * name already exists in this **project**. Surface inline on the name
 * input. A group belongs to a project and spans the project's regions.
 */
export const createDeviceGroup = async (req: {
  projectId: number;
  name: string;
}): Promise<DeviceGroupDetail> => {
  const { data } = await http.post<DeviceGroupDetail>('/api/device-groups', req);
  return data;
};

/** PUT /api/device-groups/{id} body `{ name }`. Same 409 contract as create. */
export const renameDeviceGroup = async (
  id: number,
  name: string,
): Promise<DeviceGroupDetail> => {
  const { data } = await http.put<DeviceGroupDetail>(
    `/api/device-groups/${String(id)}`,
    { name },
  );
  return data;
};

/**
 * DELETE /api/device-groups/{id}. **ADMIN only.**
 *
 * **409 if the group has active devices OR is targeted by confirmed
 * assignments.** The backend response body's `message` field carries
 * the count and names of the blocking entities; surface that
 * **verbatim** so the operator can decide whether to detach the
 * devices / cancel the assignments first.
 */
export const deleteDeviceGroup = async (id: number): Promise<void> => {
  await http.delete(`/api/device-groups/${String(id)}`);
};

/**
 * Response shape from POST /api/device-groups/{groupId}/devices, mirrored
 * verbatim from the backend `AddDevicesResponse` schema.
 *
 *   - `addedCount` — devices newly added to the target group.
 *   - `alreadyMember` — array of device ids that were already in the
 *     target group (treated as no-op success, not failure).
 *   - `movedFrom` — **per-device** map of devices that belonged to a
 *     different group and were moved. Keyed by **`deviceId`**, value is
 *     the **`previousGroupId`** the device was moved from. The
 *     deviceId key is stringified because JSON object keys are strings,
 *     but it parses back to a `number` (matches `Device.id`). Surface
 *     this so the operator knows which device came from where, not
 *     just how many devices a former group lost.
 *
 * Example wire payload:
 * ```json
 * { "addedCount": 1, "alreadyMember": [42],
 *   "movedFrom": { "17": 9, "23": 12 } }
 * ```
 * → device 17 was moved from group 9, device 23 from group 12.
 */
export interface AddDevicesResult {
  readonly addedCount: number;
  readonly alreadyMember: readonly number[];
  readonly movedFrom: Readonly<Record<string, number>>;
}

/**
 * POST /api/device-groups/{groupId}/devices body `{ deviceIds }`.
 * Devices that already belong to a different group are MOVED, not
 * rejected — the operator's intent is "make these the members of this
 * group", which implies removing them from any prior group.
 */
export const addDevicesToGroup = async (
  groupId: number,
  deviceIds: readonly number[],
): Promise<AddDevicesResult> => {
  const { data } = await http.post<AddDevicesResult>(
    `/api/device-groups/${String(groupId)}/devices`,
    { deviceIds },
  );
  return data;
};

/**
 * DELETE /api/device-groups/{groupId}/devices/{deviceId}. The device
 * is detached from the group but not deleted; it returns to the
 * "ungrouped" pool for that region.
 */
export const removeDeviceFromGroup = async (
  groupId: number,
  deviceId: number,
): Promise<void> => {
  await http.delete(
    `/api/device-groups/${String(groupId)}/devices/${String(deviceId)}`,
  );
};

/**
 * `PUT /api/device-groups/{id}/volume { volume }` — set the group default
 * volume. 204. Members without a per-device override converge on this on their
 * next heartbeat. Volume is an integer 0–100; clamp before calling.
 */
export const setDeviceGroupVolume = async (id: number, volume: number): Promise<void> => {
  await http.put(`/api/device-groups/${String(id)}/volume`, { volume });
};

/**
 * `DELETE /api/device-groups/{id}/volume` — clear the group default so members
 * fall back to their own override or the system default. 204.
 */
export const clearDeviceGroupVolume = async (id: number): Promise<void> => {
  await http.delete(`/api/device-groups/${String(id)}/volume`);
};
