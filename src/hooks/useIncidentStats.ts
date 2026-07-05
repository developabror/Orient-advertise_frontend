import axios from 'axios';
import { useEffect, useState } from 'react';
import { http } from '@api/http';
import { wsClient } from '@api/wsClient';

export interface IncidentStats {
  readonly critical: number;
  readonly warning: number;
  readonly resolvedToday: number;
}

export interface IncidentStatsState {
  readonly stats: IncidentStats;
  readonly isLoading: boolean;
  readonly isStale: boolean;
}

const DEFAULT_STATS: IncidentStats = { critical: 0, warning: 0, resolvedToday: 0 };

const POLL_OPEN_MS = 60_000;
const POLL_FALLBACK_MS = 30_000;

// Spec exposes no /api/incidents/stats endpoint. We derive the live counts
// from /api/incidents/open with the priority filter — `resolvedToday` isn't
// available without a resolved-incidents endpoint and stays 0.
const countFromList = (data: unknown): number => {
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object' && data !== null) {
    const v = data as Record<string, unknown>;
    if (Array.isArray(v.data)) return v.data.length;
    if (typeof v.totalElements === 'number') return Math.max(0, Math.floor(v.totalElements));
  }
  return 0;
};

export const useIncidentStats = (): IncidentStatsState => {
  const [stats, setStats] = useState<IncidentStats>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollIntervalId: number | null = null;
    let pollIntervalMs = POLL_OPEN_MS;
    let currentController: AbortController | null = null;

    const fetchStats = async (): Promise<void> => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const [criticalRes, warningRes] = await Promise.all([
          http.get<unknown>('/api/incidents/open', {
            params: { priority: 'CRITICAL' },
            signal: controller.signal,
            _suppressErrorToast: true,
          }),
          http.get<unknown>('/api/incidents/open', {
            params: { priority: 'HIGH' },
            signal: controller.signal,
            _suppressErrorToast: true,
          }),
        ]);
        if (cancelled || controller.signal.aborted) return;
        setStats({
          critical: countFromList(criticalRes.data),
          warning: countFromList(warningRes.data),
          resolvedToday: 0,
        });
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
        void fetchStats();
      }, pollIntervalMs);
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
    const unsubIncident = wsClient.onEvent('INCIDENT_CRITICAL', () => {
      void fetchStats();
    });

    return () => {
      cancelled = true;
      currentController?.abort();
      if (pollIntervalId !== null) window.clearInterval(pollIntervalId);
      unsubStatus();
      unsubIncident();
    };
  }, []);

  return { stats, isLoading, isStale };
};
