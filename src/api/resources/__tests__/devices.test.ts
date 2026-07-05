// Vitest unit tests for src/api/resources/devices.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  clearDeviceVolume,
  deleteDevice,
  getDevice,
  listDevices,
  setAllDevicesVolume,
  setDeviceVolume,
  updateDevice,
  updateDeviceLocation,
  type DeviceDetail,
  type DeviceListItem,
} from '../devices';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

// Minimal axios-error shape — `axios.isAxiosError` only checks for the
// `isAxiosError === true` brand on a non-null object.
const makeAxiosError = (status: number): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: { status, statusText: '', data: {}, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

const validRow = (over: Partial<DeviceListItem> = {}): DeviceListItem => ({
  id: 1,
  serialNumber: 'SN-1',
  name: 'Lobby kiosk',
  computedStatus: 'ONLINE',
  regionId: 10,
  facilityId: 100,
  facilityName: 'HQ',
  deviceGroupId: 5,
  syncGroupId: null,
  lastHeartbeatAt: '2026-05-08T10:00:00Z',
  activePlaylistId: 15,
  activePlaylistName: 'Summer Promo',
  ...over,
});

const validDetail = (over: Partial<DeviceDetail> = {}): DeviceDetail => ({
  id: 7,
  serialNumber: 'SN-7',
  name: 'Atrium screen',
  status: 'ONLINE',
  regionId: 10,
  facilityId: 100,
  deviceGroupId: 5,
  syncGroupId: null,
  syncGroupName: null,
  lastHeartbeatAt: '2026-05-08T10:00:00Z',
  reportedVolume: 45,
  effectiveVolume: 50,
  volumeOverride: 50,
  registeredAt: '2026-04-01T09:00:00Z',
  createdAt: '2026-04-01T09:00:00Z',
  updatedAt: '2026-05-08T10:00:00Z',
  deletedAt: null,
  deleted: false,
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('listDevices — query string assembly', () => {
  it('omits the params object entries for undefined fields', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [], number: 0 } });

    await listDevices({ regionId: 10 }, { page: 0, size: 20 });

    expect(mockGet).toHaveBeenCalledWith('/api/devices', {
      params: { regionId: 10, page: 0, size: 20 },
    });
    // No undefined keys leak into the params object.
    const calledParams = mockGet.mock.calls[0]![1] as { params: Record<string, unknown> };
    expect('status' in calledParams.params).toBe(false);
    expect('facilityId' in calledParams.params).toBe(false);
    expect('serial' in calledParams.params).toBe(false);
    expect('sort' in calledParams.params).toBe(false);
  });

  it('passes every supplied filter and pageable field through', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listDevices(
      {
        status: 'OFFLINE',
        regionId: 1,
        facilityId: 2,
        deviceGroupId: 3,
        serial: 'SN-',
        name: 'lobby',
        facilityName: 'HQ',
      },
      { page: 2, size: 50, sort: 'lastHeartbeatAt,desc' },
    );

    expect(mockGet).toHaveBeenCalledWith('/api/devices', {
      params: {
        status: 'OFFLINE',
        regionId: 1,
        facilityId: 2,
        deviceGroupId: 3,
        serial: 'SN-',
        name: 'lobby',
        facilityName: 'HQ',
        page: 2,
        size: 50,
        sort: 'lastHeartbeatAt,desc',
      },
    });
  });

  it('sends an empty params object when neither filters nor pageable are set', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listDevices({}, {});

    expect(mockGet).toHaveBeenCalledWith('/api/devices', { params: {} });
  });

  it('preserves falsy-but-defined values (page: 0, size: 0, empty strings)', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    // page: 0 is the FIRST page in Spring; we must not drop it as if it
    // were undefined. Same logic for an empty-string filter — that's
    // `?serial=` which the backend can interpret distinctly from
    // "filter absent."
    await listDevices({ serial: '' }, { page: 0, size: 0 });

    expect(mockGet).toHaveBeenCalledWith('/api/devices', {
      params: { serial: '', page: 0, size: 0 },
    });
  });

  it('passes hasActivePlaylist through (both true and false survive dropUndefined)', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listDevices({ hasActivePlaylist: true }, {});
    expect(mockGet).toHaveBeenLastCalledWith('/api/devices', {
      params: { hasActivePlaylist: true },
    });

    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listDevices({ hasActivePlaylist: false }, {});
    expect(mockGet).toHaveBeenLastCalledWith('/api/devices', {
      params: { hasActivePlaylist: false },
    });
  });
});

describe('listDevices — page parsing', () => {
  it('routes the response through parsePage and returns a typed Page', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validRow({ id: 1 }), validRow({ id: 2, name: 'Hallway' })],
        number: 0,
        size: 20,
        numberOfElements: 2,
        totalElements: 2,
        totalPages: 1,
        first: true,
        last: true,
      },
    });

    const page = await listDevices({}, {});

    expect(page.content).toHaveLength(2);
    expect(page.content[0]!.id).toBe(1);
    expect(page.content[1]!.name).toBe('Hallway');
    expect(page.totalElements).toBe(2);
    expect(page.first).toBe(true);
    expect(page.last).toBe(true);
  });

  it('skips malformed rows (missing required field) but keeps valid ones', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validRow({ id: 1 }),
          { id: 2 /* missing serialNumber/name/computedStatus */ },
          validRow({ id: 3, name: 'Cafeteria' }),
        ],
        numberOfElements: 3,
        totalElements: 3,
      },
    });

    const page = await listDevices({}, {});

    expect(page.content).toHaveLength(2);
    expect(page.content.map((r) => r.id)).toEqual([1, 3]);
    // numberOfElements still reports the SERVER's count — the divergence
    // from content.length signals that rows were dropped.
    expect(page.numberOfElements).toBe(3);
  });

  it('coerces nullable fields: null/undefined → null; valid number/string → kept', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          {
            id: 99,
            serialNumber: 'SN-99',
            name: 'orphan',
            computedStatus: 'UNREGISTERED',
            // Nullable fields explicitly null OR omitted entirely
            regionId: null,
            // facilityId omitted → undefined → null
            facilityName: null,
            deviceGroupId: null,
            lastHeartbeatAt: null,
          },
        ],
      },
    });

    const page = await listDevices({}, {});

    expect(page.content).toHaveLength(1);
    expect(page.content[0]!.regionId).toBeNull();
    expect(page.content[0]!.facilityId).toBeNull();
    expect(page.content[0]!.facilityName).toBeNull();
    expect(page.content[0]!.deviceGroupId).toBeNull();
    // syncGroupId is absent from this wire payload → defensively parses to null.
    expect(page.content[0]!.syncGroupId).toBeNull();
    expect(page.content[0]!.lastHeartbeatAt).toBeNull();
  });

  it('drops a row whose nullable field has an unsupported type (e.g. string for regionId)', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          { ...validRow({ id: 1 }), regionId: 'ten' as unknown as number },
          validRow({ id: 2 }),
        ],
      },
    });

    const page = await listDevices({}, {});
    // The stricter row parser refuses to silently coerce 'ten' to a number;
    // the row is dropped, the well-formed sibling survives.
    expect(page.content).toHaveLength(1);
    expect(page.content[0]!.id).toBe(2);
  });

  it('returns an empty page when the response body is not an envelope', async () => {
    mockGet.mockResolvedValueOnce({ data: 'unexpected' });
    const page = await listDevices({}, {});
    expect(page.content).toEqual([]);
    expect(page.first).toBe(true);
    expect(page.last).toBe(true);
  });

  it('parses activePlaylistId/Name (set / null / omitted) and drops wrong-typed rows', async () => {
    const omitted: Record<string, unknown> = { ...validRow({ id: 3 }) };
    delete omitted.activePlaylistId;
    delete omitted.activePlaylistName;

    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validRow({ id: 1, activePlaylistId: 15, activePlaylistName: 'Summer Promo' }),
          validRow({ id: 2, activePlaylistId: null, activePlaylistName: null }),
          omitted, // both fields absent → null
          // wrong-typed id (string) → numOrNull throws → row dropped by parsePage
          { ...validRow({ id: 4 }), activePlaylistId: 'fifteen' },
          // wrong-typed name (number) → strOrNull throws → row dropped
          { ...validRow({ id: 5 }), activePlaylistName: 99 },
        ],
      },
    });

    const page = await listDevices({}, {});
    expect(page.content.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(page.content[0]!.activePlaylistId).toBe(15);
    expect(page.content[0]!.activePlaylistName).toBe('Summer Promo');
    expect(page.content[1]!.activePlaylistId).toBeNull();
    expect(page.content[1]!.activePlaylistName).toBeNull();
    expect(page.content[2]!.activePlaylistId).toBeNull();
    expect(page.content[2]!.activePlaylistName).toBeNull();
  });
});

describe('getDevice', () => {
  it('GETs /api/devices/{id} and returns the DTO verbatim', async () => {
    const detail = validDetail();
    mockGet.mockResolvedValueOnce({ data: detail });

    const result = await getDevice(7);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/devices/7');
    // Single positional arg: no per-request config (no Authorization-header
    // override leaking out of the resource).
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(detail);
  });

  it('returns a soft-deleted record verbatim (deleted=true)', async () => {
    const tombstone = validDetail({
      deleted: true,
      deletedAt: '2026-05-01T00:00:00Z',
    });
    mockGet.mockResolvedValueOnce({ data: tombstone });

    const result = await getDevice(7);

    expect(result.deleted).toBe(true);
    expect(result.deletedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('propagates 404 unchanged for the caller to render not-found UI', async () => {
    const err = makeAxiosError(404);
    mockGet.mockRejectedValueOnce(err);

    await expect(getDevice(999)).rejects.toBe(err);
    const surface = err as { response?: { status?: number } };
    expect(surface.response?.status).toBe(404);
  });
});

describe('updateDevice', () => {
  it('PUTs /api/devices/{id} with body { name } and returns the updated DTO', async () => {
    const updated = validDetail({ name: 'Front foyer' });
    mockPut.mockResolvedValueOnce({ data: updated });

    const result = await updateDevice(7, 'Front foyer');

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith('/api/devices/7', { name: 'Front foyer' });
    expect(result).toBe(updated);
  });

  it('propagates a 400 axios error unchanged so callers can extract field errors', async () => {
    const err = makeAxiosError(400);
    mockPut.mockRejectedValueOnce(err);

    await expect(updateDevice(7, '')).rejects.toBe(err);
  });
});

describe('deleteDevice', () => {
  it('sends DELETE /api/devices/{id} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await deleteDevice(7);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/devices/7');
    expect(result).toBeUndefined();
  });

  it('propagates 403 unchanged (OPERATOR calling ADMIN-only endpoint)', async () => {
    const err = makeAxiosError(403);
    mockDelete.mockRejectedValueOnce(err);

    // We deliberately don't suppress the global toast on a 403 for this
    // destructive ADMIN-only endpoint — see the JSDoc — so the resource
    // just lets the error bubble. Caller logs / propagates.
    await expect(deleteDevice(7)).rejects.toBe(err);
  });
});

describe('updateDeviceLocation', () => {
  it('PUTs /api/devices/{id}/location with the { regionId, facilityId } body', async () => {
    mockPut.mockResolvedValueOnce({ data: validDetail({ regionId: 3, facilityId: 9 }) });

    await updateDeviceLocation(7, { regionId: 3, facilityId: 9 });

    expect(mockPut).toHaveBeenCalledWith('/api/devices/7/location', {
      regionId: 3,
      facilityId: 9,
    });
  });

  it('lets a 409 (cross-project group conflict) bubble unchanged for verbatim inline surfacing', async () => {
    const err = makeAxiosError(409);
    mockPut.mockRejectedValueOnce(err);
    await expect(updateDeviceLocation(7, { regionId: 3, facilityId: 9 })).rejects.toBe(err);
  });

  it('lets a 400 (facility not in region) bubble unchanged', async () => {
    const err = makeAxiosError(400);
    mockPut.mockRejectedValueOnce(err);
    await expect(updateDeviceLocation(7, { regionId: 3, facilityId: 99 })).rejects.toBe(err);
  });
});

describe('device volume', () => {
  it('setDeviceVolume PUTs /api/devices/{id}/volume with { volume }', async () => {
    mockPut.mockResolvedValueOnce({ data: undefined });
    await setDeviceVolume(7, 45);
    expect(mockPut).toHaveBeenCalledWith('/api/devices/7/volume', { volume: 45 });
  });

  it('clearDeviceVolume DELETEs /api/devices/{id}/volume', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await clearDeviceVolume(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/devices/7/volume');
  });

  it('setAllDevicesVolume PUTs /api/devices/volume and returns { affected }', async () => {
    mockPut.mockResolvedValueOnce({ data: { affected: 12 } });
    const res = await setAllDevicesVolume(60);
    expect(mockPut).toHaveBeenCalledWith('/api/devices/volume', { volume: 60 });
    expect(res).toEqual({ affected: 12 });
  });

  it('propagates a 400 (out-of-range volume) unchanged for inline surfacing', async () => {
    const err = makeAxiosError(400);
    mockPut.mockRejectedValueOnce(err);
    await expect(setDeviceVolume(7, 150)).rejects.toBe(err);
  });
});
