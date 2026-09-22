import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import { reconcileStatus, type DeviceStatus } from '@api/deviceStatus';
import type { RemoteCapability } from '@api/resources/remoteControl';

export interface DevicePlaylistItem {
  readonly id: string;
  readonly title: string;
  readonly durationSeconds: number;
}

export interface DevicePlaylist {
  readonly id: string;
  readonly name: string;
  readonly items: readonly DevicePlaylistItem[];
  readonly currentItemId: string | null;
  readonly currentItemElapsedSeconds: number;
}

// Detail and list now share the same FE status union (see @api/deviceStatus).
// Kept as a named alias so existing imports (`DeviceDetailStatus`) keep working.
export type DeviceDetailStatus = DeviceStatus;

export interface DeviceDetail {
  readonly id: string;
  readonly facility: string;
  readonly region: string;
  readonly group: string;
  // Sync-group placement (the sales-point playback grouping). `syncGroupId` is
  // null when the device is in no sync group; `syncGroupName` is present only
  // if the backend joins it in.
  readonly syncGroupId: number | null;
  readonly syncGroupName: string | null;
  readonly serialNumber: string;
  readonly ipAddress: string;
  readonly contentVersion: string;
  // Volume convergence (set remotely, applied on the device's next heartbeat).
  readonly reportedVolume: number | null;
  readonly effectiveVolume: number;
  readonly volumeOverride: number | null;
  readonly lastSeen: string | null;
  readonly status: DeviceDetailStatus;
  readonly activePlaylist: DevicePlaylist | null;
  /**
   * Last remote-control capability the device reported on its heartbeat.
   *
   * **Null today for every device**: the backend stores it on `Device`
   * (`remote_supported`, …) but does not yet project it onto
   * `GET /api/devices/{id}` — it only appears on the remote-session response.
   * Parsed here anyway so the Connect button's `supported === false` check
   * starts disabling the moment the backend adds the field, with no frontend
   * change (contract §8: the capability block must not need one).
   *
   * Null therefore means **unknown**, never "unsupported" — the viewer's 422
   * path is what actually rejects a box that can't do this.
   */
  readonly remoteCapability: RemoteCapability | null;
  /**
   * End of the admin-opened re-registration window (ISO-8601 instant), or null
   * when none is open. A past instant means the window has already lapsed —
   * callers compare against the clock before treating it as open.
   */
  readonly reregistrationAllowedUntil: string | null;
}

export type DeviceFetchState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly device: DeviceDetail }
  | { readonly state: 'not-found' }
  | { readonly state: 'error' };

const safeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
};

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Liberal on read, like the rest of this file: a malformed block parses to
// null (= unknown) rather than failing the device load. Losing a tooltip is
// cheaper than losing the page.
const sanitizeRemoteCapability = (value: unknown): RemoteCapability | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.supported !== 'boolean') return null;
  const input =
    v.input === 'ROOT' || v.input === 'ACCESSIBILITY' || v.input === 'NONE' ? v.input : 'NONE';
  return {
    supported: v.supported,
    input,
    transport: v.transport === 'SCRCPY_WS' ? 'SCRCPY_WS' : 'NONE',
    maxWidth: numOrNull(v.maxWidth),
    maxHeight: numOrNull(v.maxHeight),
    reportedAt: typeof v.reportedAt === 'string' ? v.reportedAt : null,
  };
};

// ISO instant or null. A non-string or unparseable value parses to null
// (= no window) rather than failing the device load.
const instantOrNull = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

// Mirror of the device-sync `PlaylistItemDto` carried by
// `DeviceController.PlaylistResponse` (`/api/devices/{id}/playlist`).
// Required: `fileId`, `name`, `durationSeconds`. Optional fields the
// device player consumes — `presignedUrl`, `contentType`, `checksum`,
// `sizeBytes` — aren't surfaced in the operator UI but we keep the
// fallback chain narrow to the documented wire shape.
const sanitizePlaylistItem = (v: unknown): DevicePlaylistItem | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = idStr(r.fileId);
  if (id === null) return null;
  const title = typeof r.name === 'string' && r.name !== '' ? r.name : id;
  return {
    id,
    title,
    durationSeconds: Math.max(0, Math.floor(safeNumber(r.durationSeconds))),
  };
};

// Spec PlaylistResponse: { deviceId, playlistId, playlistName, contentVersion,
// totalDurationSeconds, items[] }. There's no current-item / elapsed-time
// field — those would come from a runtime status endpoint that doesn't exist
// in this spec.
const sanitizePlaylist = (data: unknown): DevicePlaylist | null => {
  if (typeof data !== 'object' || data === null) return null;
  const v = data as Record<string, unknown>;
  const id = idStr(v.playlistId);
  if (id === null) return null;
  const name = typeof v.playlistName === 'string' ? v.playlistName : `Playlist ${id}`;
  const itemsRaw = Array.isArray(v.items) ? v.items : [];
  const items: DevicePlaylistItem[] = [];
  for (const it of itemsRaw) {
    const parsed = sanitizePlaylistItem(it);
    if (parsed) items.push(parsed);
  }
  return {
    id,
    name,
    items,
    currentItemId: null,
    currentItemElapsedSeconds: 0,
  };
};

// Spec DeviceDetail: { id, serialNumber, name, status, regionId, facilityId,
// deviceGroupId, lastHeartbeatAt, registeredAt, createdAt, updatedAt,
// deletedAt, deleted }. There's no facility/region NAME or IP/content version
// on this DTO — those live on DiagnosticsView. We fill them with the ids
// (stringified) so the page header shows something meaningful.
const sanitizeDevice = (value: unknown): DeviceDetail | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = idStr(v.id);
  if (id === null) return null;
  const lastSeen =
    typeof v.lastHeartbeatAt === 'string'
      ? v.lastHeartbeatAt
      : typeof v.lastSeen === 'string'
        ? v.lastSeen
        : null;
  return {
    id,
    serialNumber: typeof v.serialNumber === 'string' ? v.serialNumber : '—',
    facility: idStr(v.facilityId) ?? '—',
    region: idStr(v.regionId) ?? '—',
    group: idStr(v.deviceGroupId) ?? '—',
    syncGroupId: numOrNull(v.syncGroupId),
    syncGroupName:
      typeof v.syncGroupName === 'string' && v.syncGroupName !== '' ? v.syncGroupName : null,
    ipAddress: '—',
    contentVersion: typeof v.contentVersion === 'string' ? v.contentVersion : '—',
    reportedVolume: numOrNull(v.reportedVolume),
    // Falls back to the system default (100) if absent during rollout.
    effectiveVolume: safeNumber(v.effectiveVolume, 100),
    volumeOverride: numOrNull(v.volumeOverride),
    lastSeen,
    // Reconcile against the heartbeat so a stale persisted ONLINE can't show as
    // online on the detail page (the endpoint serves the raw status, never
    // OFFLINE). `computedStatus ?? status` makes this a no-op pass-through the
    // day the backend serves a unified computedStatus on detail.
    status: reconcileStatus(v.computedStatus ?? v.status, lastSeen),
    activePlaylist: null,
    remoteCapability: sanitizeRemoteCapability(v.remoteCapability),
    reregistrationAllowedUntil: instantOrNull(v.reregistrationAllowedUntil),
  };
};

export const useDevice = (id: string | undefined): DeviceFetchState => {
  const [state, setState] = useState<DeviceFetchState>({ state: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ state: 'not-found' });
      return;
    }
    setState({ state: 'loading' });

    let cancelled = false;
    const controller = new AbortController();

    // Spec splits device-detail data across two endpoints: `/api/devices/{id}`
    // for the record, `/api/devices/{id}/playlist` for the active playlist.
    // We fetch in parallel and bake the playlist into DeviceDetail so the
    // existing UI keeps working with one state object.
    const detailPromise = http.get<unknown>(`/api/devices/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      _suppressErrorToast: true,
    });
    const playlistPromise = http
      .get<unknown>(`/api/devices/${encodeURIComponent(id)}/playlist`, {
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .catch(() => null);

    Promise.all([detailPromise, playlistPromise])
      .then(([detailRes, playlistRes]) => {
        if (cancelled) return;
        const device = sanitizeDevice(detailRes.data);
        if (!device) {
          setState({ state: 'error' });
          return;
        }
        const playlist =
          playlistRes && typeof playlistRes === 'object' && 'data' in playlistRes
            ? sanitizePlaylist((playlistRes as { data: unknown }).data)
            : null;
        setState({
          state: 'ready',
          device: { ...device, activePlaylist: playlist },
        });
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setState({ state: 'not-found' });
          return;
        }
        setState({ state: 'error' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  return state;
};
