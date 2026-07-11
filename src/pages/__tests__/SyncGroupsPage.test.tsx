// SyncGroupsPage — page-level behaviour. Mirrors the RegionsPage/ProjectsPage
// test style (real i18n, mocked @api + hooks) and pins the sync-group-specific
// contracts:
//   - list rows render from listSyncGroups;
//   - the add-devices picker sends the server-side `syncUnassigned=true` filter
//     (the alignment fix) and still drops any non-null-syncGroupId row that
//     slips through (belt-and-braces);
//   - a create 409 renders the backend message inline on the name input;
//   - a delete 409 renders the backend message **verbatim** in the drawer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const scope = vi.hoisted(() => ({
  value: { isOperator: false, projectIds: [] as number[], scopeResolved: true },
}));
// Mutable so a single case can exercise the VIEWER (read-only) path; reset to
// 'admin' after each test.
const roleRef = vi.hoisted(() => ({ value: 'admin' as 'admin' | 'operator' | 'viewer' }));

vi.mock('@hooks/useRole', () => ({ useRole: () => roleRef.value }));
vi.mock('@hooks/useAssignedProjects', () => ({
  useAssignedProjects: () => scope.value,
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@api/errorDialog', () => ({ markErrorHandled: vi.fn() }));

vi.mock('@api', () => ({
  listProjects: vi.fn(),
  listSyncGroups: vi.fn(),
  getSyncGroup: vi.fn(),
  createSyncGroup: vi.fn(),
  renameSyncGroup: vi.fn(),
  deleteSyncGroup: vi.fn(),
  addDevicesToSyncGroup: vi.fn(),
  removeDeviceFromSyncGroup: vi.fn(),
  listDevices: vi.fn(),
  getSyncGroupPlayback: vi.fn(),
  jumpSyncGroupToIndex: vi.fn(),
  extractApiMessage: (err: unknown): string | null => {
    const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof m === 'string' ? m : null;
  },
  // The page's extractMessage only reaches data.message when the envelope is
  // well-formed; mirror the real guard closely enough for the 409 assertions.
  isErrorResponse: (d: unknown): boolean =>
    typeof d === 'object' && d !== null && typeof (d as { message?: unknown }).message === 'string',
}));

import {
  addDevicesToSyncGroup,
  createSyncGroup,
  deleteSyncGroup,
  getSyncGroup,
  getSyncGroupPlayback,
  listDevices,
  listProjects,
  listSyncGroups,
} from '@api';
import { SyncGroupsPage } from '../SyncGroupsPage';

const mockListProjects = listProjects as unknown as ReturnType<typeof vi.fn>;
const mockListSyncGroups = listSyncGroups as unknown as ReturnType<typeof vi.fn>;
const mockGetSyncGroup = getSyncGroup as unknown as ReturnType<typeof vi.fn>;
const mockCreateSyncGroup = createSyncGroup as unknown as ReturnType<typeof vi.fn>;
const mockDeleteSyncGroup = deleteSyncGroup as unknown as ReturnType<typeof vi.fn>;
const mockListDevices = listDevices as unknown as ReturnType<typeof vi.fn>;
const mockGetSyncGroupPlayback = getSyncGroupPlayback as unknown as ReturnType<typeof vi.fn>;
const mockAddDevices = addDevicesToSyncGroup as unknown as ReturnType<typeof vi.fn>;

// Minimal axios-shaped rejection carrying the backend ErrorResponse envelope.
const axiosErr = (status: number, message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    data: { status, error: '', message, correlationId: 'corr', timestamp: '' },
  },
});

const groupRow = {
  id: 7,
  projectId: 10,
  projectName: 'Project 10',
  name: 'Mall wall',
  deviceCount: 0,
  createdAt: '2026-05-08T09:00:00Z',
};
const groupDetail = { ...groupRow, devices: [] as const };

// A sync group that actually has members — the Playback section only mounts
// when the open group is non-empty.
const groupWithMembers = {
  ...groupRow,
  deviceCount: 1,
  devices: [{ id: 1, serialNumber: 'SN-1', name: 'Wall left', status: 'ONLINE' }],
};
const coherentPlayback = {
  coherent: true,
  reason: null,
  playlistId: 5,
  playlistName: 'Lobby loop',
  loopDurationMs: 60000,
  items: [{ index: 0, fileId: 100, title: 'Clip One', durationSeconds: 30 }],
  activeJump: null,
  memberCount: 1,
};

beforeEach(() => {
  mockListProjects.mockResolvedValue([
    { id: 10, name: 'Project 10', regionCount: 1, createdAt: '2026-01-01T00:00:00Z' },
  ]);
  mockListSyncGroups.mockResolvedValue({ content: [groupRow], totalPages: 1, totalElements: 1 });
  mockGetSyncGroup.mockResolvedValue(groupDetail);
  mockGetSyncGroupPlayback.mockResolvedValue(coherentPlayback);
});

afterEach(() => {
  vi.clearAllMocks();
  scope.value = { isOperator: false, projectIds: [], scopeResolved: true };
  roleRef.value = 'admin';
});

describe('SyncGroupsPage', () => {
  it('renders sync-group rows from the list endpoint', async () => {
    render(<SyncGroupsPage />);
    expect(await screen.findByText('Mall wall')).toBeInTheDocument();
    // Scope to the table — 'Project 10' also appears as a filter-dropdown option.
    expect(within(screen.getByRole('table')).getByText('Project 10')).toBeInTheDocument();
  });

  it('add-devices picker sends syncUnassigned=true and drops non-null-syncGroupId rows', async () => {
    mockListDevices.mockResolvedValue({
      content: [
        { id: 1, name: 'Free A', serialNumber: 'SN-1', syncGroupId: null },
        { id: 2, name: 'Taken B', serialNumber: 'SN-2', syncGroupId: 99 },
      ],
      totalPages: 1,
      totalElements: 2,
      numberOfElements: 2,
    });

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByText('Mall wall')); // open drawer
    fireEvent.click(await screen.findByText('+ Add devices')); // open picker

    await waitFor(() => {
      expect(mockListDevices).toHaveBeenCalledWith(
        { projectId: 10, syncUnassigned: true },
        { page: 0, size: 50 },
      );
    });

    // Belt-and-braces client filter still excludes the assigned device.
    expect(await screen.findByText('Free A')).toBeInTheDocument();
    expect(screen.queryByText('Taken B')).toBeNull();
  });

  it('renders a create 409 message inline on the name input', async () => {
    mockCreateSyncGroup.mockRejectedValue(
      axiosErr(409, 'Sync group with that name already exists in this project'),
    );

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New sync group' }));

    const dialog = screen.getByRole('dialog', { name: 'New sync group' });
    fireEvent.change(within(dialog).getByLabelText('Project'), { target: { value: '10' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('Sync group with that name already exists in this project'),
    ).toBeInTheDocument();
  });

  it('renders a delete 409 message verbatim in the drawer', async () => {
    mockDeleteSyncGroup.mockRejectedValue(
      axiosErr(409, 'Cannot delete: 2 member devices still assigned'),
    );

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByText('Mall wall')); // open drawer

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' })); // drawer footer
    const confirm = screen.getByRole('dialog', { name: 'Delete sync group?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Cannot delete: 2 member devices still assigned'),
    ).toBeInTheDocument();
  });

  it('mounts the Playback section when the open group has members', async () => {
    mockGetSyncGroup.mockResolvedValue(groupWithMembers);

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByText('Mall wall')); // open drawer

    expect(await screen.findByRole('heading', { name: 'Playback' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetSyncGroupPlayback).toHaveBeenCalledWith(7);
    });
    expect(await screen.findByText('Clip One')).toBeInTheDocument();
  });

  it('renders the Playback section read-only for a VIEWER (no jump buttons)', async () => {
    roleRef.value = 'viewer';
    mockGetSyncGroup.mockResolvedValue(groupWithMembers);

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByText('Mall wall')); // open drawer

    expect(await screen.findByRole('heading', { name: 'Playback' })).toBeInTheDocument();
    expect(await screen.findByText('Clip One')).toBeInTheDocument();
    // Rows are inert for a viewer — no per-row jump button exists.
    expect(screen.queryByRole('button', { name: /Jump all screens to/i })).toBeNull();
  });

  it('re-fetches the Playback view when the roster changes in the open drawer', async () => {
    const twoMembers = {
      ...groupWithMembers,
      deviceCount: 2,
      devices: [
        ...groupWithMembers.devices,
        { id: 2, serialNumber: 'SN-2', name: 'Wall right', status: 'ONLINE' },
      ],
    };
    mockGetSyncGroup
      .mockResolvedValueOnce(groupWithMembers) // initial drawer open
      .mockResolvedValueOnce(twoMembers); // refreshDrawer after add
    mockListDevices.mockResolvedValue({
      content: [{ id: 2, name: 'Wall right', serialNumber: 'SN-2', syncGroupId: null }],
      totalPages: 1,
      totalElements: 1,
      numberOfElements: 1,
    });
    mockAddDevices.mockResolvedValue({ addedCount: 1, alreadyMember: [], movedFrom: {} });

    render(<SyncGroupsPage />);
    fireEvent.click(await screen.findByText('Mall wall')); // open drawer
    await screen.findByRole('heading', { name: 'Playback' });
    await waitFor(() => {
      expect(mockGetSyncGroupPlayback).toHaveBeenCalledTimes(1);
    });

    // Add a device via the picker → roster changes → panel remounts and refetches.
    fireEvent.click(await screen.findByText('+ Add devices'));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add (1)' }));

    await waitFor(() => {
      expect(mockGetSyncGroupPlayback).toHaveBeenCalledTimes(2);
    });
  });
});
