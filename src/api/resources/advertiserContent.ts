// Advertiser content access resource — typed wrappers around
// /api/users/{userId}/content and /api/users/{userId}/content/{contentFileId}.
//
// "Advertiser content access" is the link between an ADVERTISER user and
// the specific content files they may view stats for. ADMIN scopes the
// links; the advertiser sees only what's been linked to them.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';

/**
 * Mirror of the backend `LinkedContent` record. `status` is kept as
 * plain `string` (UPPERCASE on the wire — `READY`, `TRANSCODING`,
 * `FAILED`, `INVALID`, `UPLOADING`, etc.) because the access UI only
 * cares about a coarse "ready vs warning" split, and a server-side
 * status addition shouldn't drop rows from the FE.
 */
export interface LinkedContent {
  readonly id: number;
  readonly name: string;
  readonly status: string;
}

/**
 * GET /api/users/{userId}/content.
 *
 * Returns the list of content files this advertiser is linked to.
 * **Always returns an array** — an empty array (not 404) when the user
 * has no links yet, so callers can render an empty state without
 * branching on error vs empty.
 *
 * Not paged — the access list per user is small in practice (≤100
 * typical). Switch to a paged endpoint if that ever changes.
 */
export const listLinkedContent = async (userId: number): Promise<LinkedContent[]> => {
  const { data } = await http.get<LinkedContent[]>(
    `/api/users/${String(userId)}/content`,
  );
  return data;
};

/**
 * POST /api/users/{userId}/content/{contentFileId} — grant an
 * advertiser access to a content file. **No request body** — the link
 * is fully described by the path.
 *
 * **409 contracts** (both surface as a thrown axios error; the global
 * response interceptor does NOT toast 4xx, so callers render their own
 * inline messaging):
 *
 *   1. **Duplicate link** — the user already has this content linked.
 *      Idempotent semantics aren't applied to create (only delete) so
 *      the caller should treat duplicate as a no-op for UI purposes.
 *   2. **Non-ADVERTISER target** — the target user's role is not
 *      ADVERTISER. The link is what scopes the advertiser dashboard's
 *      content list, so linking a non-advertiser is meaningless.
 *
 * Both narrow on `err.response?.status === 409`; inspect
 * `err.response.data.message` to distinguish the two cases.
 */
export const linkContent = async (
  userId: number,
  contentFileId: number,
): Promise<void> => {
  await http.post(
    `/api/users/${String(userId)}/content/${String(contentFileId)}`,
  );
};

/**
 * DELETE /api/users/{userId}/content/{contentFileId} — revoke access.
 * **Idempotent** — the server returns 204 whether or not the link
 * existed. Callers don't need to check `listLinkedContent` first.
 */
export const unlinkContent = async (
  userId: number,
  contentFileId: number,
): Promise<void> => {
  await http.delete(
    `/api/users/${String(userId)}/content/${String(contentFileId)}`,
  );
};
