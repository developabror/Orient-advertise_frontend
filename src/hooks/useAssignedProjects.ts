import { useAuth } from './useAuth';

export interface AssignedProjectsState {
  /** True only for operator-only callers (role === 'operator'). */
  readonly isOperator: boolean;
  /** Assigned project ids; [] for non-operators or unassigned operators. */
  readonly projectIds: readonly number[];
  /**
   * True once we know the scope to apply:
   *  - non-operators: always true (no scoping, render immediately)
   *  - operators: true only after /api/me profile has resolved
   * Operator pages MUST hold their scoped render until this is true to
   * avoid an unfiltered flash before the profile lands.
   */
  readonly scopeResolved: boolean;
}

export const useAssignedProjects = (): AssignedProjectsState => {
  const { user } = useAuth();
  const isOperator = user?.role === 'operator';
  const profile = user?.profile ?? null;
  const projectIds = profile?.assignedProjectIds ?? [];
  const scopeResolved = !isOperator || profile !== null;
  return { isOperator, projectIds, scopeResolved };
};
