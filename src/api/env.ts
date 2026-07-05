// Env-var canonicalisation. Anything that throws here aborts the app
// boot before the first paint — that's intentional. Misconfigured URLs
// should be loud, not silent: a runtime substitution mistake in the
// Dockerfile or .env file is one of the easier ways for a deploy to
// "look fine" while every API call goes to the wrong host.

const requireEnv = (key: keyof ImportMetaEnv, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required env var: ${String(key)}`);
  }
  return value;
};

/**
 * Canonicalise the WebSocket URL per the BE-19 contract:
 * `ws(s)://<host>/ws` (no trailing slash).
 *
 *   - Trailing `/` is stripped silently — common Dockerfile typo.
 *   - Missing `/ws` suffix throws at boot with a clear message —
 *     fail-fast is safer than silently connecting to the wrong path
 *     and discovering the issue via a 404 storm.
 *
 * Exported for unit testing.
 */
export const canonicalizeWsUrl = (raw: string): string => {
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (!trimmed.endsWith('/ws')) {
    throw new Error(`VITE_WS_URL must end with /ws — got ${raw}`);
  }
  return trimmed;
};

export const env = {
  apiUrl: requireEnv('VITE_API_URL', import.meta.env.VITE_API_URL),
  wsUrl: canonicalizeWsUrl(requireEnv('VITE_WS_URL', import.meta.env.VITE_WS_URL)),
} as const;
