// Incidents resource — typed wrappers around /api/incidents/*.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.
//
// Timestamp fields on IncidentDto are kept as ISO-8601 strings (Jackson's
// default serialization). Date conversion belongs in the rendering layer:
// keeping the wire shape on the data model means the same DTO survives
// IndexedDB caching, structuredClone, and JSON.stringify round-trips
// without lossy conversion.

import { criticalAlerts } from '../criticalAlerts';
import { http } from '../http';
import type { IncidentPriority, IncidentStatus } from '../wsClient';

/**
 * Mirrors the backend `IncidentDto` Java record. Re-uses the shared
 * status/priority unions from wsClient so the WS event payload and the
 * REST response can never drift on the enum surface.
 */
export interface IncidentDto {
  readonly id: number;
  readonly deviceId: number;
  readonly eventType: string;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly description: string;
  readonly occurrenceCount: number;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

/**
 * GET /api/incidents/open[?priority=…].
 *
 * Returns the full open-incident list — this endpoint is NOT paged.
 * `priority` is optional; when omitted, no query string is sent (axios
 * skips undefined params, but we also skip the `params` object entirely
 * to keep the request URL clean for log readability).
 */
export const listOpenIncidents = async (
  priority?: IncidentPriority,
): Promise<IncidentDto[]> => {
  const config = priority !== undefined ? { params: { priority } } : undefined;
  const { data } = await http.get<IncidentDto[]>('/api/incidents/open', config);
  return data;
};

/**
 * POST /api/incidents/{id}/acknowledge.
 *
 * The server returns **409 Conflict** when the incident has already been
 * acknowledged or resolved. The 409 surfaces as a thrown axios error —
 * callers should narrow on `err.response?.status === 409` to show an
 * inline "already acknowledged" message instead of a generic error:
 *
 * ```ts
 * try {
 *   await acknowledgeIncident(id);
 * } catch (err) {
 *   if (axios.isAxiosError(err) && err.response?.status === 409) {
 *     // race with another operator — refresh and tell the user
 *   }
 *   throw err;
 * }
 * ```
 *
 * The global axios response interceptor does NOT toast 4xx by default
 * (only 401/403/503/5xx), so callers can render their own inline UI
 * without fighting a competing notification.
 */
export const acknowledgeIncident = async (id: number): Promise<IncidentDto> => {
  const { data } = await http.post<IncidentDto>(`/api/incidents/${String(id)}/acknowledge`);
  return data;
};

/**
 * POST /api/incidents/{id}/resolve.
 *
 * Same 409 contract as {@link acknowledgeIncident} — see its JSDoc.
 *
 * On success, also dismisses the incident from the in-memory
 * `criticalAlerts` store so the critical-alert bar updates immediately
 * (instead of waiting for the WS `INCIDENT_UPDATED` event to arrive).
 *
 * The dismiss is keyed by the **stringified** id because the alert store
 * uses string keys: WS handlers add alerts with the wire-shape
 * `incidentId` which is already a string, so the resolve path must
 * stringify the numeric REST id to match.
 */
export const resolveIncident = async (id: number): Promise<IncidentDto> => {
  const { data } = await http.post<IncidentDto>(`/api/incidents/${String(id)}/resolve`);
  criticalAlerts.dismiss(String(id));
  return data;
};
