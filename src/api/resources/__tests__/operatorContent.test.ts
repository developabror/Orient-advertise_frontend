// Vitest unit tests for src/api/resources/operatorContent.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  linkOperatorContent,
  listLinkedOperatorContent,
  unlinkOperatorContent,
  type LinkedContent,
} from '../operatorContent';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make409 = (message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: {
    status: 409,
    statusText: 'Conflict',
    data: {
      status: 409,
      error: 'Conflict',
      message,
      correlationId: 'corr-409',
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('listLinkedOperatorContent', () => {
  it('GETs /api/users/{userId}/operator-content and returns the array verbatim', async () => {
    const arr: LinkedContent[] = [
      { id: 10, name: 'Spring Promo.mp4', status: 'READY' },
      { id: 11, name: 'Summer Promo.mp4', status: 'TRANSCODING' },
    ];
    mockGet.mockResolvedValueOnce({ data: arr });

    const result = await listLinkedOperatorContent(7);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/users/7/operator-content');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(arr);
  });

  it('returns an empty array (not 404) when the user has no grants', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    const result = await listLinkedOperatorContent(7);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);
    await expect(listLinkedOperatorContent(7)).rejects.toBe(err);
  });
});

describe('linkOperatorContent', () => {
  it('POSTs /api/users/{userId}/operator-content/{contentFileId} with no body', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });

    const result = await linkOperatorContent(7, 10);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/users/7/operator-content/10');
    // Single positional arg = no body.
    expect(mockPost.mock.calls[0]).toHaveLength(1);
    expect(result).toBeUndefined();
  });

  it('lets a 409 "duplicate" axios error bubble unchanged', async () => {
    const err = make409('Content already granted to this user');
    mockPost.mockRejectedValueOnce(err);

    await expect(linkOperatorContent(7, 10)).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('already granted');
  });

  it('lets a 409 "Target user is not an OPERATOR" axios error bubble unchanged', async () => {
    const err = make409('Target user is not an OPERATOR');
    mockPost.mockRejectedValueOnce(err);

    await expect(linkOperatorContent(7, 10)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toContain('not an OPERATOR');
  });
});

describe('unlinkOperatorContent', () => {
  it('sends DELETE /api/users/{userId}/operator-content/{contentFileId}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await unlinkOperatorContent(7, 10);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/users/7/operator-content/10');
    expect(result).toBeUndefined();
  });

  it('is idempotent — server returns 204 even when the grant does not exist', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    const result = await unlinkOperatorContent(7, 999);
    expect(mockDelete).toHaveBeenCalledWith('/api/users/7/operator-content/999');
    expect(result).toBeUndefined();
  });

  it('propagates 403 unchanged', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: '', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    await expect(unlinkOperatorContent(7, 10)).rejects.toBe(err);
  });
});
