// Operator content access resource — typed wrappers around
// /api/users/{userId}/operator-content and
// /api/users/{userId}/operator-content/{contentFileId}.
//
// Mirror of advertiserContent.ts. "Operator content access" is the link
// between an OPERATOR user and the specific content files an ADMIN has
// granted them to view/stream regardless of project assignment. Distinct
// path (`operator-content`) from the advertiser one (`content`) so the
// two grant mechanisms never collide.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';
export type { LinkedContent } from './advertiserContent';
import type { LinkedContent } from './advertiserContent';

/** GET /api/users/{userId}/operator-content — always an array (empty, not 404, when no grants). */
export const listLinkedOperatorContent = async (userId: number): Promise<LinkedContent[]> => {
  const { data } = await http.get<LinkedContent[]>(
    `/api/users/${String(userId)}/operator-content`,
  );
  return data;
};

/** POST /api/users/{userId}/operator-content/{contentFileId} — no body. 409 on duplicate or non-OPERATOR target. */
export const linkOperatorContent = async (
  userId: number,
  contentFileId: number,
): Promise<void> => {
  await http.post(
    `/api/users/${String(userId)}/operator-content/${String(contentFileId)}`,
  );
};

/** DELETE /api/users/{userId}/operator-content/{contentFileId} — idempotent (204 either way). */
export const unlinkOperatorContent = async (
  userId: number,
  contentFileId: number,
): Promise<void> => {
  await http.delete(
    `/api/users/${String(userId)}/operator-content/${String(contentFileId)}`,
  );
};
