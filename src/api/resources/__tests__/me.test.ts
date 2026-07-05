// Vitest unit tests for src/api/resources/me.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
  },
}));

import { http } from '../../http';
import { getMe, type MeResponse } from '../me';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

const fixture = (over: Partial<MeResponse> = {}): MeResponse => ({
  id: 7,
  username: 'admin',
  role: 'ADMIN',
  active: true,
  createdAt: '2026-04-01T09:00:00Z',
  email: null,
  assignedProjectIds: [],
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
});

describe('getMe', () => {
  it('GETs /api/me and returns the response (normalized)', async () => {
    const response = fixture({ assignedProjectIds: [4, 7] });
    mockGet.mockResolvedValueOnce({ data: response });

    const result = await getMe();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/me');
    // Single positional arg — no params, no per-request config leak.
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toEqual(response);
  });

  it('parses assignedProjectIds for an operator', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture({ role: 'OPERATOR', assignedProjectIds: [4, 7] }) });
    const result = await getMe();
    expect(result.assignedProjectIds).toEqual([4, 7]);
  });

  it('returns [] for a non-operator with an empty assignedProjectIds', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture({ role: 'ADMIN', assignedProjectIds: [] }) });
    const result = await getMe();
    expect(result.assignedProjectIds).toEqual([]);
  });

  it('defaults assignedProjectIds to [] when the wire omits it entirely', async () => {
    // Older backend that doesn't send the key — must never be undefined.
    const { assignedProjectIds: _omit, ...withoutIds } = fixture();
    void _omit;
    mockGet.mockResolvedValueOnce({ data: withoutIds });
    const result = await getMe();
    expect(result.assignedProjectIds).toEqual([]);
  });

  it('coerces a malformed assignedProjectIds to [] and filters non-numbers', async () => {
    mockGet.mockResolvedValueOnce({ data: { ...fixture(), assignedProjectIds: 'nope' } });
    expect((await getMe()).assignedProjectIds).toEqual([]);

    mockGet.mockResolvedValueOnce({ data: { ...fixture(), assignedProjectIds: [1, 'x', 2] } });
    expect((await getMe()).assignedProjectIds).toEqual([1, 2]);
  });

  it('returns the same shape for every Role value (the wire enum is stable)', async () => {
    const roles: readonly MeResponse['role'][] = ['ADMIN', 'OPERATOR', 'VIEWER', 'ADVERTISER'];
    for (const role of roles) {
      mockGet.mockResolvedValueOnce({ data: fixture({ role }) });
      const result = await getMe();
      expect(result.role).toBe(role);
    }
  });

  it('parses a string email and coerces a missing/non-string email to null', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture({ email: 'recover@example.com' }) });
    expect((await getMe()).email).toBe('recover@example.com');

    const { email: _omit, ...withoutEmail } = fixture();
    void _omit;
    mockGet.mockResolvedValueOnce({ data: withoutEmail });
    expect((await getMe()).email).toBeNull();

    mockGet.mockResolvedValueOnce({ data: { ...fixture(), email: 123 } });
    expect((await getMe()).email).toBeNull();
  });

  it('returns active: false verbatim (deactivated user can still call /me)', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture({ active: false }) });
    const result = await getMe();
    expect(result.active).toBe(false);
  });

  it('propagates 401 unchanged so the global interceptor can refresh-and-retry', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 401',
      response: { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockGet.mockRejectedValueOnce(err);

    await expect(getMe()).rejects.toBe(err);
  });

  it('propagates network errors unchanged', async () => {
    const networkErr = new Error('Network Error');
    mockGet.mockRejectedValueOnce(networkErr);
    await expect(getMe()).rejects.toBe(networkErr);
  });
});
