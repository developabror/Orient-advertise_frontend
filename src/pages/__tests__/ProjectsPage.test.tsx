// Tests for the relocated device-groups section on the project drawer.
// Device groups moved off the Region drawer (they belong to a project now and
// span its regions), so GET /api/projects/{id} embeds them and the drawer
// renders them — this pins that wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const scope = vi.hoisted(() => ({
  value: { isOperator: false, projectIds: [] as number[], scopeResolved: true },
}));

// 'viewer' keeps the test focused on the device-groups section: canMutate is
// false, so the drawer skips the admin-only operators editor (and its
// getProjectOperators/listUsers round-trips) entirely.
vi.mock('@hooks/useRole', () => ({ useRole: () => 'viewer' }));
vi.mock('@hooks/useAssignedProjects', () => ({
  useAssignedProjects: () => scope.value,
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@api', () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectOperators: vi.fn(),
  setProjectOperators: vi.fn(),
  listUsers: vi.fn(),
  isErrorResponse: () => false,
}));

import { getProject, listProjects } from '@api';
import { ProjectsPage } from '../ProjectsPage';

const mockListProjects = listProjects as unknown as ReturnType<typeof vi.fn>;
const mockGetProject = getProject as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockListProjects.mockResolvedValue([
    { id: 1, name: 'Project One', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
  scope.value = { isOperator: false, projectIds: [], scopeResolved: true };
});

describe('ProjectsPage — device groups drawer section', () => {
  it("renders the project's device groups in the drawer", async () => {
    mockGetProject.mockResolvedValue({
      id: 1,
      name: 'Project One',
      regionCount: 1,
      createdAt: '2026-01-01T00:00:00Z',
      regions: [{ id: 10, code: 'TASH', name: 'Tashkent', createdAt: '2026-01-01T00:00:00Z' }],
      deviceGroups: [
        { id: 100, name: 'Central Mall' },
        { id: 101, name: 'Airport Terminal' },
      ],
    });

    render(<ProjectsPage />);

    // Open the project drawer from the list row.
    fireEvent.click(await screen.findByText('Project One'));

    // The device-groups section header (count) + each group name render.
    expect(await screen.findByText('Device groups (2)')).toBeInTheDocument();
    expect(screen.getByText('Central Mall')).toBeInTheDocument();
    expect(screen.getByText('Airport Terminal')).toBeInTheDocument();
  });

  it('shows the empty-state when the project has no device groups', async () => {
    mockGetProject.mockResolvedValue({
      id: 1,
      name: 'Project One',
      regionCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      regions: [],
      deviceGroups: [],
    });

    render(<ProjectsPage />);
    fireEvent.click(await screen.findByText('Project One'));

    expect(await screen.findByText('No device groups in this project.')).toBeInTheDocument();
  });
});
