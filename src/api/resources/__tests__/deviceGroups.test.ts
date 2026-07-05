// Vitest unit tests for src/api/resources/deviceGroups.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  addDevicesToGroup,
  clearDeviceGroupVolume,
  createDeviceGroup,
  deleteDeviceGroup,
  getDeviceGroup,
  listDeviceGroups,
  removeDeviceFromGroup,
  renameDeviceGroup,
  setDeviceGroupVolume,
  type DeviceGroupSummary,
} from '../deviceGroups';

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

const summary = (over: Partial<DeviceGroupSummary> = {}): DeviceGroupSummary => ({
  id: 1,
  projectId: 10,
  projectName: 'Project 10',
  name: 'Lobby kiosks',
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

describe('listDeviceGroups', () => {
  it('GETs /api/device-groups with assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [summary()] } });
    await listDeviceGroups({ projectId: 10, name: 'lobby' }, { page: 0 });
    expect(mockGet).toHaveBeenCalledWith('/api/device-groups', {
      params: { projectId: 10, name: 'lobby', page: 0 },
    });
  });

  it('omits undefined filters', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listDeviceGroups({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/device-groups', { params: {} });
  });

  it('parses rows through parsePage', async () => {
    mockGet.mockResolvedValueOnce({
      data: { content: [summary({ id: 1 }), summary({ id: 2, deviceCount: 0 })] },
    });
    const page = await listDeviceGroups({}, {});
    expect(page.content).toHaveLength(2);
    expect(page.content[1]!.deviceCount).toBe(0);
  });
});

describe('getDeviceGroup', () => {
  it('GETs /api/device-groups/{id} and returns detail with devices', async () => {
    const detail = {
      ...summary({ id: 7 }),
      volume: 50,
      devices: [
        { id: 1, serialNumber: 'SN-1', name: 'Lobby', status: 'ONLINE', reportedVolume: 48, effectiveVolume: 50 },
        { id: 2, serialNumber: 'SN-2', name: 'Atrium', status: 'OFFLINE', reportedVolume: null, effectiveVolume: 50 },
      ],
    };
    mockGet.mockResolvedValueOnce({ data: detail });
    const result = await getDeviceGroup(7);
    expect(mockGet).toHaveBeenCalledWith('/api/device-groups/7');
    expect(result).toBe(detail);
    expect(result.devices).toHaveLength(2);
    // Group volume + per-member convergence fields flow through verbatim.
    expect(result.volume).toBe(50);
    expect(result.devices[0]!.effectiveVolume).toBe(50);
    expect(result.devices[1]!.reportedVolume).toBeNull();
  });
});

describe('device-group volume', () => {
  it('setDeviceGroupVolume PUTs /api/device-groups/{id}/volume with { volume }', async () => {
    mockPut.mockResolvedValueOnce({ data: undefined });
    await setDeviceGroupVolume(7, 30);
    expect(mockPut).toHaveBeenCalledWith('/api/device-groups/7/volume', { volume: 30 });
  });

  it('clearDeviceGroupVolume DELETEs /api/device-groups/{id}/volume', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await clearDeviceGroupVolume(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/device-groups/7/volume');
  });
});

describe('createDeviceGroup + renameDeviceGroup', () => {
  it('POSTs with body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...summary(), devices: [] } });
    await createDeviceGroup({ projectId: 10, name: 'New' });
    expect(mockPost).toHaveBeenCalledWith('/api/device-groups', { projectId: 10, name: 'New' });
  });

  it('createDeviceGroup propagates 409 (duplicate project+name) unchanged', async () => {
    const err = make(409, 'Group with that name already exists in this project');
    mockPost.mockRejectedValueOnce(err);
    await expect(createDeviceGroup({ projectId: 10, name: 'dup' })).rejects.toBe(err);
  });

  it('renameDeviceGroup PUTs /api/device-groups/{id} with { name } body', async () => {
    mockPut.mockResolvedValueOnce({ data: { ...summary({ name: 'Renamed' }), devices: [] } });
    await renameDeviceGroup(7, 'Renamed');
    expect(mockPut).toHaveBeenCalledWith('/api/device-groups/7', { name: 'Renamed' });
  });
});

describe('deleteDeviceGroup', () => {
  it('sends DELETE /api/device-groups/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deleteDeviceGroup(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/device-groups/7');
  });

  it('lets a 409 (active devices / confirmed assignments) bubble unchanged for verbatim message', async () => {
    const err = make(409, 'Cannot delete: 4 active devices and 2 confirmed assignments');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteDeviceGroup(7)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toBe(
      'Cannot delete: 4 active devices and 2 confirmed assignments',
    );
  });
});

describe('addDevicesToGroup', () => {
  it('POSTs /api/device-groups/{groupId}/devices with { deviceIds }', async () => {
    const result = { addedCount: 2, alreadyMember: [101], movedFrom: { '5': 2 } };
    mockPost.mockResolvedValueOnce({ data: result });

    const got = await addDevicesToGroup(7, [101, 102, 103]);

    expect(mockPost).toHaveBeenCalledWith('/api/device-groups/7/devices', {
      deviceIds: [101, 102, 103],
    });
    expect(got).toBe(result);
    expect(got.movedFrom['5']).toBe(2);
    expect(got.alreadyMember).toEqual([101]);
  });

  it('forwards an empty deviceIds array verbatim (lets backend decide if [] is acceptable)', async () => {
    mockPost.mockResolvedValueOnce({ data: { addedCount: 0, alreadyMember: [], movedFrom: {} } });
    await addDevicesToGroup(7, []);
    expect(mockPost).toHaveBeenCalledWith('/api/device-groups/7/devices', { deviceIds: [] });
  });
});

describe('removeDeviceFromGroup', () => {
  it('sends DELETE /api/device-groups/{groupId}/devices/{deviceId}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await removeDeviceFromGroup(7, 101);
    expect(mockDelete).toHaveBeenCalledWith('/api/device-groups/7/devices/101');
  });
});
