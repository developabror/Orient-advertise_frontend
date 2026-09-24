/**
 * How far this browser's clock is from the server's, measured rather than assumed (VG-11 / FE-05).
 *
 * <p>Access tokens are judged expired by comparing `exp` with the local clock. On a machine whose
 * clock runs fast that is a lockout, not a check: the server issues a token valid for the next
 * fifteen minutes, the browser decides it expired before it arrived, and login "succeeds" while the
 * session never starts — with nothing on screen to explain it. A user cannot fix what they are not
 * told, and plenty of retail PCs have no working time sync.
 *
 * <p>The measurement comes from the `Date` header every HTTP response carries, which is the server's
 * clock at the moment it answered. Deliberately NOT the token's `iat`: that only equals the skew
 * while the token is brand new, and nothing in this module can tell "my clock is an hour fast" from
 * "this token is an hour old". A response header cannot be stale by construction, and `Date` is
 * CORS-safelisted, so it is readable without the server opting in.
 *
 * <p>Not persisted: the first response of a session re-measures it. The server stays the authority on
 * expiry either way — a 401 still drives the refresh — so this only decides how long the app trusts
 * a token it already holds.
 */

/** Positive when this browser is AHEAD of the server. */
let skewMs = 0;

/** Latency and rounding make a small difference meaningless; below this it is not skew. */
const NOISE_FLOOR_MS = 2_000;

/** Beyond this, a `Date` we cannot believe (a broken proxy clock) is likelier than a real skew. */
const IMPLAUSIBLE_MS = 24 * 60 * 60 * 1000;

/**
 * Record the server's own clock, as reported by a response's `Date` header. Safe to call for every
 * response, including error responses — each one re-measures, so the figure never goes stale.
 */
export const recordServerTime = (dateHeader: unknown): void => {
  if (typeof dateHeader !== 'string') return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;
  const measured = Date.now() - serverMs;
  if (Math.abs(measured) > IMPLAUSIBLE_MS) return;
  skewMs = Math.abs(measured) < NOISE_FLOOR_MS ? 0 : measured;
};

/** The server's clock, as best we can tell. Use this for anything that compares against `exp`. */
export const serverNow = (): number => Date.now() - skewMs;

/** Signed skew in milliseconds; positive means this browser is ahead. For diagnostics and copy. */
export const getClockSkewMs = (): number => skewMs;

/** Test seam: forget what we measured. */
export const resetClockSkew = (): void => {
  skewMs = 0;
};
