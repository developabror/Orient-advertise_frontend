import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import { wsClient, type IncidentCriticalEvent } from '@api/wsClient';

export type IncidentFilter = 'all' | 'critical' | 'warning' | 'resolved';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type IncidentRowPriority = 'critical' | 'high' | 'medium' | 'low';

export interface FullIncident {
  readonly id: string;
  readonly priority: IncidentRowPriority;
  readonly deviceId: string;
  readonly facility: string;
  readonly occurredAt: string;
  readonly status: IncidentStatus;
  readonly message: string;
}

export interface UseIncidentsResult {
  readonly incidents: readonly FullIncident[];
  readonly isLoading: boolean;
  readonly isStale: boolean;
  readonly acknowledge: (id: string) => Promise<void>;
  readonly resolve: (id: string) => Promise<void>;
}

const POLL_OPEN_MS = 60_000;
const POLL_FALLBACK_MS = 30_000;

const mapPriority = (raw: unknown): IncidentRowPriority | null => {
  if (typeof raw !== 'string') return null;
  const v = raw.toUpperCase();
  if (v === 'CRITICAL') return 'critical';
  if (v === 'HIGH') return 'high';
  if (v === 'MEDIUM') return 'medium';
  if (v === 'LOW' || v === 'INFO') return 'low';
  return null;
};

const mapStatus = (raw: unknown): IncidentStatus => {
  if (typeof raw !== 'string') return 'open';
  const v = raw.toUpperCase();
  if (v === 'ACKNOWLEDGED') return 'acknowledged';
  if (v === 'RESOLVED') return 'resolved';
  return 'open';
};

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

// Spec IncidentDto: { id, deviceId, eventType, status, priority, description,
// occurrenceCount, openedAt, updatedAt, acknowledgedAt, ... }. There is no
// facility on the DTO; the FE shows '—' for that column.
const sanitize = (v: unknown): FullIncident | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = idStr(r.id);
  const deviceId = idStr(r.deviceId);
  const priority = mapPriority(r.priority);
  if (id === null || deviceId === null || priority === null) return null;
  const occurredAt =
    typeof r.openedAt === 'string'
      ? r.openedAt
      : typeof r.occurredAt === 'string'
        ? r.occurredAt
        : '';
  if (occurredAt === '') return null;
  return {
    id,
    priority,
    deviceId,
    facility: typeof r.facility === 'string' ? r.facility : '—',
    occurredAt,
    status: mapStatus(r.status),
    message:
      typeof r.description === 'string'
        ? r.description
        : typeof r.message === 'string'
          ? r.message
          : '',
  };
};

const sanitizeList = (data: unknown): readonly FullIncident[] => {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (typeof data === 'object' && data !== null) {
    const inner = (data as Record<string, unknown>).data;
    if (Array.isArray(inner)) arr = inner;
  }
  const out: FullIncident[] = [];
  for (const r of arr) {
    const s = sanitize(r);
    if (s) out.push(s);
  }
  return out;
};

// Spec only exposes /api/incidents/open with optional ?priority=. There's no
// resolved-incidents endpoint; the "Resolved" tab is rendered empty until the
// backend grows pagination support.
const filterParams = (filter: IncidentFilter): Record<string, string> => {
  switch (filter) {
    case 'critical':
      return { priority: 'CRITICAL' };
    case 'warning':
      // Spec accepts a single priority. HIGH is the closest to "warning";
      // MEDIUM lives in the All tab.
      return { priority: 'HIGH' };
    case 'resolved':
    case 'all':
      return {};
  }
};

const matchesFilter = (incident: FullIncident, filter: IncidentFilter): boolean => {
  if (filter === 'resolved') return incident.status === 'resolved';
  if (incident.status === 'resolved') return false;
  if (filter === 'all') return true;
  if (filter === 'critical') return incident.priority === 'critical';
  return incident.priority === 'high' || incident.priority === 'medium';
};

const incidentFromEvent = (e: IncidentCriticalEvent): FullIncident => ({
  // Backend `IncidentPayload` carries numeric ids; stringify at the
  // FE boundary to match the rest of the FullIncident wire shape.
  id: String(e.incidentId),
  priority: 'critical',
  deviceId: String(e.deviceId),
  // Facility isn't carried by the event payload; '—' until the next refetch.
  facility: '—',
  occurredAt: e.openedAt,
  status: 'open',
  message: e.description,
});

export const useIncidents = (filter: IncidentFilter): UseIncidentsResult => {
  const [incidents, setIncidents] = useState<readonly FullIncident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  // Fetch + adaptive polling, scoped to the current filter.
  useEffect(() => {
    let cancelled = false;
    let pollIntervalId: number | null = null;
    let pollIntervalMs = POLL_OPEN_MS;
    let currentController: AbortController | null = null;
    setIsLoading(true);

    const fetchList = async (): Promise<void> => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        if (filter === 'resolved') {
          // No backend endpoint for resolved incidents — leave the list empty.
          if (!cancelled) {
            setIncidents([]);
            setIsStale(false);
            setIsLoading(false);
          }
          return;
        }
        const { data } = await http.get<unknown>('/api/incidents/open', {
          params: filterParams(filter),
          signal: controller.signal,
          _suppressErrorToast: true,
        });
        if (cancelled || controller.signal.aborted) return;
        setIncidents(sanitizeList(data));
        setIsStale(false);
        setIsLoading(false);
      } catch (err: unknown) {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setIsStale(true);
        setIsLoading(false);
      }
    };

    const startPolling = (): void => {
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      pollIntervalId = window.setInterval(() => {
        void fetchList();
      }, pollIntervalMs);
    };

    void fetchList();
    startPolling();

    const unsubStatus = wsClient.onStatus((status) => {
      const next = status === 'open' ? POLL_OPEN_MS : POLL_FALLBACK_MS;
      if (next !== pollIntervalMs) {
        pollIntervalMs = next;
        startPolling();
      }
    });

    return () => {
      cancelled = true;
      currentController?.abort();
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      unsubStatus();
    };
  }, [filter]);

  // WS prepend: only when the incoming event matches the current filter.
  useEffect(() => {
    return wsClient.onEvent('INCIDENT_CRITICAL', (e) => {
      const incident = incidentFromEvent(e);
      if (!matchesFilter(incident, filter)) return;
      setIncidents((prev) => {
        if (prev.some((i) => i.id === incident.id)) return prev;
        return [incident, ...prev];
      });
    });
  }, [filter]);

  const acknowledge = useCallback(async (id: string): Promise<void> => {
    // Optimistic: flip status before the request so the UI reacts instantly.
    // Wrapper object (vs bare `let`) so TS doesn't narrow `value` to its
    // initialization value after the setIncidents callback returns.
    const snapshot: { value: FullIncident | null } = { value: null };
    setIncidents((prev) => {
      const found = prev.find((i) => i.id === id);
      if (!found || found.status === 'acknowledged') return prev;
      snapshot.value = found;
      return prev.map((i) => (i.id === id ? { ...i, status: 'acknowledged' } : i));
    });

    try {
      await http.post(`/api/incidents/${id}/acknowledge`, undefined, {
        _suppressErrorToast: true,
      });
    } catch (err: unknown) {
      // 409 means another operator already did this — the server's state
      // matches our optimistic state, so we keep it and let the caller
      // surface a tailored "already acknowledged by X" message.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        throw err;
      }
      // Anything else: roll back to the captured snapshot.
      const restore = snapshot.value;
      if (restore !== null) {
        setIncidents((prev) => prev.map((i) => (i.id === id ? restore : i)));
      }
      throw err;
    }
  }, []);

  const resolve = useCallback(
    async (id: string): Promise<void> => {
      const snapshot: { value: FullIncident | null; index: number } = {
        value: null,
        index: -1,
      };
      setIncidents((prev) => {
        const idx = prev.findIndex((i) => i.id === id);
        if (idx < 0) return prev;
        snapshot.value = prev[idx] ?? null;
        snapshot.index = idx;
        if (filter === 'resolved') {
          return prev.map((i) => (i.id === id ? { ...i, status: 'resolved' } : i));
        }
        return prev.filter((i) => i.id !== id);
      });

      try {
        await http.post(`/api/incidents/${id}/resolve`, undefined, {
          _suppressErrorToast: true,
        });
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          // Server says it's already resolved — keep optimistic state.
          throw err;
        }
        const restore = snapshot.value;
        const restoreIndex = snapshot.index;
        if (restore !== null) {
          setIncidents((prev) => {
            if (filter === 'resolved') {
              return prev.map((i) => (i.id === id ? restore : i));
            }
            // Re-insert at (or near) the original position so the list
            // doesn't reshuffle visibly on revert.
            const next = [...prev];
            next.splice(Math.min(restoreIndex, next.length), 0, restore);
            return next;
          });
        }
        throw err;
      }
    },
    [filter],
  );

  return { incidents, isLoading, isStale, acknowledge, resolve };
};
