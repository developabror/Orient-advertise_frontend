// Dashboard resource — typed wrapper around GET /api/dashboard/summary.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves. Setting it here would mask token-rotation bugs and create
// per-resource drift.

import { http } from '../http';

/**
 * Per-region online-vs-total breakdown. `regionId` is a backend Long, not
 * stringified — the dashboard endpoint emits raw numeric ids.
 */
export interface RegionSummary {
  readonly regionId: number;
  readonly regionName: string;
  readonly onlineCount: number;
  readonly totalCount: number;
}

/**
 * Open incidents split by severity bucket. The backend rolls HIGH+CRITICAL
 * into `critical` and MEDIUM+LOW into `warning`; INFO never opens an
 * incident so it isn't represented here.
 */
export interface OpenIncidentCounts {
  readonly critical: number;
  readonly warning: number;
}

/**
 * Aggregated dashboard summary — the single payload that drives the
 * operator dashboard's status cards and the regional breakdown panel.
 *
 * All counts are guaranteed non-null by the backend (zero-filled across
 * every status bucket and region), so each is a plain `number` rather
 * than `number | null`. Cached server-side for ~30 seconds.
 */
export interface DashboardSummary {
  readonly totalDevices: number;
  readonly onlineCount: number;
  readonly offlineCount: number;
  readonly noContentCount: number;
  readonly openIncidents: OpenIncidentCounts;
  readonly regionSummary: readonly RegionSummary[];
}

/**
 * GET /api/dashboard/summary — returns the response body verbatim. The
 * caller gets exactly what the backend sent, type-asserted to
 * {@link DashboardSummary}. Any error (4xx/5xx, network drop) propagates
 * unchanged so the global axios interceptor can surface it.
 */
export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const { data } = await http.get<DashboardSummary>('/api/dashboard/summary');
  return data;
};
