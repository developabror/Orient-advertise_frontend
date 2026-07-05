// Vitest tests for src/hooks/useOperatorAccess.ts — link/unlink hit the
// operator-content endpoints; optimistic add; idempotent unlink.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('@api/resources/users', () => ({
  getUser: vi.fn(),
}));

import { http } from '@api/http';
import { getUser } from '@api/resources/users';
import { useOperatorAccess } from '../useOperatorAccess';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;
const mockGetUser = getUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    id: 7,
    username: 'operator',
    role: 'OPERATOR',
    active: true,
    createdAt: '2026-06-01T10:00:00Z',
  });
  mockGet.mockResolvedValue({ data: [{ id: 88, name: 'promo.mp4', status: 'READY' }] });
});

afterEach(() => {
  mockGet.mockReset();
});

describe('useOperatorAccess', () => {
  it('loads linked grants from /api/users/{id}/operator-content', async () => {
    const { result } = renderHook(() => useOperatorAccess('7'));
    await waitFor(() => {
      expect(result.current.linked).toHaveLength(1);
    });
    expect(mockGet).toHaveBeenCalledWith(
      '/api/users/7/operator-content',
      expect.objectContaining({ _suppressErrorToast: true }),
    );
  });

  it('link POSTs the operator-content path with no body and optimistically adds', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });
    const { result } = renderHook(() => useOperatorAccess('7'));
    await waitFor(() => {
      expect(result.current.linkedLoading).toBe(false);
    });

    await act(async () => {
      await result.current.link('99');
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/users/7/operator-content/99',
      undefined,
      expect.objectContaining({ _suppressErrorToast: true }),
    );
    expect(result.current.linked.some((c) => c.id === '99')).toBe(true);
  });

  it('unlink DELETEs the operator-content path and removes locally', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    const { result } = renderHook(() => useOperatorAccess('7'));
    await waitFor(() => {
      expect(result.current.linked).toHaveLength(1);
    });

    await act(async () => {
      await result.current.unlink('88');
    });

    expect(mockDelete).toHaveBeenCalledWith(
      '/api/users/7/operator-content/88',
      expect.objectContaining({ _suppressErrorToast: true }),
    );
    expect(result.current.linked.some((c) => c.id === '88')).toBe(false);
  });
});
