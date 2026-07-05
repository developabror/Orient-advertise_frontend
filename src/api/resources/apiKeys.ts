// API keys resource — typed wrappers around /api/admin/api-keys.
// ADMIN-only; non-ADMIN callers surface as 403 via the global toast.
//
// **SECURITY: handling raw API keys.**
//
// The plaintext key returned by `mintApiKey` (`CreatedKey.rawKey`) is the
// only time the FE — or anyone — will ever see that value. The backend
// stores it as a SHA-256 hash; on any subsequent listing endpoint only
// the prefix is exposed.
//
// This resource layer DELIBERATELY does the minimum: fetch, return,
// forget. It does NOT:
//   - log the rawKey (no console.* calls, no telemetry)
//   - persist the rawKey to any global store / tokenStore / localStorage
//   - include the rawKey in any error reporting payload
//
// The component that consumes `mintApiKey` MUST surface the key in a
// one-time copy-to-clipboard dialog with an explicit warning that the
// value cannot be recovered. After that dialog closes, the value should
// be released for garbage collection — do not stash it in component
// state that outlives the dialog.

import { http } from '../http';

/** Backend API-key lifecycle status. */
export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';

/**
 * Mirror of the backend `ApiKeySummary` record. `revokedAt` and
 * `revokedBy` are non-null only when `status === 'REVOKED'` — they
 * carry the audit trail for who revoked the key and when.
 */
export interface ApiKeySummary {
  readonly id: number;
  readonly prefix: string;
  readonly clientName: string;
  readonly status: ApiKeyStatus;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

/**
 * Mirror of the backend `CreatedKey` record. **`rawKey` is the
 * plaintext API key** — see the file-level SECURITY note. The backend
 * returns it once and only at creation; the FE must surface it
 * immediately in a one-time dialog and then release the reference.
 */
export interface CreatedKey {
  readonly id: number;
  readonly rawKey: string;
  readonly prefix: string;
  readonly clientName: string;
  readonly createdAt: string;
}

/** GET /api/admin/api-keys — full list, including revoked rows. */
export const listApiKeys = async (): Promise<ApiKeySummary[]> => {
  const { data } = await http.get<ApiKeySummary[]>('/api/admin/api-keys');
  return data;
};

/**
 * POST /api/admin/api-keys body `{ clientName }`.
 *
 * **Returns `CreatedKey.rawKey` exactly once.** See the file-level
 * SECURITY note. The caller is responsible for:
 *   1. Showing the value in a copy-to-clipboard dialog with a clear
 *      "this cannot be recovered" warning.
 *   2. Releasing the reference (don't stash it in long-lived state).
 *   3. NOT including it in any analytics, error reporting, or log
 *      payload.
 *
 * This function intentionally does no logging or post-processing of
 * the response — straight pass-through from the wire — so the rawKey
 * never enters any side-effect path inside the resource layer.
 */
export const mintApiKey = async (clientName: string): Promise<CreatedKey> => {
  const { data } = await http.post<CreatedKey>('/api/admin/api-keys', { clientName });
  return data;
};

/**
 * DELETE /api/admin/api-keys/{id} — revoke an API key.
 *
 * **Irreversible.** The calling UI MUST require a confirmation dialog
 * before invoking this; revoking a key in active use will break the
 * integration immediately and there is no un-revoke path.
 *
 * Returns the updated `ApiKeySummary` (with `status: 'REVOKED'` and
 * the audit fields populated) so the caller can update its row in
 * place without re-fetching the list.
 *
 * **409 on already-revoked.** Surfaces as a thrown axios error; the
 * global response interceptor does NOT toast 4xx, so callers should
 * narrow on `err.response?.status === 409` and render an inline
 * "Already revoked" message rather than a toast — the operator likely
 * just clicked twice.
 */
export const revokeApiKey = async (id: number): Promise<ApiKeySummary> => {
  const { data } = await http.delete<ApiKeySummary>(
    `/api/admin/api-keys/${String(id)}`,
  );
  return data;
};
