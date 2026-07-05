import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import { wsClient, type DeviceStatusChangeEvent, type IncidentCriticalEvent } from '@api/wsClient';

export interface RegionStats {
  readonly id: string;
  readonly name: string;
  readonly total: number;
  readonly online: number;
}

export interface DashboardStats {
  readonly totalDevices: number;
  readonly onlineDevices: number;
  readonly offlineDevices: number;
  readonly openIncidents: number;
  readonly regions: readonly RegionStats[];
}

export interface DashboardState {
  readonly stats: DashboardStats;
  readonly lastUpdatedAt: Date | null;
  readonly isInitialLoading: boolean;
  readonly isStale: boolean;
}

const DEFAULT_STATS: DashboardStats = {
  totalDevices: 0,
  onlineDevices: 0,
  offlineDevices: 0,
  openIncidents: 0,
  regions: [],
};

const POLL_OPEN_MS = 60_000;
const POLL_FALLBACK_MS = 30_000;
const DEVICE_FLUSH_INTERVAL_MS = 1_000;

// The WS DTO carries the backend Device.Status enum verbatim (uppercase).
// Reuse `newStatus` so the type tracks the source of truth automatically.
type DeviceStatus = DeviceStatusChangeEvent['newStatus'];

const safeNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
};

// Spec response shape for GET /api/dashboard/summary:
//   { totalDevices, onlineCount, offlineCount, noContentCount,
//     openIncidents: { critical, warning },
//     regionSummary: [{ regionId, regionName, onlineCount, totalCount }] }
const sanitizeRegion = (value: unknown): RegionStats | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  // Numeric ids stringified for FE consistency.
  const id =
    typeof v.regionId === 'number'
      ? String(v.regionId)
      : typeof v.regionId === 'string'
        ? v.regionId
        : null;
  if (id === null) return null;
  if (typeof v.regionName !== 'string') return null;
  return {
    id,
    name: v.regionName,
    total: safeNumber(v.totalCount),
    online: safeNumber(v.onlineCount),
  };
};

const sanitizeRegions = (value: unknown): readonly RegionStats[] => {
  if (!Array.isArray(value)) return [];
  return value.map((r: unknown) => sanitizeRegion(r)).filter((r): r is RegionStats => r !== null);
};

const sanitize = (value: unknown): DashboardStats => {
  if (typeof value !== 'object' || value === null) return DEFAULT_STATS;
  const v = value as Record<string, unknown>;
  const incidents =
    typeof v.openIncidents === 'object' && v.openIncidents !== null
      ? (v.openIncidents as Record<string, unknown>)
      : {};
  return {
    totalDevices: safeNumber(v.totalDevices),
    onlineDevices: safeNumber(v.onlineCount),
    offlineDevices: safeNumber(v.offlineCount),
    // Open incidents = critical + warning. The dashboard card just shows the
    // total open count; severity split would be a richer panel.
    openIncidents: safeNumber(incidents.critical) + safeNumber(incidents.warning),
    regions: sanitizeRegions(v.regionSummary),
  };
};

export const useDashboardStats = (): DashboardState => {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentController: AbortController | null = null;
    let pollIntervalId: number | null = null;
    let pollIntervalMs = POLL_OPEN_MS;

    // Local trackers for optimistic updates between polls. Cleared each time a
    // server response lands so the server stays the source of truth and any
    // accumulated drift gets reset within one poll cycle.
    const knownStatuses = new Map<string, DeviceStatus>();
    const seenIncidentIds = new Set<string>();

    let deviceEventBuffer: DeviceStatusChangeEvent[] = [];
    let lastDeviceFlush = 0;
    let flushTimer: number | null = null;

    const fetchStats = async (): Promise<void> => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const { data } = await http.get<unknown>('/api/dashboard/summary', {
          signal: controller.signal,
          _suppressErrorToast: true,
        });
        if (cancelled || controller.signal.aborted) return;
        setStats(sanitize(data));
        setLastUpdatedAt(new Date());
        setIsStale(false);
        setIsInitialLoading(false);
        knownStatuses.clear();
        seenIncidentIds.clear();
      } catch (err) {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setIsStale(true);
        setIsInitialLoading(false);
      }
    };

    const startPolling = (): void => {
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      pollIntervalId = window.setInterval(() => {
        void fetchStats();
      }, pollIntervalMs);
    };

    const flushDeviceEvents = (): void => {
      const events = deviceEventBuffer;
      deviceEventBuffer = [];
      flushTimer = null;
      lastDeviceFlush = Date.now();
      if (events.length === 0) return;

      setStats((prev) => {
        let onlineDelta = 0;
        let offlineDelta = 0;
        for (const e of events) {
          // deviceId is `string | number` on the wire; coerce to string so the
          // Map identity is stable regardless of which form the backend emits.
          // Prefer the event's own oldStatus over our locally-tracked one when
          // present — it's authoritative for the transition the server saw.
          const key = String(e.deviceId);
          const tracked = knownStatuses.get(key);
          const old = tracked ?? e.oldStatus;
          knownStatuses.set(key, e.newStatus);
          if (old === 'ONLINE') onlineDelta -= 1;
          else if (old === 'OFFLINE') offlineDelta -= 1;
          if (e.newStatus === 'ONLINE') onlineDelta += 1;
          else if (e.newStatus === 'OFFLINE') offlineDelta += 1;
        }
        return {
          ...prev,
          onlineDevices: Math.max(0, prev.onlineDevices + onlineDelta),
          offlineDevices: Math.max(0, prev.offlineDevices + offlineDelta),
        };
      });
    };

    const handleDeviceEvent = (e: DeviceStatusChangeEvent): void => {
      deviceEventBuffer.push(e);
      const elapsed = Date.now() - lastDeviceFlush;
      if (elapsed >= DEVICE_FLUSH_INTERVAL_MS) {
        flushDeviceEvents();
        return;
      }
      flushTimer ??= window.setTimeout(flushDeviceEvents, DEVICE_FLUSH_INTERVAL_MS - elapsed);
    };

    const handleIncidentEvent = (e: IncidentCriticalEvent): void => {
      // incidentId is numeric on the wire; the seen-set is keyed by string
      // so it interoperates with REST-derived dedupe sets elsewhere.
      const id = String(e.incidentId);
      if (seenIncidentIds.has(id)) return;
      seenIncidentIds.add(id);
      setStats((prev) => ({ ...prev, openIncidents: prev.openIncidents + 1 }));
    };

    void fetchStats();
    startPolling();

    const unsubStatus = wsClient.onStatus((status) => {
      const next = status === 'open' ? POLL_OPEN_MS : POLL_FALLBACK_MS;
      if (next !== pollIntervalMs) {
        pollIntervalMs = next;
        startPolling();
      }
    });
    const unsubDevice = wsClient.onEvent('DEVICE_STATUS_CHANGE', handleDeviceEvent);
    const unsubIncident = wsClient.onEvent('INCIDENT_CRITICAL', handleIncidentEvent);

    return () => {
      cancelled = true;
      currentController?.abort();
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      unsubStatus();
      unsubDevice();
      unsubIncident();
    };
  }, []);

  return { stats, lastUpdatedAt, isInitialLoading, isStale };
};
