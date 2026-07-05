// Vitest unit tests for src/hooks/useAssignedProjects.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useAuthMock = vi.fn();
vi.mock('../useAuth', () => ({ useAuth: () => useAuthMock() }));

import { useAssignedProjects } from '../useAssignedProjects';

const profile = (role: string, assignedProjectIds: number[]) => ({
  id: 1,
  username: 'u',
  role,
  active: true,
  createdAt: '2026-06-01T10:00:00Z',
  assignedProjectIds,
});

afterEach(() => {
  useAuthMock.mockReset();
});

describe('useAssignedProjects', () => {
  it('admin: not an operator, scope resolves immediately, no project ids', () => {
    useAuthMock.mockReturnValue({ user: { role: 'admin', profile: profile('ADMIN', []) } });
    const { result } = renderHook(() => useAssignedProjects());
    expect(result.current.isOperator).toBe(false);
    expect(result.current.scopeResolved).toBe(true);
    expect(result.current.projectIds).toEqual([]);
  });

  it('operator before profile resolves: scope not resolved', () => {
    useAuthMock.mockReturnValue({ user: { role: 'operator', profile: null } });
    const { result } = renderHook(() => useAssignedProjects());
    expect(result.current.isOperator).toBe(true);
    expect(result.current.scopeResolved).toBe(false);
    expect(result.current.projectIds).toEqual([]);
  });

  it('operator after profile resolves: scope resolved with ids', () => {
    useAuthMock.mockReturnValue({
      user: { role: 'operator', profile: profile('OPERATOR', [4, 7]) },
    });
    const { result } = renderHook(() => useAssignedProjects());
    expect(result.current.isOperator).toBe(true);
    expect(result.current.scopeResolved).toBe(true);
    expect(result.current.projectIds).toEqual([4, 7]);
  });

  it('operator with [] assignments: scope resolves once profile lands, empty ids', () => {
    useAuthMock.mockReturnValue({
      user: { role: 'operator', profile: profile('OPERATOR', []) },
    });
    const { result } = renderHook(() => useAssignedProjects());
    expect(result.current.isOperator).toBe(true);
    expect(result.current.scopeResolved).toBe(true);
    expect(result.current.projectIds).toEqual([]);
  });
});
