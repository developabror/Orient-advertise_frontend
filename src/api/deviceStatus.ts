// Single source of truth for FE device-status handling.
//
// The backend `Device.Status` enum is ONLINE | OFFLINE | NO_CONTENT |
// UNREGISTERED (see resources/_enums.ts). The FE renders kebab-case variants
// and adds an 'unknown' fallback for unexpected wire values — it deliberately
// does NOT invent a 'degraded' state the backend can never emit (the old code
// folded NO_CONTENT/UNREGISTERED into 'degraded', hiding the real state).
//
// Every status surface (list, detail, assign-content preview, the status
// filter) routes through this module so they can't drift apart.

export type DeviceStatus = 'online' | 'offline' | 'no-content' | 'unregistered' | 'unknown';

// 15-minute heartbeat window + 60s grace, matching the backend's offline
// computation. A device whose last heartbeat is older than this — or which
// never sent one — is offline regardless of its persisted `status`, which the
// detail endpoint currently serves stale as ONLINE (it's set at registration
// and never moved to OFFLINE). See reconcileStatus.
export const OFFLINE_THRESHOLD_MS = 16 * 60 * 1000;

/** Map a raw backend status string to the FE union. Unknown values are honest
 * about being unknown rather than guessing a healthy/unhealthy state. */
export const mapStatus = (raw: unknown): DeviceStatus => {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  switch (s) {
    case 'ONLINE':
      return 'online';
    case 'OFFLINE':
      return 'offline';
    case 'NO_CONTENT':
      return 'no-content';
    case 'UNREGISTERED':
      return 'unregistered';
    default:
      return 'unknown';
  }
};

/**
 * Heartbeat-reconciled status. If the device hasn't reported a heartbeat within
 * {@link OFFLINE_THRESHOLD_MS} (or never has, or the timestamp is unparseable),
 * it's offline no matter what the raw status says — this is the immediate
 * FE-only fix for the detail endpoint's phantom ONLINE. Otherwise the raw
 * status is trusted via {@link mapStatus}.
 *
 * Pass the backend's `computedStatus ?? status` as `raw` so that once the
 * backend serves a unified `computedStatus` on the detail endpoint this needs
 * no further change — a healthy device's NO_CONTENT/UNREGISTERED flows straight
 * through.
 */
export const reconcileStatus = (
  raw: unknown,
  lastHeartbeatAt: string | null,
  now: number = Date.now(),
): DeviceStatus => {
  if (lastHeartbeatAt === null) return 'offline';
  const last = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(last) || now - last > OFFLINE_THRESHOLD_MS) return 'offline';
  return mapStatus(raw);
};

/** Operator-facing label for every FE status, including the 'unknown' fallback. */
export const STATUS_LABELS: Record<DeviceStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  'no-content': 'No content',
  unregistered: 'Unregistered',
  unknown: 'Unknown',
};

/**
 * FE status-filter value → backend enum. Only the four real server states are
 * filterable (each maps 1:1); 'unknown' is a render-only fallback and is never
 * offered as a filter, so it's intentionally absent here.
 */
export const STATUS_FILTER_TO_API: Record<string, string> = {
  online: 'ONLINE',
  offline: 'OFFLINE',
  'no-content': 'NO_CONTENT',
  unregistered: 'UNREGISTERED',
};

/** Options for the device-list status `<Select>` — the four filterable states. */
export const STATUS_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'no-content', label: 'No content' },
  { value: 'unregistered', label: 'Unregistered' },
];

/**
 * Options for the device-list "Active playlist" `<Select>`. The friendly enum
 * `assigned | unassigned` lives in the URL + Select; `useDevices` maps it to the
 * wire's tri-state boolean `hasActivePlaylist` (`true` / `false` / omitted). This
 * FE-enum ↔ BE-boolean split keeps the URL readable (no `?…=true`) and is
 * deliberately distinct from the device-group `unassigned` membership param.
 */
export const PLAYLIST_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All playlists' },
  { value: 'assigned', label: 'Has playlist' },
  { value: 'unassigned', label: 'No playlist' },
];
