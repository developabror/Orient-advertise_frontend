// Render-gate + operator-scoping tests for RegionsPage (gap 26).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const scope = vi.hoisted(() => ({
  value: { isOperator: false, projectIds: [] as number[], scopeResolved: true },
}));

vi.mock('@hooks/useRole', () => ({ useRole: () => 'operator' }));
vi.mock('@hooks/useAssignedProjects', () => ({
  useAssignedProjects: () => scope.value,
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@api', () => ({
  listProjects: vi.fn(),
  listRegions: vi.fn(),
  getRegion: vi.fn(),
  createRegion: vi.fn(),
  updateRegion: vi.fn(),
  deleteRegion: vi.fn(),
  isErrorResponse: () => false,
}));

import { listProjects, listRegions } from '@api';
import { RegionsPage } from '../RegionsPage';

const mockListProjects = listProjects as unknown as ReturnType<typeof vi.fn>;
const mockListRegions = listRegions as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockListProjects.mockResolvedValue([
    { id: 4, name: 'Project Four', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
    { id: 9, name: 'Project Nine', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
  ]);
  mockListRegions.mockResolvedValue({ content: [], totalPages: 0, totalElements: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  scope.value = { isOperator: false, projectIds: [], scopeResolved: true };
});

describe('RegionsPage — operator render gate', () => {
  it('holds render (no table) until the operator profile resolves', () => {
    scope.value = { isOperator: true, projectIds: [], scopeResolved: false };
    render(<RegionsPage />);
    // Loading state, no list endpoint call, no table.
    expect(screen.queryByRole('table')).toBeNull();
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it('shows "No projects assigned" and makes no list round-trip for zero-assignment operators', async () => {
    scope.value = { isOperator: true, projectIds: [], scopeResolved: true };
    render(<RegionsPage />);
    await screen.findByText('No projects assigned');
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it('auto-selects the single assigned project and omits the All-projects option', async () => {
    scope.value = { isOperator: true, projectIds: [4], scopeResolved: true };
    render(<RegionsPage />);

    // Auto-selected → the list is eventually queried with projectId 4.
    await waitFor(() => {
      const calledWith4 = mockListRegions.mock.calls.some(
        (c) => (c[0] as { projectId?: number }).projectId === 4,
      );
      expect(calledWith4).toBe(true);
    });

    // Picker shows only the assigned project, no "All projects" option.
    expect(screen.queryByRole('option', { name: 'All projects' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Project Four' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Project Nine' })).toBeNull();
  });
});
