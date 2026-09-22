import axios from 'axios';
import { env } from './env';
import { tokenStore } from './tokenStore';
import { broadcast } from './authChannel';
import { notify } from './notify';
import { attachErrorClaim, buildErrorDialogContent, errorDialog } from './errorDialog';

declare module 'axios' {
  export interface AxiosRequestConfig {
    _suppressErrorToast?: boolean;
    // Opt out of the global error-dialog modal for this request. Honoured for
    // callers that know up front they'll render the error themselves. Distinct
    // from `_suppressErrorToast`, which silences only the generic toast and does
    // NOT suppress the modal. For after-the-fact opt-out from a catch block, use
    // `markErrorHandled(err)` from `./errorDialog`.
    _suppressErrorModal?: boolean;
  }
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
    _tokenAtSend?: string;
  }
}

// baseURL is the API origin only (e.g. http://localhost:8080). Every request
// path in the codebase is absolute under that origin — `/api/...` for app
// endpoints, `/api/auth/...` for auth. To repoint at production, change
// VITE_API_URL in .env to the production origin and rebuild/redeploy. Nothing
// else needs to change.
export const http = axios.create({
  baseURL: env.apiUrl,
  // The refresh token rides as an HttpOnly `refresh_token` cookie set by the
  // backend on /api/auth/login and rotated on /api/auth/refresh. The browser
  // must send it back on every refresh/logout call, so credentials must be
  // included on every request from this client.
  withCredentials: true,
  // A request that never settles would park `activeRefresh` forever and, since
  // "never answered" now deliberately does NOT end the session, wedge the app
  // with no toast and no teardown. Bound it.
  timeout: 30_000,
});

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
    config._tokenAtSend = token;
  }
  return config;
});

interface AccessTokenResponse {
  readonly accessToken: string;
}

const isAccessTokenResponse = (value: unknown): value is AccessTokenResponse => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === 'string';
};

// Prefix, not an exact list: /api/auth/forgot-password and /api/auth/reset-password
// are auth routes too, and a 401 from one used to enter the refresh path — firing
// /api/auth/refresh from a browser that is by definition logged out, and spending
// the shared per-IP refresh budget from an unauthenticated page. A prefix also
// survives the next auth route someone adds.
const isAuthEndpoint = (url: string | undefined): boolean =>
  url?.startsWith('/api/auth/') ?? false;

export const refreshAccessToken = async (): Promise<string> => {
  // The refresh token is in an HttpOnly cookie set by the backend; the browser
  // attaches it automatically because withCredentials is true. No request body
  // is sent. The rotated refresh token comes back as a fresh Set-Cookie that
  // the browser persists out-of-band.
  const { data } = await http.post<unknown>('/api/auth/refresh', undefined, {
    _suppressErrorToast: true,
  });
  if (!isAccessTokenResponse(data)) throw new Error('Malformed refresh response');
  tokenStore.set(data.accessToken);
  broadcast({ type: 'token', accessToken: data.accessToken });
  return data.accessToken;
};

export const loginWithCredentials = async (username: string, password: string): Promise<void> => {
  const { data } = await http.post<unknown>(
    '/api/auth/login',
    { username, password },
    { _suppressErrorToast: true },
  );
  if (!isAccessTokenResponse(data)) throw new Error('Malformed login response');
  // The matching `refresh_token` HttpOnly cookie was set by the backend in the
  // Set-Cookie header of this same 200 response — the browser stores it; the
  // frontend cannot (and should not) read it.
  tokenStore.set(data.accessToken);
  broadcast({ type: 'token', accessToken: data.accessToken });
};

// The single owner of CLIENT-side session teardown: drops the in-memory access
// token and tells every other tab (AuthProvider mirrors the broadcast,
// ProtectedRoute then redirects to /login). It deliberately does NOT invalidate
// the refresh cookie server-side — only logoutServer() does that — so a user
// torn down here can still be restored by AuthProvider's bootstrap refresh on
// the next page load, which is the right outcome if the teardown was wrong.
//
// Call this ONLY when the session is genuinely dead. A false positive logs the
// operator out of every open tab in the middle of their work and throws away
// unsaved form state — which is exactly the bug (FE-01) that made this a named
// function instead of two lines copy-pasted into every error path.
const endSession = (notifyUser: boolean): void => {
  tokenStore.set(null);
  broadcast({ type: 'logout' });
  if (notifyUser) notify.error('Session expired. Please log in again.');
};

export const logoutServer = async (): Promise<void> => {
  try {
    // No request body — the refresh token rides on the HttpOnly cookie. The
    // server returns 204 even when the cookie is missing or unknown, so
    // logout is idempotent.
    await http.post('/api/auth/logout', undefined, { _suppressErrorToast: true });
  } finally {
    // No toast: the user asked for this, and the call sites render their own
    // confirmation.
    endSession(false);
  }
};

// ── Refresh failure budget ──────────────────────────────────────────────────
//
// A refresh that never answered ABOUT THE COOKIE is not evidence the session is
// dead (see isSessionEndingRefreshFailure). It is not evidence it is alive
// either, and retrying it on every poll is how a transient failure becomes a
// permanent one: our own retries keep the bucket empty. The refresh route is
// budgeted per IP with no account dimension, so every tab behind one office NAT
// shares it — a single wedged tab polling every 30s can starve all of them, and
// without a brake the starved tabs then retry too. The server sends no
// Retry-After, so this is the only backoff that exists.
//
// The cap exists so the failure still CONVERGES. Without it a sustained outage
// leaves a logged-in-looking shell over an API that refuses every call, which
// is worse for the operator than a login screen. ~6 minutes of sustained
// failure is long enough that it is an outage rather than a blip.
const REFRESH_BACKOFF_BASE_MS = 5_000;
const REFRESH_BACKOFF_MAX_MS = 120_000;
const MAX_INCONCLUSIVE_REFRESH_FAILURES = 8;

let inconclusiveRefreshFailures = 0;
let refreshBlockedUntil = 0;

// Holding ANY usable token means the refresh route is working, whoever got it —
// our own refresh, a login, or another tab's broadcast. That is the reset.
tokenStore.subscribe((token) => {
  if (token !== null) {
    inconclusiveRefreshFailures = 0;
    refreshBlockedUntil = 0;
  }
});

const refreshIsCoolingDown = (): boolean => Date.now() < refreshBlockedUntil;

/** @returns true once the failures have run long enough to give up on. */
const noteInconclusiveRefreshFailure = (err: unknown): boolean => {
  inconclusiveRefreshFailures += 1;
  const backoff = Math.min(
    REFRESH_BACKOFF_MAX_MS,
    REFRESH_BACKOFF_BASE_MS * 2 ** (inconclusiveRefreshFailures - 1),
  );
  // Honour Retry-After if the backend ever starts sending one (it does not today).
  const header: unknown = axios.isAxiosError(err)
    ? err.response?.headers['retry-after']
    : undefined;
  const seconds = typeof header === 'string' || typeof header === 'number' ? Number(header) : 0;
  const hintMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  // Jitter, so N tabs x N polling hooks don't re-storm on the same tick.
  refreshBlockedUntil = Date.now() + Math.max(backoff, hintMs) * (0.5 + Math.random());
  return inconclusiveRefreshFailures >= MAX_INCONCLUSIVE_REFRESH_FAILURES;
};

// Per-tab Promise dedup: every concurrent 401 within this tab awaits the same
// in-flight refresh, so they queue and retry rather than each issuing their
// own /api/auth/refresh call.
let activeRefresh: Promise<string> | null = null;

// Exported so non-axios code paths (e.g. the WebSocket reconnect-on-auth-close
// flow in wsClient.ts) can route through the same coalescing + Web Locks
// machinery. Bypassing this would risk concurrent /api/auth/refresh requests
// across tabs and burn through the single-use refresh-token rotation.
export const refreshOnce = (failedToken: string | null): Promise<string> => {
  if (activeRefresh) return activeRefresh;

  const tryRefresh = async (): Promise<string> => {
    const current = tokenStore.get();
    if (current && current !== failedToken) return current;
    return refreshAccessToken();
  };

  activeRefresh = (async (): Promise<string> => {
    try {
      // Web Locks coordinate refresh across tabs so refresh-token rotation in
      // one tab can't invalidate another tab's session.
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        const result: unknown = await navigator.locks.request('oa.auth.refresh', tryRefresh);
        if (typeof result !== 'string') {
          throw new Error('Refresh lock callback returned a non-string value');
        }
        return result;
      }
      return await tryRefresh();
    } finally {
      activeRefresh = null;
    }
  })();

  return activeRefresh;
};

// The generic transport ladder. Extracted so the refresh path can reuse it:
// that POST runs with `_suppressErrorToast`, so a refresh that dies on the wire
// would otherwise fail completely silently. Business 4xx are deliberately
// absent — those belong to the error dialog below.
const notifyTransportError = (status: number | undefined): void => {
  if (status === undefined) {
    notify.error('Network error. Check your connection.');
  } else if (status === 403) {
    notify.error("You don't have access to that resource.");
  } else if (status === 503) {
    notify.error('Service temporarily unavailable. Please try again.');
  } else if (status >= 500) {
    notify.error('Something went wrong on our end.');
  }
};

// Retry-later answers from the refresh endpoint. A rate limit is a statement
// about traffic, not about the cookie — and the auth routes are rate-limited by
// policy, so treating 429 as "session over" would log the whole fleet out
// during a thundering herd after a deploy.
const REFRESH_RETRYABLE_STATUSES = new Set([408, 429]);

/**
 * Does a FAILED /api/auth/refresh prove the session is over?
 *
 * Only a client-error HTTP response does: the server saw the refresh cookie and
 * rejected it (missing, expired, already rotated, revoked). Everything else —
 * no response at all (offline, DNS, CORS, TLS), a 5xx, a 408/429 "try again",
 * an unreadable 200 body (a proxy interstitial, a half-finished deploy), or the
 * Web Locks wrapper throwing — means we never got an answer ABOUT THE COOKIE.
 * The cookie is HttpOnly and still in the jar, so the next call can try again.
 * Tearing the session down on any of those logs the operator out of every tab
 * because their wifi blipped.
 */
const isSessionEndingRefreshFailure = (err: unknown): boolean => {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return false;
  const status = err.response?.status;
  if (typeof status !== 'number') return false;
  if (REFRESH_RETRYABLE_STATUSES.has(status)) return false;
  return status >= 400 && status < 500;
};

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error;
    // A cancelled request is not a failure — the caller unmounted or changed
    // filters. CanceledError extends AxiosError with no `response`, so without
    // this it lands in the `status === undefined` branch below and toasts
    // "Network error" at an operator who did nothing wrong.
    if (axios.isCancel(error)) throw error;
    const original = error.config;
    const status = error.response?.status;
    const suppressToast = original?._suppressErrorToast ?? false;

    if (status === 401 && original && !isAuthEndpoint(original.url)) {
      if (!original._retry) {
        original._retry = true;

        // Still cooling down from an inconclusive failure: don't spend another
        // request on the rate-limited refresh route. Fail this call; the next
        // one after the window tries again.
        if (refreshIsCoolingDown()) throw error;

        let newToken: string;
        try {
          newToken = await refreshOnce(original._tokenAtSend ?? null);
        } catch (refreshErr) {
          if (isSessionEndingRefreshFailure(refreshErr)) {
            endSession(!suppressToast);
          } else if (noteInconclusiveRefreshFailure(refreshErr)) {
            // Neither renewable nor disprovable, for long enough that this is an
            // outage rather than a blip. Land on /login rather than leave a
            // logged-in-looking shell over an API that refuses every call.
            endSession(!suppressToast);
          } else if (!suppressToast) {
            // The refresh POST suppresses its own toast, so without this a
            // refresh that dies on the wire fails completely silently.
            notifyTransportError(
              axios.isAxiosError(refreshErr) ? refreshErr.response?.status : undefined,
            );
          }
          // Reject with the CALLER's error, not the refresh's: call sites read
          // err.config / err.response to render their own state, and an error
          // about /api/auth/refresh leaks an unrelated request into their UI.
          throw error;
        }
        original.headers.set('Authorization', `Bearer ${newToken}`);
        original._tokenAtSend = newToken;
        // Deliberately OUTSIDE the try. A rejection here is the REPLAYED
        // request failing (404/409/500/abort …), not the refresh — and it has
        // already been through this interceptor on its own pass, toast and
        // error-dialog claim included. Catching it here is what logged every
        // tab out on a rejected form submit (FE-01).
        return await http.request(original);
      }

      // Second 401 on the same request: the token we just minted was rejected
      // too, so the session really is dead — without this the app loops
      // silently, looking logged in while every call 401s.
      //
      // …unless another tab rotated the token WHILE this replay was in flight.
      // Then our 401 is evidence about a token that is already superseded, and
      // ending the session would kill a healthy one — the same bug as FE-01,
      // one layer down. The replay re-runs the request interceptor, which
      // re-stamps `_tokenAtSend` from the store; that is what makes this
      // comparison meaningful, so an "optimization" that skips the interceptor
      // chain on retry would silently disarm the guard.
      if (tokenStore.get() === (original._tokenAtSend ?? null)) {
        endSession(!suppressToast);
      }
    }

    // 401 from auth endpoints (bad creds, expired refresh) falls through;
    // callers handle their own messaging. Business 4xx (400/404/409/422 …)
    // are handled by the error-dialog block below.
    if (!suppressToast) notifyTransportError(status);

    // Global safety net for business 4xx: a mutation the operator just made was
    // rejected by the backend with an operator-facing message. Surface it as a
    // modal UNLESS the caller opted out — either up front via `_suppressErrorModal`
    // or after the fact via markErrorHandled() from its catch. The modal is
    // deferred one macrotask so a synchronous claim in that catch wins the race;
    // field-validation and passive GET errors are filtered out in the builder.
    //
    // NOTE: `_suppressErrorToast` deliberately does NOT suppress the modal. Many
    // mutations set it only to silence the generic 5xx/network toast while they
    // render their own message — but several then show a hardcoded string or
    // swallow the error, losing the real backend reason. Keeping the modal alive
    // is the backstop; any caller that truly handles the message inline cancels
    // it with markErrorHandled(err).
    const suppressModal = original?._suppressErrorModal ?? false;
    const dialogContent = buildErrorDialogContent(error, {
      method: original?.method,
      suppressed: suppressModal,
    });
    if (dialogContent !== null) {
      const claim = attachErrorClaim(error);
      setTimeout(() => {
        if (!claim.handled) errorDialog.show(dialogContent);
      }, 0);
    }

    throw error;
  },
);
