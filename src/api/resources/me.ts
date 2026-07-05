// /api/me resource — typed wrapper around GET /api/me.
//
// **Audience.** AuthProvider calls this on successful login and on
// silent refresh to populate `user.profile` for display fields. This
// replaces the long-standing JWT-decoding shortcut in `src/api/auth.ts`
// `tokenToUser` as the **source of truth for username/role display**.
//
// **Authorization remains JWT-based.** The JWT is still the FE's
// authorization signal — route guards, role gating, etc. all read from
// `user.role`/`user.sub` (extracted from the JWT). `/api/me` is for
// **display fields only** (id, createdAt, the canonical username spelling
// the server has on file). Don't load-bear authorization decisions on
// fields that come from this endpoint; if the JWT says one role and
// `/me` says another, the JWT wins.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
import type { Role as WireRole } from './users';

/**
 * Mirror of the backend `MeResponse` record. Same shape as
 * `UserResponse` plus `createdAt` — typed separately to keep the
 * `/me` contract independent from the admin-list `/users` contract.
 */
export interface MeResponse {
  readonly id: number;
  readonly username: string;
  readonly role: WireRole;
  readonly active: boolean;
  readonly createdAt: string;
  /**
   * Recovery email on file, or `null` when none is set. Display-only — the
   * `/account` page prefills its recovery-email field from this and the
   * backend "Forgot password" flow uses it. Set/cleared via `PUT /api/me/email`.
   */
  readonly email: string | null;
  /**
   * Operator project-scoping hint. **Always present** — `[]` for
   * non-operators and for operators with no assignments. Display/scoping
   * only (populate project pickers + empty states); the backend enforces
   * the actual scope. Never load-bear authorization on this.
   */
  readonly assignedProjectIds: number[];
}

/**
 * GET /api/me. Returns the caller's own profile. 401 propagates via the
 * global response interceptor's normal refresh-and-retry path; if the
 * refresh itself fails, AuthProvider's silent-refresh effect already
 * tears down the session.
 */
export const getMe = async (): Promise<MeResponse> => {
  const { data } = await http.get<unknown>('/api/me');
  const v = (data ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(v.assignedProjectIds)
    ? v.assignedProjectIds.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : [];
  const email = typeof v.email === 'string' ? v.email : null;
  return { ...(data as MeResponse), email, assignedProjectIds: ids };
};
