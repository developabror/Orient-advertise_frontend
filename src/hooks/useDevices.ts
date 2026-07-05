import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import { STATUS_FILTER_TO_API, mapStatus, type DeviceStatus } from '@api/deviceStatus';

export type { DeviceStatus };

export interface Device {
  readonly id: string;
  // Human-friendly device name (DeviceListItem.name on the wire). Falls back to
  // the id when the backend has no name on file, so the column is never blank.
  readonly name: string;
  readonly facility: string;
  readonly region: string;
  readonly status: DeviceStatus;
  readonly contentVersion: string;
  readonly lastSeen: string | null;
  // Devices may be unaffiliated — in that case bulk group actions can't
  // target them and the page surfaces a "skipped" warning instead.
  readonly groupId: string | null;
  readonly groupName: string | null;
  // Currently-active playlist. `hasActivePlaylist` is the presence signal,
  // derived from `activePlaylistId !== null` (NOT name truthiness — a defensive
  // empty-string name still counts as "has playlist"). The name is display-only,
  // mirroring how this row exposes `groupName` rather than a raw id.
  readonly activePlaylistName: string | null;
  readonly hasActivePlaylist: boolean;
}

export interface DevicesQuery {
  readonly page: number;
  readonly size: number;
  readonly region: string;
  // Optional project scope. A device keeps its own region; this narrows the
  // list to devices whose region belongs to the project (server-side filter).
  readonly projectId?: number;
  readonly facility: string;
  readonly status: string;
  readonly facilityId: string;
  readonly deviceGroupId: string;
  // '' (all) | 'assigned' (has playlist) | 'unassigned' (no playlist).
  readonly playlistState: string;
}

export interface DevicesState {
  readonly devices: readonly Device[];
  readonly totalItems: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly isStale: boolean;
}

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const sanitizeDevice = (value: unknown): Device | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = idStr(v.id);
  if (id === null) return null;
  // Prefer the device's name; fall back to the id so the column never renders
  // blank for an unnamed device.
  const name = typeof v.name === 'string' && v.name !== '' ? v.name : id;
  // DeviceListItem (list endpoint) uses computedStatus + facilityName.
  // DeviceDetail uses status + facilityId. Read both.
  const status = mapStatus(v.computedStatus ?? v.status);
  const facility =
    typeof v.facilityName === 'string'
      ? v.facilityName
      : typeof v.facility === 'string'
        ? v.facility
        : '—';
  // No `region` name in DeviceListItem; only regionId. Display "" until a
  // dashboard/region lookup populates it (or until backend adds the name).
  const region = typeof v.region === 'string' ? v.region : (idStr(v.regionId) ?? '');
  const lastSeen =
    typeof v.lastHeartbeatAt === 'string'
      ? v.lastHeartbeatAt
      : typeof v.lastSeen === 'string'
        ? v.lastSeen
        : null;
  const groupId = idStr(v.deviceGroupId ?? v.groupId);
  const groupName = typeof v.groupName === 'string' && v.groupName !== '' ? v.groupName : null;
  const contentVersion =
    typeof v.contentVersion === 'string'
      ? v.contentVersion
      : typeof v.currentContentVersion === 'string'
        ? v.currentContentVersion
        : '';
  // Presence is keyed off the id (activePlaylistId !== null), never the name —
  // a row with a valid id but an empty-string name still "has a playlist".
  const activePlaylistId = idStr(v.activePlaylistId);
  const activePlaylistName =
    typeof v.activePlaylistName === 'string' ? v.activePlaylistName : null;
  return {
    id,
    name,
    facility,
    region,
    status,
    contentVersion,
    lastSeen,
    groupId,
    groupName,
    activePlaylistName,
    hasActivePlaylist: activePlaylistId !== null,
  };
};

// Defense in depth: even if the server forgets the sort param, push devices
// that never reported a heartbeat to the bottom and order the rest newest-first.
const sortByLastSeenDesc = (a: Device, b: Device): number => {
  if (a.lastSeen === null && b.lastSeen === null) return 0;
  if (a.lastSeen === null) return 1;
  if (b.lastSeen === null) return -1;
  if (a.lastSeen > b.lastSeen) return -1;
  if (a.lastSeen < b.lastSeen) return 1;
  return 0;
};

interface ParsedResponse {
  readonly devices: readonly Device[];
  readonly totalItems: number;
  readonly totalPages: number;
}

// Spec: PageDeviceListItem with `content`, `totalElements`, `totalPages`,
// `size`, `number`. We also tolerate `data`/`totalItems` as a courtesy in
// case the backend grows a v2 endpoint with a different envelope.
const sanitizeResponse = (value: unknown, size: number): ParsedResponse => {
  if (typeof value !== 'object' || value === null) {
    return { devices: [], totalItems: 0, totalPages: 0 };
  }
  const v = value as Record<string, unknown>;
  let arr: unknown[] = [];
  if (Array.isArray(v.content)) arr = v.content;
  else if (Array.isArray(v.data)) arr = v.data;
  else if (Array.isArray(value)) arr = value;

  const devices: Device[] = [];
  for (const item of arr) {
    const d = sanitizeDevice(item);
    if (d) devices.push(d);
  }
  devices.sort(sortByLastSeenDesc);

  const totalElements =
    typeof v.totalElements === 'number' && Number.isFinite(v.totalElements)
      ? Math.max(0, Math.floor(v.totalElements))
      : typeof v.totalItems === 'number' && Number.isFinite(v.totalItems)
        ? Math.max(0, Math.floor(v.totalItems))
        : devices.length;
  const totalPages =
    typeof v.totalPages === 'number' && Number.isFinite(v.totalPages)
      ? Math.max(0, Math.floor(v.totalPages))
      : Math.max(1, Math.ceil(totalElements / size));

  return { devices, totalItems: totalElements, totalPages };
};

export const useDevices = (query: DevicesQuery): DevicesState => {
  const [devices, setDevices] = useState<readonly Device[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);

    // Spec uses Spring Pageable: page is 0-indexed.
    const params: Record<string, string | number | boolean> = {
      page: Math.max(0, query.page - 1),
      size: query.size,
      sort: 'lastHeartbeatAt,desc',
    };
    if (query.region) params.regionId = query.region;
    if (query.projectId !== undefined) params.projectId = query.projectId;
    if (query.facility && query.facility.length >= 2) params.facilityName = query.facility;
    if (query.facilityId) params.facilityId = query.facilityId;
    if (query.deviceGroupId) params.deviceGroupId = query.deviceGroupId;
    if (query.status) {
      const mapped = STATUS_FILTER_TO_API[query.status];
      if (mapped) params.status = mapped;
    }
    // Tri-state playlist filter: friendly enum → wire boolean. Distinct from the
    // device-group `unassigned` membership param. '' → omitted (all devices).
    if (query.playlistState === 'assigned') params.hasActivePlaylist = true;
    else if (query.playlistState === 'unassigned') params.hasActivePlaylist = false;

    http
      .get<unknown>('/api/devices', {
        params,
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitizeResponse(data, query.size);
        setDevices(parsed.devices);
        setTotalItems(parsed.totalItems);
        setTotalPages(parsed.totalPages);
        setIsStale(false);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setIsStale(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    query.page,
    query.size,
    query.region,
    query.projectId,
    query.facility,
    query.status,
    query.facilityId,
    query.deviceGroupId,
    query.playlistState,
  ]);

  return { devices, totalItems, totalPages, isLoading, isStale };
};
