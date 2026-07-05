// Vitest unit tests for src/api/resources/regions.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  createRegion,
  deleteRegion,
  getRegion,
  listRegions,
  updateRegion,
  type RegionSummary,
} from '../regions';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const region = (over: Partial<RegionSummary> = {}): RegionSummary => ({
  id: 1,
  projectId: 0,
  code: 'TASH',
  name: 'Tashkent',
  facilityCount: 5,
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

describe('listRegions', () => {
  it('GETs /api/regions with assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [region()] } });
    await listRegions({ projectId: 0, name: 'tash' }, { page: 0, size: 50 });
    expect(mockGet).toHaveBeenCalledWith('/api/regions', {
      params: { projectId: 0, name: 'tash', page: 0, size: 50 },
    });
  });

  it('omits undefined filters', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listRegions({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/regions', { params: {} });
  });
});

describe('getRegion + createRegion + updateRegion', () => {
  it('GETs /api/regions/{id}', async () => {
    mockGet.mockResolvedValueOnce({ data: region({ id: 7 }) });
    await getRegion(7);
    expect(mockGet).toHaveBeenCalledWith('/api/regions/7');
  });

  it('createRegion POSTs body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: region({ code: 'SAM', name: 'Samarkand' }) });
    await createRegion({ projectId: 0, code: 'SAM', name: 'Samarkand' });
    expect(mockPost).toHaveBeenCalledWith('/api/regions', {
      projectId: 0,
      code: 'SAM',
      name: 'Samarkand',
    });
  });

  it('updateRegion PUTs only the fields provided (omits undefined)', async () => {
    mockPut.mockResolvedValueOnce({ data: region({ name: 'Tashkent City' }) });
    await updateRegion(7, { name: 'Tashkent City' });
    const body = mockPut.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ name: 'Tashkent City' });
    expect('code' in body).toBe(false);
  });

  it('updateRegion can update both fields together', async () => {
    mockPut.mockResolvedValueOnce({ data: region() });
    await updateRegion(7, { code: 'TSH', name: 'Tashkent' });
    expect(mockPut).toHaveBeenCalledWith('/api/regions/7', { code: 'TSH', name: 'Tashkent' });
  });

  it('updateRegion can update code alone', async () => {
    mockPut.mockResolvedValueOnce({ data: region() });
    await updateRegion(7, { code: 'TSH' });
    const body = mockPut.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ code: 'TSH' });
    expect('name' in body).toBe(false);
  });
});

describe('deleteRegion', () => {
  it('sends DELETE /api/regions/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deleteRegion(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/regions/7');
  });

  it('lets a 409 (RESTRICT block) bubble unchanged', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 409',
      response: {
        status: 409,
        statusText: '',
        data: { status: 409, error: '', message: 'Cannot delete: 5 facilities, 12 active devices', correlationId: 'c', timestamp: '' },
        headers: {},
        config: {},
      },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteRegion(7)).rejects.toBe(err);
  });
});
