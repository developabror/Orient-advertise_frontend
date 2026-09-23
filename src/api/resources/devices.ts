// Devices resource — typed wrappers around /api/devices and
// /api/devices/{id}.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves. Soft-delete on the backend is by `deleted=true` + a
// `deletedAt` timestamp — `getDevice` returns soft-deleted rows for the
// audit trail (the README describes this in 'Soft Delete'), so consumers
// must inspect `deleted` before treating the record as live.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';
import type { DeviceWsStatus } from '../wsClient';

/**
 * Backend `Device.Status` enum verbatim. Aliased from
 * {@link DeviceWsStatus} so the WS event payload and the REST DTO can
 * never drift on the enum surface.
 */
export type DeviceStatus = DeviceWsStatus;

/**
 * Server-side filter keys. The query-param names match the backend
 * exactly (note: `serial`, not `serialNumber`; `name` filters by device
 * name, not facility name — facility name has its own `facilityName`
 * key). Every field is optional; undefined fields are stripped from the
 * outgoing query string.
 */
export interface DeviceListFilters {
  readonly status?: DeviceStatus;
  readonly regionId?: number;
  // Project scope. A device keeps its own `regionId`; `projectId` is a
  // server-side filter only (it narrows to devices whose region belongs to
  // the project) — there is no `projectId` field on the device DTOs.
  readonly projectId?: number;
  readonly facilityId?: number;
  readonly deviceGroupId?: number;
  readonly serial?: string;
  readonly name?: string;
  readonly facilityName?: string;
  // Tri-state: true (has playlist) / false (no playlist) / omitted (all). 1:1
  // wire key — distinct from device-group membership filters.
  readonly hasActivePlaylist?: boolean;
  // Sync-group membership filter: true → only devices with `sync_group_id IS
  // NULL` (the "not yet in a sync group" pool the sync-group picker draws from).
  // Orthogonal to the device-group `unassigned` param (`device_group_id IS
  // NULL`): they filter different axes — never substitute one for the other.
  readonly syncUnassigned?: boolean;
}

/**
 * Row shape of GET /api/devices `content[]`. Mirrors the backend
 * `DeviceListItem` record. `computedStatus` is a derived string (the
 * server folds heartbeat freshness into the value), so it's typed as a
 * plain string rather than the strict `DeviceStatus` enum — be liberal
 * in what we accept on read.
 */
export interface DeviceListItem {
  readonly id: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly computedStatus: string;
  readonly regionId: number | null;
  readonly facilityId: number | null;
  readonly facilityName: string | null;
  readonly deviceGroupId: number | null;
  // Sync-group membership — orthogonal to `deviceGroupId` (a device can be in
  // both). Nullable; may be absent on the list endpoint during rollout, in
  // which case it defensively parses to null.
  readonly syncGroupId: number | null;
  readonly lastHeartbeatAt: string | null;
  // Active playlist projection. `activePlaylistName` is non-null whenever
  // `activePlaylistId` is set (the presence signal is the id, not the name).
  readonly activePlaylistId: number | null;
  readonly activePlaylistName: string | null;
}

/**
 * Full DTO from GET /api/devices/{id}. Includes the soft-delete trail
 * (`deleted`, `deletedAt`); a row with `deleted: true` is intentionally
 * still returned by the server for the audit view — consumers must check
 * `deleted` before treating the record as live.
 */
export interface DeviceDetail {
  readonly id: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: DeviceStatus;
  readonly regionId: number | null;
  readonly facilityId: number | null;
  readonly deviceGroupId: number | null;
  // Sync-group placement — the sales-point playback grouping (see
  // syncGroups.ts). `syncGroupName` is present only if the backend joins it in;
  // both are nullable (a device need not belong to a sync group).
  readonly syncGroupId: number | null;
  readonly syncGroupName: string | null;
  readonly lastHeartbeatAt: string | null;
  // Volume convergence (set remotely, applied on the device's next heartbeat).
  // `effectiveVolume` = volumeOverride ?? group.volume ?? 100; `reportedVolume`
  // is what the device last reported (null until it checks in); `volumeOverride`
  // is the per-device target (null = inherit from group/default).
  readonly reportedVolume: number | null;
  readonly effectiveVolume: number;
  readonly volumeOverride: number | null;
  readonly registeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly deleted: boolean;
  // End of the admin-opened re-registration window (ISO-8601 instant); null
  // when no window is open. Optional: absent on backends that predate it.
  readonly reregistrationAllowedUntil?: string | null;
}

/** Response of POST /api/devices/{id}/reregistration-window. */
export interface ReregistrationWindow {
  readonly allowedUntil: string;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error('expected number or null');
};

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new Error('expected string or null');
};

const parseDeviceListItem = (raw: unknown): DeviceListItem => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.serialNumber !== 'string') throw new Error('serialNumber');
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.computedStatus !== 'string') throw new Error('computedStatus');
  return {
    id: v.id,
    serialNumber: v.serialNumber,
    name: v.name,
    computedStatus: v.computedStatus,
    regionId: numOrNull(v.regionId),
    facilityId: numOrNull(v.facilityId),
    facilityName: strOrNull(v.facilityName),
    deviceGroupId: numOrNull(v.deviceGroupId),
    syncGroupId: numOrNull(v.syncGroupId),
    lastHeartbeatAt: strOrNull(v.lastHeartbeatAt),
    activePlaylistId: numOrNull(v.activePlaylistId),
    activePlaylistName: strOrNull(v.activePlaylistName),
  };
};

// Drop undefined keys so the outgoing query string only contains the
// filters the caller actually set. axios would itself omit
// `undefined`-valued params, but building a clean object means request
// logs and test assertions stay readable.
const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * GET /api/devices — paged + filtered list. Returns a parsed
 * {@link Page} envelope with row-level defensive parsing: malformed rows
 * are skipped (not poisoning the whole page), the server's
 * `numberOfElements` is preserved so the UI can detect drops.
 */
export const listDevices = async (
  filters: DeviceListFilters,
  pageable: Pageable,
): Promise<Page<DeviceListItem>> => {
  const params = dropUndefined({ ...filters, ...pageable });
  const { data } = await http.get<unknown>('/api/devices', { params });
  return parsePage(data, parseDeviceListItem);
};

/**
 * GET /api/devices/{id}. **Returns soft-deleted records** (deleted=true)
 * — see the file-level note. Caller is responsible for choosing whether
 * to render or hide them.
 *
 * 404 is propagated as a thrown axios error; the global interceptor does
 * NOT toast 4xx, so detail pages can render "not found" UI without a
 * competing notification.
 */
export const getDevice = async (id: number): Promise<DeviceDetail> => {
  const { data } = await http.get<DeviceDetail>(`/api/devices/${String(id)}`);
  return data;
};

/**
 * PUT /api/devices/{id} body `{ name }`. Returns the updated DTO.
 * 400 with field errors flows through {@link extractFieldErrors} — no
 * toast (4xx fall-through), caller renders inline.
 */
export const updateDevice = async (id: number, name: string): Promise<DeviceDetail> => {
  const { data } = await http.put<DeviceDetail>(`/api/devices/${String(id)}`, { name });
  return data;
};

/**
 * PUT /api/devices/{id}/location body `{ regionId, facilityId }` — relocate a
 * device to a new region + facility. Returns the updated DTO.
 *
 * The backend enforces cross-project group invariants: a device whose device
 * group belongs to a different project can't be moved there. Intra-project
 * region moves now succeed (a group spans its project's regions). 4xx fall
 * through the global interceptor (no toast) so the caller renders the envelope
 * message inline:
 *  - **400** — validation (e.g. the facility doesn't belong to the region).
 *  - **409** — cross-project group conflict (remove the device from its group,
 *    or move the whole group, first).
 */
export const updateDeviceLocation = async (
  id: number,
  body: { readonly regionId: number; readonly facilityId: number },
): Promise<DeviceDetail> => {
  const { data } = await http.put<DeviceDetail>(`/api/devices/${String(id)}/location`, body);
  return data;
};

/**
 * DELETE /api/devices/{id}. Soft-delete on the backend. **ADMIN only** —
 * calling as OPERATOR throws a 403 which the global interceptor toasts
 * with "You don't have access to that resource." We deliberately do NOT
 * suppress the toast: it's the right UX for an authorization failure on
 * a destructive action.
 */
export const deleteDevice = async (id: number): Promise<void> => {
  await http.delete(`/api/devices/${String(id)}`);
};

/**
 * POST /api/devices/{id}/reregistration-window (no body). **ADMIN only.**
 * Opens a 1-hour window during which the NEXT registration of this device's
 * serial is issued a new token (the old one stops working) — the recovery path
 * for a wiped/reinstalled box. Returns when the window closes.
 *
 * 403 (non-admin) is toasted by the global interceptor, like
 * {@link deleteDevice}; 404 (unknown device) falls through for the caller to
 * render inline. A 200 whose body lacks a string `allowedUntil` throws rather
 * than handing the page an unchecked value.
 */
export const allowReregistration = async (id: number): Promise<ReregistrationWindow> => {
  const { data } = await http.post<unknown>(`/api/devices/${String(id)}/reregistration-window`);
  if (typeof data !== 'object' || data === null) {
    throw new Error('Malformed reregistration-window response');
  }
  const { allowedUntil } = data as Record<string, unknown>;
  if (typeof allowedUntil !== 'string') {
    throw new Error('Malformed reregistration-window response');
  }
  return { allowedUntil };
};

/**
 * Remote volume control. The backend persists the desired volume; devices
 * converge on their next heartbeat. Volume is always an integer 0–100 —
 * callers must clamp/validate before invoking.
 *
 * `PUT /api/devices/{id}/volume { volume }` — set the per-device override. 204.
 * **400** out-of-range / **404** unknown device fall through the interceptor.
 */
export const setDeviceVolume = async (id: number, volume: number): Promise<void> => {
  await http.put(`/api/devices/${String(id)}/volume`, { volume });
};

/**
 * `DELETE /api/devices/{id}/volume` — clear the per-device override so the
 * device falls back to its group volume (or the default). 204.
 */
export const clearDeviceVolume = async (id: number): Promise<void> => {
  await http.delete(`/api/devices/${String(id)}/volume`);
};

/**
 * `PUT /api/devices/volume { volume }` — "apply to all": write the per-device
 * override on every device in the caller's scope (ADMIN = all devices,
 * OPERATOR = devices in assigned projects). Returns the affected count.
 */
export const setAllDevicesVolume = async (volume: number): Promise<{ affected: number }> => {
  const { data } = await http.put<{ affected: number }>(`/api/devices/volume`, { volume });
  return data;
};

/**
 * One row of {@link DeviceActivePlaylist}. `index` is the device's **delivered**
 * ordinal: contiguous from 0 over the items the device actually holds, and
 * exactly what `POST /api/devices/{id}/playlist/control` takes as a JUMP
 * `position`. Use it as the React key too — `fileId` repeats when a playlist
 * schedules the same clip twice, and keying by it would duplicate keys and jump
 * to the wrong row. `position` is the raw playlist slot, shown for reference.
 */
export interface DeviceActivePlaylistItem {
  readonly index: number;
  readonly position: number;
  readonly fileId: string;
  readonly title: string;
  readonly durationSeconds: number;
}

/**
 * What a device is playing, as the operator panel lists it. `playlistId` is
 * null when nothing is assigned (a 200, not an error). `scheduled` means the
 * device is in synchronised group playback: it refuses per-device transport
 * commands (`FAILED "SCHEDULE_MODE"`), so the UI disables them and points at
 * the sync-group jump instead.
 */
export interface DeviceActivePlaylist {
  readonly playlistId: string | null;
  readonly name: string;
  readonly totalDurationSeconds: number;
  readonly scheduled: boolean;
  readonly items: readonly DeviceActivePlaylistItem[];
}

const parseActivePlaylistItem = (raw: unknown): DeviceActivePlaylistItem => {
  if (typeof raw !== 'object' || raw === null) throw new Error('item is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.index !== 'number' || !Number.isFinite(v.index)) throw new Error('index');
  if (typeof v.fileId !== 'number' || !Number.isFinite(v.fileId)) throw new Error('fileId');
  const fileId = String(v.fileId);
  return {
    index: v.index,
    position:
      typeof v.position === 'number' && Number.isFinite(v.position) ? v.position : v.index,
    fileId,
    title: typeof v.name === 'string' && v.name !== '' ? v.name : fileId,
    // The backend sends the slot the device really plays, so this is never
    // null — but a floor at 0 keeps a bad row from rendering a negative bar.
    durationSeconds: Math.max(
      0,
      typeof v.durationSeconds === 'number' && Number.isFinite(v.durationSeconds)
        ? Math.floor(v.durationSeconds)
        : 0,
    ),
  };
};

/**
 * `GET /api/devices/{id}/active-playlist` — the operator view of what the
 * device is playing (ADMIN/OPERATOR/VIEWER; 404 when out of an operator's
 * scope). Deliberately NOT the device's own `/playlist`, which is device-only
 * and hands out presigned media URLs.
 *
 * `_suppressErrorToast` silences the generic toast: the panel renders the
 * failure itself, so the caller must `markErrorHandled(err)` (see
 * `useDeviceActivePlaylist`).
 */
export const getDeviceActivePlaylist = async (
  id: string,
  signal?: AbortSignal,
): Promise<DeviceActivePlaylist> => {
  const { data } = await http.get<unknown>(
    `/api/devices/${encodeURIComponent(id)}/active-playlist`,
    // `exactOptionalPropertyTypes`: only pass `signal` when there is one.
    { ...(signal ? { signal } : {}), _suppressErrorToast: true },
  );
  if (typeof data !== 'object' || data === null) throw new Error('active playlist is not an object');
  const v = data as Record<string, unknown>;
  const playlistId = numOrNull(v.playlistId);
  const items = Array.isArray(v.items) ? v.items.map(parseActivePlaylistItem) : [];
  return {
    playlistId: playlistId === null ? null : String(playlistId),
    name: typeof v.playlistName === 'string' && v.playlistName !== '' ? v.playlistName : '',
    totalDurationSeconds:
      typeof v.totalDurationSeconds === 'number' && Number.isFinite(v.totalDurationSeconds)
        ? v.totalDurationSeconds
        : 0,
    scheduled: v.scheduled === true,
    items,
  };
};
