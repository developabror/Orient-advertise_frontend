// Project ↔ operator assignment resource — typed wrappers around
// /api/projects/{projectId}/operators (project-centric, ADMIN-only).
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';

/** Mirror of backend OperatorRef. */
export interface OperatorRef {
  readonly userId: number;
  readonly username: string;
  readonly assignedAt: string;
  readonly assignedBy: string;
}

const parseOperatorRef = (raw: unknown): OperatorRef => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.userId !== 'number' || !Number.isFinite(v.userId)) throw new Error('userId');
  if (typeof v.username !== 'string') throw new Error('username');
  if (typeof v.assignedAt !== 'string') throw new Error('assignedAt');
  if (typeof v.assignedBy !== 'string') throw new Error('assignedBy');
  return { userId: v.userId, username: v.username, assignedAt: v.assignedAt, assignedBy: v.assignedBy };
};

const parseList = (data: unknown): OperatorRef[] =>
  Array.isArray(data) ? data.map(parseOperatorRef) : [];

/** GET /api/projects/{projectId}/operators → OperatorRef[]. 404 unknown project. */
export const getProjectOperators = async (projectId: number): Promise<OperatorRef[]> => {
  const { data } = await http.get<unknown>(`/api/projects/${String(projectId)}/operators`);
  return parseList(data);
};

/**
 * PUT /api/projects/{projectId}/operators with { userIds } — bulk "set the whole set".
 * Returns 200 + the full resulting OperatorRef[]. 409 if any userId is not role OPERATOR.
 */
export const setProjectOperators = async (
  projectId: number,
  userIds: readonly number[],
): Promise<OperatorRef[]> => {
  const { data } = await http.put<unknown>(`/api/projects/${String(projectId)}/operators`, {
    userIds: [...userIds],
  });
  return parseList(data);
};

/** POST /api/projects/{projectId}/operators/{userId} — single grant. 201; 409 duplicate / not OPERATOR. */
export const addProjectOperator = async (projectId: number, userId: number): Promise<void> => {
  await http.post(`/api/projects/${String(projectId)}/operators/${String(userId)}`);
};

/** DELETE /api/projects/{projectId}/operators/{userId} — idempotent 204. */
export const removeProjectOperator = async (projectId: number, userId: number): Promise<void> => {
  await http.delete(`/api/projects/${String(projectId)}/operators/${String(userId)}`);
};
