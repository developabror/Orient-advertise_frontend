// Vitest unit tests for src/api/resources/facilities.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  createFacility,
  deleteFacility,
  getFacility,
  listFacilities,
  renameFacility,
  type FacilitySummary,
} from '../facilities';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const facility = (over: Partial<FacilitySummary> = {}): FacilitySummary => ({
  id: 1,
  regionId: 10,
  name: 'HQ',
  deviceCount: 12,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
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

describe('listFacilities', () => {
  it('GETs /api/facilities with assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [facility()] } });
    await listFacilities({ regionId: 10, name: 'hq' }, { page: 0 });
    expect(mockGet).toHaveBeenCalledWith('/api/facilities', {
      params: { regionId: 10, name: 'hq', page: 0 },
    });
  });

  it('omits undefined filters', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listFacilities({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/facilities', { params: {} });
  });
});

describe('getFacility + createFacility + renameFacility', () => {
  it('GETs /api/facilities/{id}', async () => {
    mockGet.mockResolvedValueOnce({ data: facility({ id: 7 }) });
    await getFacility(7);
    expect(mockGet).toHaveBeenCalledWith('/api/facilities/7');
  });

  it('createFacility POSTs body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: facility({ name: 'Branch' }) });
    await createFacility({ regionId: 10, name: 'Branch' });
    expect(mockPost).toHaveBeenCalledWith('/api/facilities', { regionId: 10, name: 'Branch' });
  });

  it('renameFacility PUTs /api/facilities/{id} with { name }', async () => {
    mockPut.mockResolvedValueOnce({ data: facility({ name: 'Renamed' }) });
    await renameFacility(7, 'Renamed');
    expect(mockPut).toHaveBeenCalledWith('/api/facilities/7', { name: 'Renamed' });
  });
});

describe('deleteFacility', () => {
  it('sends DELETE /api/facilities/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deleteFacility(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/facilities/7');
  });

  it('lets a 409 (active devices / active assignments) bubble unchanged', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 409',
      response: {
        status: 409,
        statusText: '',
        data: { status: 409, error: '', message: 'Cannot delete: 12 active devices, 2 active assignments', correlationId: 'c', timestamp: '' },
        headers: {},
        config: {},
      },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteFacility(7)).rejects.toBe(err);
  });
});
