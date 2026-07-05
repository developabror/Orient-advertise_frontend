// Vitest unit tests for the cookie-driven auth flow in http.ts.
//
// Asserts the migration from body-based refresh tokens to the HttpOnly
// refresh_token cookie model:
//   1. The shared axios instance is created with withCredentials: true so
//      the browser attaches/persists the refresh_token cookie.
//   2. loginWithCredentials accepts an { accessToken }-only 200 response
//      and stores the access token; a malformed body (missing accessToken)
//      throws.
//   3. refreshAccessToken POSTs /api/auth/refresh with NO request body —
//      the cookie carries the refresh token — and stores the rotated
//      access token from { accessToken }.
//   4. logoutServer POSTs /api/auth/logout with NO body and always clears
//      the in-memory access token, even when the server responds with an
//      error (idempotent logout).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  env: { apiUrl: 'http://localhost:8080', wsUrl: 'ws://localhost:8080/ws' },
}));

// Capture the config axios.create was called with, and stub .post so each
// test can dictate the response per-call. Interceptors are stubbed to no-ops
// since these tests exercise the function exports directly, not the 401
// retry interceptor (that has its own coverage path via wsClient.test.ts).
// vi.hoisted is needed because vi.mock factories run BEFORE top-level vars
// initialize — without hoisting these refs would be TDZ at mock-time.
const { createSpy, postSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  postSpy: vi.fn(),
}));

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: unknown) => {
        createSpy(config);
        return {
          post: postSpy,
          interceptors: {
            request: { use: () => 0 },
            response: { use: () => 0 },
          },
        };
      },
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

// Import AFTER the mock so http.ts picks up the stubbed axios.
import {
  http,
  loginWithCredentials,
  logoutServer,
  refreshAccessToken,
} from '../http';
import { tokenStore } from '../tokenStore';

beforeEach(() => {
  postSpy.mockReset();
  tokenStore.set(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('http axios instance', () => {
  it('is created with withCredentials enabled so the refresh cookie is sent', () => {
    // The axios.create call ran at module load — we assert against the
    // captured config rather than re-instantiating.
    expect(createSpy).toHaveBeenCalled();
    const cfg = createSpy.mock.calls[0]?.[0] as { withCredentials: boolean } | undefined;
    expect(cfg?.withCredentials).toBe(true);
    expect(http).toBeDefined();
  });
});

describe('loginWithCredentials', () => {
  it('accepts a { accessToken }-only 200 and stores the access token', async () => {
    postSpy.mockResolvedValueOnce({ data: { accessToken: 'access.jwt.value' } });

    await loginWithCredentials('alice', 's3cret');

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0] as [string, unknown];
    expect(url).toBe('/api/auth/login');
    expect(body).toEqual({ username: 'alice', password: 's3cret' });
    expect(tokenStore.get()).toBe('access.jwt.value');
  });

  it('throws on a malformed response that omits accessToken', async () => {
    postSpy.mockResolvedValueOnce({ data: { somethingElse: true } });

    await expect(loginWithCredentials('alice', 's3cret')).rejects.toThrow(
      'Malformed login response',
    );
    expect(tokenStore.get()).toBeNull();
  });
});

describe('refreshAccessToken', () => {
  it('POSTs /api/auth/refresh with NO body — the cookie carries the token', async () => {
    postSpy.mockResolvedValueOnce({ data: { accessToken: 'rotated.jwt.value' } });

    const result = await refreshAccessToken();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0] as [string, unknown];
    expect(url).toBe('/api/auth/refresh');
    // The second arg must be `undefined` so axios sends no payload; passing
    // an object would send `{}` which the backend rejects.
    expect(body).toBeUndefined();
    expect(result).toBe('rotated.jwt.value');
    expect(tokenStore.get()).toBe('rotated.jwt.value');
  });

  it('rejects a refresh response missing accessToken', async () => {
    postSpy.mockResolvedValueOnce({ data: { foo: 'bar' } });

    await expect(refreshAccessToken()).rejects.toThrow('Malformed refresh response');
  });
});

describe('logoutServer', () => {
  it('POSTs /api/auth/logout with NO body and clears the access token', async () => {
    tokenStore.set('still-valid.jwt');
    postSpy.mockResolvedValueOnce({ status: 204 });

    await logoutServer();

    const [url, body] = postSpy.mock.calls[0] as [string, unknown];
    expect(url).toBe('/api/auth/logout');
    expect(body).toBeUndefined();
    expect(tokenStore.get()).toBeNull();
  });

  it('still clears local state when the server call fails (idempotent logout)', async () => {
    tokenStore.set('still-valid.jwt');
    postSpy.mockRejectedValueOnce(new Error('network down'));

    await expect(logoutServer()).rejects.toThrow('network down');
    expect(tokenStore.get()).toBeNull();
  });
});
