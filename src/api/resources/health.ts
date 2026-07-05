// Health resource — typed wrapper around GET /api/health.
//
// **Permitted-all on the backend.** No auth is required, so this
// endpoint also serves as a smoke test before the user logs in. The
// global http instance still attaches an Authorization header when a
// token happens to be in `tokenStore` — that's harmless (the backend
// ignores it for permitAll endpoints) so we don't bypass `http` here.
//
// **Spec divergence note.** The shape mirrors the actual openapi.json
// HealthResponse / ComponentStatus schemas:
//   - top-level field is `overallStatus` (NOT `status`)
//   - per-component field is `timestamp` (NOT `details`)
// If you're hunting for a `status` or `details` key based on a stale
// design doc, that's why you can't find it.

import { http } from '../http';

/**
 * Backend health-result status. Bounded enum — kept as a strict union
 * so consumers can render a status badge without a default branch.
 * (Per-component status is a separate, broader enum and stays a plain
 * string — see {@link ComponentStatus}.)
 */
export type HealthStatus = 'UP' | 'DEGRADED' | 'DOWN';

/**
 * Per-subsystem health row. `status` is plain `string` rather than the
 * top-level union because individual components can be in richer
 * states (e.g. `'INITIALISING'`, `'PARTIAL'`) that don't apply to the
 * overall rollup.
 */
export interface ComponentStatus {
  readonly name: string;
  readonly status: string;
  readonly timestamp: string;
}

/**
 * Mirror of the backend `HealthResponse` record. `components` is the
 * per-subsystem breakdown the rollup is computed from.
 */
export interface HealthResponse {
  readonly overallStatus: HealthStatus;
  readonly components: readonly ComponentStatus[];
}

/**
 * GET /api/health.
 *
 * Returns the rollup status plus the per-component breakdown the
 * backend's `HealthService.checkAll()` produced. Verbatim pass-through —
 * no defaulting on missing fields, no status-string narrowing at this
 * layer (the type system covers the happy path; an off-spec server
 * response is a server bug worth surfacing).
 *
 * Useful in two contexts:
 *   1. **Pre-login smoke test** — the page can show a "service
 *      unavailable" banner before the user attempts a login if the
 *      rollup is `DOWN`.
 *   2. **Operator status page** — admin UI lists each component with
 *      its individual status + timestamp.
 */
export const getHealth = async (): Promise<HealthResponse> => {
  const { data } = await http.get<HealthResponse>('/api/health');
  return data;
};
