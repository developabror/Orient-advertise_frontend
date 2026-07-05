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

const isAuthEndpoint = (url: string | undefined): boolean =>
  url === '/api/auth/login' || url === '/api/auth/refresh' || url === '/api/auth/logout';

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

export const logoutServer = async (): Promise<void> => {
  try {
    // No request body — the refresh token rides on the HttpOnly cookie. The
    // server returns 204 even when the cookie is missing or unknown, so
    // logout is idempotent.
    await http.post('/api/auth/logout', undefined, { _suppressErrorToast: true });
  } finally {
    tokenStore.set(null);
    broadcast({ type: 'logout' });
  }
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

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw error;
    const original = error.config;
    const status = error.response?.status;
    const suppressToast = original?._suppressErrorToast ?? false;

    if (status === 401 && original && !original._retry && !isAuthEndpoint(original.url)) {
      original._retry = true;
      try {
        const newToken = await refreshOnce(original._tokenAtSend ?? null);
        original.headers.set('Authorization', `Bearer ${newToken}`);
        original._tokenAtSend = newToken;
        return await http.request(original);
      } catch (refreshErr) {
        tokenStore.set(null);
        broadcast({ type: 'logout' });
        if (!suppressToast) notify.error('Session expired. Please log in again.');
        throw refreshErr;
      }
    }

    if (!suppressToast) {
      if (status === undefined) {
        notify.error('Network error. Check your connection.');
      } else if (status === 403) {
        notify.error("You don't have access to that resource.");
      } else if (status === 503) {
        notify.error('Service temporarily unavailable. Please try again.');
      } else if (status >= 500) {
        notify.error('Something went wrong on our end.');
      }
      // 401 from auth endpoints (bad creds, expired refresh) falls through;
      // callers handle their own messaging. Business 4xx (400/404/409/422 …)
      // are handled by the error-dialog block below.
    }

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
