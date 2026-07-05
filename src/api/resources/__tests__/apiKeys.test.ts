// Vitest unit tests for src/api/resources/apiKeys.ts.

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
  listApiKeys,
  mintApiKey,
  revokeApiKey,
  type ApiKeySummary,
  type CreatedKey,
} from '../apiKeys';

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

const activeSummary = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: 1,
  prefix: 'oa_live_aaaa',
  clientName: 'Partner X',
  status: 'ACTIVE',
  createdAt: '2026-05-08T10:00:00Z',
  revokedAt: null,
  revokedBy: null,
  ...over,
});

const revokedSummary = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: 1,
  prefix: 'oa_live_aaaa',
  clientName: 'Partner X',
  status: 'REVOKED',
  createdAt: '2026-05-08T10:00:00Z',
  revokedAt: '2026-05-08T11:00:00Z',
  revokedBy: 'admin@orient',
  ...over,
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

describe('listApiKeys', () => {
  it('GETs /api/admin/api-keys and returns the array verbatim', async () => {
    const arr: ApiKeySummary[] = [activeSummary({ id: 1 }), revokedSummary({ id: 2 })];
    mockGet.mockResolvedValueOnce({ data: arr });

    const result = await listApiKeys();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/admin/api-keys');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    // Verbatim — same array reference.
    expect(result).toBe(arr);
  });

  it('includes REVOKED rows in the result (the list is full lifecycle)', async () => {
    const arr: ApiKeySummary[] = [revokedSummary()];
    mockGet.mockResolvedValueOnce({ data: arr });

    const result = await listApiKeys();
    expect(result[0]!.status).toBe('REVOKED');
    expect(result[0]!.revokedBy).toBe('admin@orient');
  });
});

describe('mintApiKey', () => {
  const created: CreatedKey = {
    id: 99,
    rawKey: 'oa_live_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    prefix: 'oa_live_AbCd',
    clientName: 'Partner X',
    createdAt: '2026-05-08T10:00:00Z',
  };

  it('POSTs /api/admin/api-keys with body { clientName } and returns CreatedKey verbatim', async () => {
    mockPost.mockResolvedValueOnce({ data: created });

    const result = await mintApiKey('Partner X');

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/admin/api-keys', { clientName: 'Partner X' });
    // url + body, no third per-request config.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
    // Verbatim reference — caller is the only owner of the rawKey value.
    expect(result).toBe(created);
    expect(result.rawKey).toBe(created.rawKey);
  });

  it('forwards an empty body field (clientName: "") rather than synthesising', async () => {
    // Backend will 400 on empty clientName, but the resource doesn't
    // pre-validate — the form is the right place for that.
    mockPost.mockResolvedValueOnce({ data: created });

    await mintApiKey('');

    expect(mockPost).toHaveBeenCalledWith('/api/admin/api-keys', { clientName: '' });
  });

  it('NEVER writes the rawKey to console (security: no incidental logging in resource layer)', async () => {
    mockPost.mockResolvedValueOnce({ data: created });

    // Spy on every console method that could leak the key.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    try {
      const result = await mintApiKey('Partner X');
      expect(result.rawKey).toBe(created.rawKey);

      // Concatenate every console arg from every method into one string,
      // then assert the rawKey substring never appears. This catches both
      // direct logging (`console.log(rawKey)`) and indirect logging via
      // an object payload (`console.log({ key: rawKey })`).
      const allArgs: unknown[] = [
        ...log.mock.calls.flat(),
        ...warn.mock.calls.flat(),
        ...error.mock.calls.flat(),
        ...info.mock.calls.flat(),
        ...debug.mock.calls.flat(),
      ];
      const haystack = allArgs
        .map((a) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join('|');
      expect(haystack).not.toContain(created.rawKey);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      info.mockRestore();
      debug.mockRestore();
    }
  });

  it('propagates errors unchanged (rawKey never appears in the rejection path because there is none)', async () => {
    const err = new Error('Network Error');
    mockPost.mockRejectedValueOnce(err);

    await expect(mintApiKey('Partner X')).rejects.toBe(err);
    // On rejection there is no rawKey to leak — the resource never
    // synthesised one. This is the implicit guarantee.
  });
});

describe('revokeApiKey', () => {
  it('sends DELETE /api/admin/api-keys/{id} and returns the updated summary', async () => {
    const revoked = revokedSummary({ id: 1 });
    mockDelete.mockResolvedValueOnce({ data: revoked });

    const result = await revokeApiKey(1);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/admin/api-keys/1');
    expect(mockDelete.mock.calls[0]).toHaveLength(1);
    // Verbatim reference — caller can splice it into the list in place.
    expect(result).toBe(revoked);
    expect(result.status).toBe('REVOKED');
    expect(result.revokedAt).toBe('2026-05-08T11:00:00Z');
    expect(result.revokedBy).toBe('admin@orient');
  });

  it('lets a 409 (already revoked) axios error bubble unchanged', async () => {
    const err = make409('API key is already revoked');
    mockDelete.mockRejectedValueOnce(err);

    await expect(revokeApiKey(1)).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('already revoked');
  });

  it('propagates 403 unchanged (non-ADMIN caller)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: 'Forbidden', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    // Global interceptor toasts 403 — we deliberately don't suppress
    // for this destructive ADMIN-only endpoint.
    await expect(revokeApiKey(1)).rejects.toBe(err);
  });

  it('does not double-call http.delete on failure', async () => {
    mockDelete.mockRejectedValueOnce(make409('already revoked'));
    await expect(revokeApiKey(1)).rejects.toBeDefined();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
