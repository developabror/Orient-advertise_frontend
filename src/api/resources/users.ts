// Users resource — typed wrappers around /api/users and /api/users/{id}.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves. All endpoints in this file require ADMIN — calling as a
// lower-privilege role surfaces as 403 via the interceptor's toast.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

/** Backend `Role` enum verbatim. */
export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'ADVERTISER';

/**
 * Mirror of the backend `UserResponse` record. `active: false` rows
 * (deactivated users) are returned by the list endpoint — the admin
 * UI needs them so the operator can re-enable.
 */
export interface UserResponse {
  readonly id: number;
  readonly username: string;
  readonly role: Role;
  readonly active: boolean;
  /** Recovery email on file, or `null` when none was set at create time. */
  readonly email: string | null;
}

/**
 * Mirror of the backend `UserDetailResponse` returned by
 * `GET /api/users/{userId}`. Adds `createdAt` to the summary fields —
 * useful for "user since …" copy on the access detail page.
 */
export interface UserDetailResponse {
  readonly id: number;
  readonly username: string;
  readonly role: Role;
  readonly active: boolean;
  readonly createdAt: string;
  /** Recovery email on file, or `null` when none is set. */
  readonly email: string | null;
}

/**
 * Body for POST /api/users. The backend hashes `password` server-side;
 * the FE never persists it (don't echo it back into a state store).
 */
export interface CreateUserRequest {
  readonly username: string;
  readonly password: string;
  readonly role: Role;
  /** Optional recovery email; the backend persists it when present. */
  readonly email?: string;
}

const isRole = (v: unknown): v is Role =>
  v === 'ADMIN' || v === 'OPERATOR' || v === 'VIEWER' || v === 'ADVERTISER';

const parseUserResponse = (raw: unknown): UserResponse => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.username !== 'string') throw new Error('username');
  if (!isRole(v.role)) throw new Error('role');
  if (typeof v.active !== 'boolean') throw new Error('active');
  const email = typeof v.email === 'string' ? v.email : null;
  return { id: v.id, username: v.username, role: v.role, active: v.active, email };
};

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * GET /api/users — paged list of users.
 *
 * **Includes deactivated rows** (`active: false`) so the admin UI can
 * manage them (re-activate, audit, etc.). Filter to active-only on the
 * client if your view needs it.
 *
 * Backend pagination is **0-indexed** (Spring convention) — `page: 0`
 * is the first page. Match that on the way in; UI components that
 * render 1-indexed page numbers adjust at the boundary, not here.
 */
export const listUsers = async (pageable: Pageable): Promise<Page<UserResponse>> => {
  const params = dropUndefined({
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/users', { params });
  return parsePage(data, parseUserResponse);
};

/**
 * POST /api/users.
 *
 * **409 on duplicate username** — surfaces as a thrown axios error.
 * The global response interceptor does NOT toast 4xx, so callers
 * should narrow on `err.response?.status === 409` and render an
 * inline form error on the username input ("That username is
 * already taken."), not a toast.
 */
export const createUser = async (req: CreateUserRequest): Promise<UserResponse> => {
  const { data } = await http.post<UserResponse>('/api/users', req);
  return data;
};

/**
 * GET /api/users/{userId} — fetch a single user's profile.
 *
 * **404** when the id is unknown or the user has been hard-deleted.
 * Surface as a "user not found" page state, not a toast — the global
 * response interceptor doesn't toast 4xx for the same reason.
 */
export const getUser = async (userId: number): Promise<UserDetailResponse> => {
  const { data } = await http.get<UserDetailResponse>(`/api/users/${String(userId)}`);
  return data;
};

/**
 * DELETE /api/users/{userId}.
 *
 * **Cascades on the backend**: any advertiser-content access rows for
 * this user are removed atomically. Callers don't need to walk
 * `listLinkedContent` and `unlinkContent` first.
 */
export const deleteUser = async (userId: number): Promise<void> => {
  await http.delete(`/api/users/${String(userId)}`);
};
