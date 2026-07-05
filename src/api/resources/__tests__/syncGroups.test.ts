// Vitest unit tests for src/api/resources/syncGroups.ts.
//
// Mirrors deviceGroups.test.ts but targets /api/sync-groups and drops the
// volume surface (sync groups coordinate playback, not audio).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  addDevicesToSyncGroup,
  createSyncGroup,
  deleteSyncGroup,
  getSyncGroup,
  listSyncGroups,
  removeDeviceFromSyncGroup,
  renameSyncGroup,
  type SyncGroupSummary,
} from '../syncGroups';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make = (status: number, message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    statusText: '',
    data: { status, error: '', message, correlationId: 'corr', timestamp: '' },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const summary = (over: Partial<SyncGroupSummary> = {}): SyncGroupSummary => ({
  id: 1,
  projectId: 10,
  projectName: 'Project 10',
  name: 'Mall entrance wall',
  deviceCount: 4,
  createdAt: '2026-05-08T09:00:00Z',
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('listSyncGroups', () => {
  it('GETs /api/sync-groups with assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [summary()] } });
    await listSyncGroups({ projectId: 10, name: 'mall' }, { page: 0 });
    expect(mockGet).toHaveBeenCalledWith('/api/sync-groups', {
      params: { projectId: 10, name: 'mall', page: 0 },
    });
  });

  it('omits undefined filters', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listSyncGroups({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/sync-groups', { params: {} });
  });

  it('parses rows through parsePage', async () => {
    mockGet.mockResolvedValueOnce({
      data: { content: [summary({ id: 1 }), summary({ id: 2, deviceCount: 0 })] },
    });
    const page = await listSyncGroups({}, {});
    expect(page.content).toHaveLength(2);
    expect(page.content[1]!.deviceCount).toBe(0);
  });
});

describe('getSyncGroup', () => {
  it('GETs /api/sync-groups/{id} and returns detail with devices (no volume fields)', async () => {
    const detail = {
      ...summary({ id: 7 }),
      devices: [
        { id: 1, serialNumber: 'SN-1', name: 'Wall left', status: 'ONLINE' },
        { id: 2, serialNumber: 'SN-2', name: 'Wall right', status: 'OFFLINE' },
      ],
    };
    mockGet.mockResolvedValueOnce({ data: detail });
    const result = await getSyncGroup(7);
    expect(mockGet).toHaveBeenCalledWith('/api/sync-groups/7');
    expect(result).toBe(detail);
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]!.status).toBe('ONLINE');
    // Sync-group members carry no volume surface.
    expect('effectiveVolume' in result.devices[0]!).toBe(false);
  });
});

describe('createSyncGroup + renameSyncGroup', () => {
  it('POSTs with body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...summary(), devices: [] } });
    await createSyncGroup({ projectId: 10, name: 'New' });
    expect(mockPost).toHaveBeenCalledWith('/api/sync-groups', { projectId: 10, name: 'New' });
  });

  it('createSyncGroup propagates 409 (duplicate project+name) unchanged', async () => {
    const err = make(409, 'Sync group with that name already exists in this project');
    mockPost.mockRejectedValueOnce(err);
    await expect(createSyncGroup({ projectId: 10, name: 'dup' })).rejects.toBe(err);
  });

  it('renameSyncGroup PUTs /api/sync-groups/{id} with { name } body', async () => {
    mockPut.mockResolvedValueOnce({ data: { ...summary({ name: 'Renamed' }), devices: [] } });
    await renameSyncGroup(7, 'Renamed');
    expect(mockPut).toHaveBeenCalledWith('/api/sync-groups/7', { name: 'Renamed' });
  });
});

describe('deleteSyncGroup', () => {
  it('sends DELETE /api/sync-groups/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deleteSyncGroup(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/sync-groups/7');
  });

  it('lets a 409 (member devices) bubble unchanged for verbatim message', async () => {
    const err = make(409, 'Cannot delete: 2 member devices still assigned');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteSyncGroup(7)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toBe(
      'Cannot delete: 2 member devices still assigned',
    );
  });
});

describe('addDevicesToSyncGroup', () => {
  it('POSTs /api/sync-groups/{groupId}/devices with { deviceIds }', async () => {
    const result = { addedCount: 2, alreadyMember: [101], movedFrom: { '5': 2 } };
    mockPost.mockResolvedValueOnce({ data: result });

    const got = await addDevicesToSyncGroup(7, [101, 102, 103]);

    expect(mockPost).toHaveBeenCalledWith('/api/sync-groups/7/devices', {
      deviceIds: [101, 102, 103],
    });
    expect(got).toBe(result);
    expect(got.movedFrom['5']).toBe(2);
    expect(got.alreadyMember).toEqual([101]);
  });

  it('forwards an empty deviceIds array verbatim (lets backend decide if [] is acceptable)', async () => {
    mockPost.mockResolvedValueOnce({ data: { addedCount: 0, alreadyMember: [], movedFrom: {} } });
    await addDevicesToSyncGroup(7, []);
    expect(mockPost).toHaveBeenCalledWith('/api/sync-groups/7/devices', { deviceIds: [] });
  });
});

describe('removeDeviceFromSyncGroup', () => {
  it('sends DELETE /api/sync-groups/{groupId}/devices/{deviceId}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await removeDeviceFromSyncGroup(7, 101);
    expect(mockDelete).toHaveBeenCalledWith('/api/sync-groups/7/devices/101');
  });
});
