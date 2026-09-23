// Render-gate + operator-scoping tests for RegionsPage (gap 26).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const scope = vi.hoisted(() => ({
  retry: vi.fn(),
  value: {
    isOperator: false,
    projectIds: [] as number[],
    scopeResolved: true,
    scopeFailed: false,
    retryScope: () => undefined as void,
  },
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

import { getRegion, listProjects, listRegions } from '@api';
import { RegionsPage } from '../RegionsPage';

const mockListProjects = listProjects as unknown as ReturnType<typeof vi.fn>;
const mockListRegions = listRegions as unknown as ReturnType<typeof vi.fn>;
const mockGetRegion = getRegion as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockListProjects.mockResolvedValue([
    { id: 4, name: 'Project Four', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
    { id: 9, name: 'Project Nine', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
  ]);
  mockListRegions.mockResolvedValue({ content: [], totalPages: 0, totalElements: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  scope.value = {
    isOperator: false,
    projectIds: [],
    scopeResolved: true,
    scopeFailed: false,
    retryScope: () => undefined,
  };
});

describe('RegionsPage — operator render gate', () => {
  it('holds render (no table) until the operator profile resolves', () => {
    scope.value = { ...scope.value, isOperator: true, projectIds: [], scopeResolved: false };
    render(<RegionsPage />);
    // Loading state, no list endpoint call, no table.
    expect(screen.queryByRole('table')).toBeNull();
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it('shows "No projects assigned" and makes no list round-trip for zero-assignment operators', async () => {
    scope.value = { ...scope.value, isOperator: true, projectIds: [], scopeResolved: true };
    render(<RegionsPage />);
    await screen.findByText('No projects assigned');
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it('auto-selects the single assigned project and omits the All-projects option', async () => {
    scope.value = { ...scope.value, isOperator: true, projectIds: [4], scopeResolved: true };
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

describe('RegionsPage — a slow response must not paint the wrong record (VG-16)', () => {
  const region = (id: number, name: string) => ({
    id,
    name,
    code: `C${String(id)}`,
    projectId: 4,
    projectName: 'Project Four',
    facilityCount: 0,
    deviceCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    facilities: [],
  });

  it('shows the row that was opened last, whatever order the responses arrive in', async () => {
    mockListRegions.mockResolvedValue({
      content: [region(1, 'Toshkent'), region(2, 'Samarqand')],
      totalPages: 1,
      totalElements: 2,
    });

    let resolveSlow: ((v: unknown) => void) | null = null;
    mockGetRegion.mockImplementation((id: number) => {
      if (id === 1) {
        return new Promise((resolve) => {
          resolveSlow = resolve;
        });
      }
      return Promise.resolve(region(2, 'Samarqand'));
    });

    render(<RegionsPage />);
    await screen.findByText('Toshkent');

    // Open the first row (its load hangs), then the second (its load lands).
    fireEvent.click(screen.getByText('Toshkent'));
    fireEvent.click(screen.getByText('Samarqand'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('Samarqand');
    });

    // Now the first row's response finally arrives. Before the guard it overwrote the drawer, so
    // the operator read "Toshkent" while every button still acted on region 2.
    await act(async () => {
      resolveSlow?.(region(1, 'Toshkent'));
      await Promise.resolve();
    });

    expect(screen.getByRole('dialog')).toHaveTextContent('Samarqand');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Toshkent');
  });
});

describe('RegionsPage — the scope fetch can fail (VG-12)', () => {
  it('offers a retry instead of spinning forever when /api/me gave up', () => {
    const retryScope = vi.fn();
    scope.value = {
      ...scope.value,
      isOperator: true,
      projectIds: [],
      scopeResolved: false,
      scopeFailed: true,
      retryScope,
    };

    render(<RegionsPage />);

    // Before this, the page held a spinner for the rest of the session: no retry, no error, and
    // no list — indistinguishable from the app being broken.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retry);
    expect(retryScope).toHaveBeenCalled();
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it('still shows the spinner while the profile is merely in flight', () => {
    scope.value = { ...scope.value, isOperator: true, projectIds: [], scopeResolved: false, scopeFailed: false };

    render(<RegionsPage />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});
