const BACKSLASH = 0x5c;
const DELETE = 0x7f;

const hasUnsafeChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === BACKSLASH || code < 0x20 || code === DELETE) return true;
  }
  return false;
};

/**
 * The post-login `?redirect=` target — the one navigation path an attacker controls (a link like
 * `/login?redirect=…` sent to a user). It must stay an in-app path: backslashes and control
 * characters are refused outright (browsers read `/\evil.com` as `//evil.com`, another site), and
 * whatever is left must resolve to our own origin. react-router 6 has an open-redirect advisory for
 * exactly this input (GHSA-wrjc-x8rr-h8h6, fixed only in v7); this check is what closes it (FE-13).
 */
export const safeRedirect = (raw: string | null, fallback = '/dashboard'): string => {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || hasUnsafeChar(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
};
