// Vitest unit tests for src/api/resources/projects.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
  type ProjectSummary,
} from '../projects';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 1,
  name: 'Default',
  regionCount: 3,
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

describe('listProjects (no pagination)', () => {
  it('GETs /api/projects and returns the array verbatim', async () => {
    const arr = [project({ id: 1 }), project({ id: 2, name: 'Lab' })];
    mockGet.mockResolvedValueOnce({ data: arr });
    const result = await listProjects();
    expect(mockGet).toHaveBeenCalledWith('/api/projects');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(arr);
  });

  it('returns an empty array when no projects exist', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const result = await listProjects();
    expect(result).toEqual([]);
  });
});

describe('getProject + createProject + renameProject', () => {
  it('getProject GETs /api/projects/{id}', async () => {
    mockGet.mockResolvedValueOnce({ data: project({ id: 7 }) });
    await getProject(7);
    expect(mockGet).toHaveBeenCalledWith('/api/projects/7');
  });

  it('createProject POSTs body verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: project({ name: 'New' }) });
    await createProject({ name: 'New' });
    expect(mockPost).toHaveBeenCalledWith('/api/projects', { name: 'New' });
  });

  it('renameProject PUTs /api/projects/{id} with { name }', async () => {
    mockPut.mockResolvedValueOnce({ data: project({ name: 'Renamed' }) });
    await renameProject(7, 'Renamed');
    expect(mockPut).toHaveBeenCalledWith('/api/projects/7', { name: 'Renamed' });
  });
});

describe('deleteProject', () => {
  it('sends DELETE /api/projects/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await deleteProject(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/projects/7');
  });

  it('lets a 409 (RESTRICT block) bubble unchanged for verbatim message', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 409',
      response: {
        status: 409,
        statusText: '',
        data: { status: 409, error: '', message: 'Cannot delete: 3 child regions', correlationId: 'c', timestamp: '' },
        headers: {},
        config: {},
      },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteProject(7)).rejects.toBe(err);
  });
});
