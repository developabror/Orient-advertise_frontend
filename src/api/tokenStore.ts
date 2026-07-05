type Listener = (token: string | null) => void;

// Only the short-lived ACCESS token is held in memory — the long-lived refresh
// token is an HttpOnly `refresh_token` cookie owned by the browser/backend
// (set on /api/auth/login, rotated on /api/auth/refresh, cleared on
// /api/auth/logout). The frontend cannot read it, which is the point: XSS
// can't exfiltrate what the JS heap never sees. A full page reload clears the
// access token from memory, but the cookie persists — so bootstrap can call
// /api/auth/refresh and silently restore the session.
let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string | null): void => {
    if (accessToken === token) return;
    accessToken = token;
    listeners.forEach((fn) => {
      fn(token);
    });
  },
  subscribe: (fn: Listener): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
