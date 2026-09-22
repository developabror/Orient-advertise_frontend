// Exercises the REAL request/response interceptors on the REAL `http` instance.
//
// The sibling http.test.ts replaces axios.create wholesale and stubs BOTH
// interceptors to no-ops, so the 401 → refresh → retry path has zero coverage
// there. Here only the transport is swapped (http.defaults.adapter), so every
// line of the interceptor chain in http.ts actually runs.
//
// Not covered here: refreshOnce's Web Locks branch. jsdom implements neither
// BroadcastChannel nor navigator.locks, so refreshOnce always takes its
// documented non-Locks fallback. Real cross-tab lock semantics need a browser
// test, not a fake `navigator.locks` shim that would prove nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

// Mocking the channel is mandatory, not a convenience: the real broadcast()
// constructs a BroadcastChannel, which jsdom does not implement. It doubles as
// the "did we just log every tab out?" spy.
vi.mock('../authChannel', () => ({
  broadcast: vi.fn(),
  onBroadcast: vi.fn(() => () => undefined),
}));

// notify dedups identical messages for 1000ms of REAL time in module-level
// state that nothing resets between tests, so two tests both expecting
// "Session expired…" would silently swallow the second. Replace the module
// rather than fight the clock.
vi.mock('../notify', () => ({
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  onToast: vi.fn(() => () => undefined),
}));

import { http } from '../http';
import { broadcast } from '../authChannel';
import { notify } from '../notify';
import { tokenStore } from '../tokenStore';

const broadcastMock = vi.mocked(broadcast);
const notifyError = vi.mocked(notify.error);
const LOGOUT = { type: 'logout' } as const;
const SESSION_EXPIRED = 'Session expired. Please log in again.';

// --- fake transport ---------------------------------------------------------

/** `status: 0` means "no response at all" — offline, DNS, CORS, TLS. */
interface Reply {
  readonly status: number;
  readonly data?: unknown;
}
interface Call {
  readonly url: string;
  readonly authorization: string;
}

const ok = (data: unknown = {}): Reply => ({ status: 200, data });
const fail = (status: number, data: unknown = {}): Reply => ({ status, data });
const offline = (): Reply => ({ status: 0 });

let replies: Record<string, Reply[]>;
let calls: Call[];
/** Side effects keyed by 1-based adapter call number, to stage a cross-tab race. */
let onCall: Record<number, () => void>;

const adapter: AxiosAdapter = (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '';
  calls.push({
    url,
    // Snapshot NOW: the interceptor mutates header state around the replay, so
    // reading it after the fact would lie.
    authorization: String(config.headers.get('Authorization') ?? ''),
  });
  onCall[calls.length]?.();

  const reply = replies[url]?.shift();
  if (reply === undefined) {
    return Promise.reject(new Error(`no queued reply for ${url}`));
  }
  if (reply.status === 0) {
    return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {}));
  }
  const response = {
    data: reply.data ?? {},
    status: reply.status,
    statusText: '',
    headers: new AxiosHeaders(),
    config,
    request: {},
  } as AxiosResponse;
  if (reply.status >= 200 && reply.status < 300) return Promise.resolve(response);
  // The same shape a real adapter hands dispatchRequest, so axios.isAxiosError()
  // passes and error.response.status is readable inside the interceptor.
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${String(reply.status)}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    ),
  );
};

const originalAdapter = http.defaults.adapter;

beforeEach(() => {
  vi.clearAllMocks();
  replies = {};
  calls = [];
  onCall = {};
  tokenStore.set('T1');
  http.defaults.adapter = adapter;
});

afterEach(() => {
  tokenStore.set(null);
  http.defaults.adapter = originalAdapter;
});

const urls = (): string[] => calls.map((c) => c.url);

describe('401 → refresh → retry', () => {
  it('replays with the rotated token and hands the caller the replay body', async () => {
    replies = {
      '/api/devices': [fail(401), ok({ items: [1, 2] })],
      '/api/auth/refresh': [ok({ accessToken: 'T2' })],
    };

    const res = await http.get<{ items: number[] }>('/api/devices');

    expect(res.data).toEqual({ items: [1, 2] });
    expect(urls()).toEqual(['/api/devices', '/api/auth/refresh', '/api/devices']);
    expect(calls[0]?.authorization).toBe('Bearer T1');
    expect(calls[2]?.authorization).toBe('Bearer T2');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
  });

  it('does NOT end the session when the REPLAY fails for a non-auth reason', async () => {
    replies = {
      '/api/devices': [fail(401), fail(409, { message: 'Device is busy' })],
      '/api/auth/refresh': [ok({ accessToken: 'T2' })],
    };

    await expect(http.get('/api/devices')).rejects.toMatchObject({
      response: { status: 409 },
      config: { url: '/api/devices' },
    });

    expect(tokenStore.get()).toBe('T2');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).not.toHaveBeenCalledWith(SESSION_EXPIRED);
  });

  it('does NOT end the session when the replay is aborted mid-flight (FE-01 repro)', async () => {
    const controller = new AbortController();
    replies = {
      '/api/devices': [fail(401)],
      '/api/auth/refresh': [ok({ accessToken: 'T2' })],
    };
    // The user navigates away / changes a filter while the refresh is resolving.
    onCall[2] = () => {
      controller.abort();
    };

    const err: unknown = await http
      .get('/api/devices', { signal: controller.signal })
      .catch((e: unknown) => e);

    expect(axios.isCancel(err)).toBe(true);
    expect(tokenStore.get()).toBe('T2');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).not.toHaveBeenCalled(); // not even "Network error"
  });

  it('ends the session when the server REJECTS the refresh', async () => {
    replies = {
      '/api/devices': [fail(401)],
      '/api/auth/refresh': [fail(401, { message: 'refresh token expired' })],
    };

    await expect(http.get('/api/devices')).rejects.toMatchObject({
      response: { status: 401 },
      config: { url: '/api/devices' }, // the caller's error, not the refresh's
    });

    expect(tokenStore.get()).toBeNull();
    expect(broadcastMock).toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).toHaveBeenCalledWith(SESSION_EXPIRED);
  });

  it.each([
    ['offline', offline(), 'Network error. Check your connection.'],
    ['503', fail(503), 'Service temporarily unavailable. Please try again.'],
    ['500', fail(500), 'Something went wrong on our end.'],
    // Rate-limited refresh: a retry-later signal, not a dead session. The
    // security skill mandates 5/min/IP on auth routes, so a thundering herd
    // after a deploy must not log the whole fleet out.
    ['429', fail(429), undefined],
  ])('SURVIVES a refresh that never answered about the cookie (%s)', async (_label, reply, toast) => {
    replies = { '/api/devices': [fail(401)], '/api/auth/refresh': [reply] };

    await expect(http.get('/api/devices')).rejects.toMatchObject({ response: { status: 401 } });

    expect(tokenStore.get()).toBe('T1');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).not.toHaveBeenCalledWith(SESSION_EXPIRED);
    if (toast !== undefined) expect(notifyError).toHaveBeenCalledWith(toast);
  });

  it('SURVIVES a 200 refresh whose body is unreadable', async () => {
    // A proxy interstitial or a half-finished deploy — zero evidence that the
    // HttpOnly refresh cookie is invalid.
    replies = { '/api/devices': [fail(401)], '/api/auth/refresh': [ok({ nope: true })] };

    await expect(http.get('/api/devices')).rejects.toMatchObject({ response: { status: 401 } });

    expect(tokenStore.get()).toBe('T1');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
  });

  it('ends the session when the REPLAY comes back 401 again', async () => {
    replies = {
      '/api/devices': [fail(401), fail(401)],
      '/api/auth/refresh': [ok({ accessToken: 'T2' })],
    };

    await expect(http.get('/api/devices')).rejects.toMatchObject({ response: { status: 401 } });

    expect(tokenStore.get()).toBeNull();
    expect(broadcastMock).toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).toHaveBeenCalledWith(SESSION_EXPIRED);
    // EXACTLY one refresh — proves _retry survived mergeConfig into the replay.
    expect(urls().filter((u) => u === '/api/auth/refresh')).toHaveLength(1);
  });

  it('does NOT end the session when another tab rotated the token during the replay', async () => {
    replies = {
      '/api/devices': [fail(401), fail(401)],
      '/api/auth/refresh': [ok({ accessToken: 'T2' })],
    };
    // Tab B's 'token' broadcast landing mid-replay; AuthProvider's handler is
    // just tokenStore.set(). The replay is adapter call #3, and the request
    // interceptor has already stamped _tokenAtSend=T2 by then.
    onCall[3] = () => {
      tokenStore.set('T3');
    };

    await expect(http.get('/api/devices')).rejects.toMatchObject({ response: { status: 401 } });

    expect(tokenStore.get()).toBe('T3');
    expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    expect(notifyError).not.toHaveBeenCalledWith(SESSION_EXPIRED);
  });

  it('leaves a 401 from an auth endpoint completely alone', async () => {
    replies = { '/api/auth/login': [fail(401, { message: 'Bad credentials' })] };

    await expect(
      http.post('/api/auth/login', { username: 'a', password: 'b' }),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(urls()).toEqual(['/api/auth/login']); // no refresh was attempted
    expect(tokenStore.get()).toBe('T1');
    expect(notifyError).not.toHaveBeenCalled();
  });
});

describe('the refresh failure budget', () => {
  // Not ending the session on an inconclusive refresh is only safe if the
  // client also stops hammering the route. The refresh budget is per IP with no
  // account dimension, so an unbraked tab starves every colleague behind the
  // same NAT — and under the reluctance rule those starved tabs then retry too.
  const queue = (n: number, reply: Reply): Reply[] => Array.from({ length: n }, () => reply);

  /** One request that 401s; swallow whatever comes back. */
  const attempt = async (): Promise<void> => {
    await http.get('/api/devices').catch(() => undefined);
  };

  const refreshCount = (): number => urls().filter((u) => u === '/api/auth/refresh').length;

  it('backs off instead of re-hitting a rate-limited refresh on every poll', async () => {
    vi.useFakeTimers();
    try {
      replies = { '/api/devices': queue(6, fail(401)), '/api/auth/refresh': queue(6, fail(429)) };

      for (let i = 0; i < 6; i += 1) await attempt();

      // Six failing polls must NOT mean six refresh calls.
      expect(refreshCount()).toBe(1);
      expect(tokenStore.get()).toBe('T1');
      expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tries again once the cooldown has elapsed', async () => {
    vi.useFakeTimers();
    try {
      replies = { '/api/devices': queue(4, fail(401)), '/api/auth/refresh': queue(4, fail(503)) };

      await attempt();
      expect(refreshCount()).toBe(1);

      await attempt(); // still cooling down
      expect(refreshCount()).toBe(1);

      vi.setSystemTime(Date.now() + 200_000); // past the capped backoff + jitter
      await attempt();
      expect(refreshCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('eventually gives up, so the session converges instead of spinning forever', async () => {
    vi.useFakeTimers();
    try {
      replies = { '/api/devices': queue(40, fail(401)), '/api/auth/refresh': queue(40, fail(429)) };

      for (let i = 0; i < 40 && tokenStore.get() !== null; i += 1) {
        vi.setSystemTime(Date.now() + 200_000); // skip each cooldown
        await attempt();
      }

      // A logged-in-looking shell over an API that refuses everything is worse
      // than a login screen, so sustained failure must still end the session.
      expect(tokenStore.get()).toBeNull();
      expect(broadcastMock).toHaveBeenCalledWith(LOGOUT);
      // …but only after a genuine outage, not one blip.
      expect(refreshCount()).toBeGreaterThanOrEqual(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a successful refresh clears the budget', async () => {
    vi.useFakeTimers();
    try {
      replies = {
        // The 3rd entry is the successful REPLAY of the 2nd attempt.
        '/api/devices': [fail(401), fail(401), ok(), fail(401)],
        '/api/auth/refresh': [fail(503), ok({ accessToken: 'T2' })],
      };

      await attempt(); // failure #1, starts a cooldown
      vi.setSystemTime(Date.now() + 200_000);
      await attempt(); // succeeds -> budget reset via the tokenStore subscription

      expect(tokenStore.get()).toBe('T2');
      // Not cooling down any more: the next 401 refreshes immediately.
      replies['/api/auth/refresh'] = [fail(503)];
      await attempt();
      expect(refreshCount()).toBe(3);
      expect(broadcastMock).not.toHaveBeenCalledWith(LOGOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the transport ladder survives the extraction', () => {
  it.each([
    ['403', fail(403), "You don't have access to that resource."],
    ['503', fail(503), 'Service temporarily unavailable. Please try again.'],
    ['500', fail(500), 'Something went wrong on our end.'],
    ['offline', offline(), 'Network error. Check your connection.'],
  ])('toasts the right copy for a non-401 (%s)', async (_label, reply, toast) => {
    replies = { '/api/devices': [reply] };

    await expect(http.get('/api/devices')).rejects.toBeDefined();

    expect(notifyError).toHaveBeenCalledWith(toast);
    expect(urls()).toEqual(['/api/devices']);
  });
});
