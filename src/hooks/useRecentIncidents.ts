import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import { wsClient, type IncidentCriticalEvent } from '@api/wsClient';

export type IncidentPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Incident {
  readonly id: string;
  readonly priority: IncidentPriority;
  readonly deviceId: string;
  readonly facility: string;
  readonly occurredAt: string;
}

export interface RecentIncidentsState {
  readonly incidents: readonly Incident[];
  readonly isInitialLoading: boolean;
  readonly isStale: boolean;
}

const POLL_OPEN_MS = 60_000;
const POLL_FALLBACK_MS = 30_000;
const MAX_VISIBLE = 5;

const PRIORITY_ORDER: Record<IncidentPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const isPriority = (v: unknown): v is IncidentPriority =>
  v === 'critical' || v === 'high' || v === 'medium' || v === 'low';

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const mapPriority = (raw: unknown): Incident['priority'] | null => {
  if (typeof raw !== 'string') return null;
  const v = raw.toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  if (raw === 'INFO') return 'low';
  return null;
};

// Spec IncidentDto: { id (number), deviceId (number), eventType, status,
// priority (UPPER), description, occurrenceCount, openedAt, ... }. No facility
// on the wire — the dashboard card shows '—' for that column.
const sanitizeIncident = (value: unknown): Incident | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = idStr(v.id);
  const deviceId = idStr(v.deviceId);
  const priority = mapPriority(v.priority);
  if (id === null || deviceId === null || priority === null) return null;
  const occurredAt =
    typeof v.openedAt === 'string'
      ? v.openedAt
      : typeof v.occurredAt === 'string'
        ? v.occurredAt
        : '';
  if (occurredAt === '') return null;
  void isPriority;
  return {
    id,
    priority,
    deviceId,
    facility: typeof v.facility === 'string' ? v.facility : '—',
    occurredAt,
  };
};

const sortIncidents = (items: readonly Incident[]): readonly Incident[] => {
  return [...items].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    if (a.occurredAt > b.occurredAt) return -1;
    if (a.occurredAt < b.occurredAt) return 1;
    return 0;
  });
};

const sanitize = (value: unknown): readonly Incident[] => {
  let arr: unknown[] = [];
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'object' && value !== null) {
    const inner = (value as Record<string, unknown>).data;
    if (Array.isArray(inner)) arr = inner;
  }
  const sanitized: Incident[] = [];
  for (const item of arr) {
    const parsed = sanitizeIncident(item);
    if (parsed) sanitized.push(parsed);
  }
  return sortIncidents(sanitized).slice(0, MAX_VISIBLE);
};

const incidentFromEvent = (e: IncidentCriticalEvent): Incident => ({
  // Backend `IncidentPayload` carries numeric ids; stringify at the
  // FE boundary so the row key matches the REST-fetched rows.
  id: String(e.incidentId),
  priority: 'critical',
  deviceId: String(e.deviceId),
  // Facility isn't carried by the event; placeholder until next poll fills it.
  facility: '—',
  occurredAt: e.openedAt,
});

export const useRecentIncidents = (): RecentIncidentsState => {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentController: AbortController | null = null;
    let pollIntervalId: number | null = null;
    let pollIntervalMs = POLL_OPEN_MS;

    const fetchIncidents = async (): Promise<void> => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        // Spec: only `/api/incidents/open` exists; status / sort / size aren't
        // accepted server-side, so we trim/sort the returned array on the FE.
        const { data } = await http.get<unknown>('/api/incidents/open', {
          signal: controller.signal,
          _suppressErrorToast: true,
        });
        if (cancelled || controller.signal.aborted) return;
        setIncidents(sanitize(data));
        setIsStale(false);
        setIsInitialLoading(false);
      } catch (err) {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setIsStale(true);
        setIsInitialLoading(false);
      }
    };

    const startPolling = (): void => {
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      pollIntervalId = window.setInterval(() => {
        void fetchIncidents();
      }, pollIntervalMs);
    };

    const handleIncident = (e: IncidentCriticalEvent): void => {
      const newRow = incidentFromEvent(e);
      setIncidents((prev) => {
        if (prev.some((i) => i.id === newRow.id)) return prev;
        return sortIncidents([newRow, ...prev]).slice(0, MAX_VISIBLE);
      });
    };

    void fetchIncidents();
    startPolling();

    const unsubStatus = wsClient.onStatus((status) => {
      const next = status === 'open' ? POLL_OPEN_MS : POLL_FALLBACK_MS;
      if (next !== pollIntervalMs) {
        pollIntervalMs = next;
        startPolling();
      }
    });
    const unsubIncident = wsClient.onEvent('INCIDENT_CRITICAL', handleIncident);

    return () => {
      cancelled = true;
      currentController?.abort();
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      unsubStatus();
      unsubIncident();
    };
  }, []);

  return { incidents, isInitialLoading, isStale };
};
