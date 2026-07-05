// Vitest unit tests for src/api/resources/advertiserContent.ts.

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
  linkContent,
  listLinkedContent,
  unlinkContent,
  type LinkedContent,
} from '../advertiserContent';

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

describe('listLinkedContent', () => {
  it('GETs /api/users/{userId}/content and returns the array verbatim', async () => {
    const arr: LinkedContent[] = [
      { id: 10, name: 'Spring Promo.mp4', status: 'READY' },
      { id: 11, name: 'Summer Promo.mp4', status: 'TRANSCODING' },
    ];
    mockGet.mockResolvedValueOnce({ data: arr });

    const result = await listLinkedContent(7);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/users/7/content');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(arr);
  });

  it('returns an empty array (not 404) when the user has no linked content', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    const result = await listLinkedContent(7);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);
    await expect(listLinkedContent(7)).rejects.toBe(err);
  });
});

describe('linkContent', () => {
  it('POSTs /api/users/{userId}/content/{contentFileId} with no body and resolves to undefined', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });

    const result = await linkContent(7, 10);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/users/7/content/10');
    // Single positional arg = no body. The link is fully described by
    // the path; sending a body would just confuse Bean validation.
    expect(mockPost.mock.calls[0]).toHaveLength(1);
    expect(result).toBeUndefined();
  });

  it('lets a 409 "duplicate link" axios error bubble unchanged', async () => {
    const err = make409('Content already linked to this user');
    mockPost.mockRejectedValueOnce(err);

    await expect(linkContent(7, 10)).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('already linked');
  });

  it('lets a 409 "non-ADVERTISER target" axios error bubble unchanged', async () => {
    const err = make409('Target user is not an ADVERTISER');
    mockPost.mockRejectedValueOnce(err);

    await expect(linkContent(7, 10)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toContain('not an ADVERTISER');
  });

  it('does not double-call http.post on failure', async () => {
    mockPost.mockRejectedValueOnce(make409('duplicate'));
    await expect(linkContent(7, 10)).rejects.toBeDefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('unlinkContent', () => {
  it('sends DELETE /api/users/{userId}/content/{contentFileId} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await unlinkContent(7, 10);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/users/7/content/10');
    expect(result).toBeUndefined();
  });

  it('is idempotent — server returns 204 even when the link does not exist', async () => {
    // The backend's contract is "204 either way." If the link did not
    // exist, the server STILL returns success — no 404. Caller doesn't
    // need to pre-check via listLinkedContent.
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await unlinkContent(7, 999);

    expect(mockDelete).toHaveBeenCalledWith('/api/users/7/content/999');
    expect(result).toBeUndefined();
  });

  it('propagates 403 unchanged (non-ADMIN caller)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: '', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    await expect(unlinkContent(7, 10)).rejects.toBe(err);
  });
});
