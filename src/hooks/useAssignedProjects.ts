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
  /**
   * True when `/api/me` failed every retry, so the scope will not arrive on its own. Pages that
   * hold their render on {@link scopeResolved} MUST branch on this, or a single failed request
   * leaves an operator on a spinner forever with nothing to click (VG-12).
   */
  readonly scopeFailed: boolean;
  /** Ask for the profile again — the retry button on those pages. */
  readonly retryScope: () => void;
}

export const useAssignedProjects = (): AssignedProjectsState => {
  const { user, profileFailed, reloadProfile } = useAuth();
  const isOperator = user?.role === 'operator';
  const profile = user?.profile ?? null;
  const projectIds = profile?.assignedProjectIds ?? [];
  const scopeResolved = !isOperator || profile !== null;
  // Only an operator is blocked by a missing profile; everyone else renders unscoped anyway.
  return { isOperator, projectIds, scopeResolved, scopeFailed: isOperator && profileFailed, retryScope: reloadProfile };
};
