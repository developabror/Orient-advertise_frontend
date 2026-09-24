// VG-11 / FE-05: a browser whose clock runs fast decided a freshly issued token had already
// expired, so login "succeeded" and the session never started — with nothing on screen to say why.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClockSkewMs, recordServerTime, resetClockSkew, serverNow } from '../clockSkew';
import { tokenToUser } from '../auth';
import { tokenStore } from '../tokenStore';

const base64Url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A token as the backend signs it: `exp` fifteen minutes out, by the SERVER's clock. */
const token = (opts: { serverNowMs: number; lifetimeMinutes?: number }): string => {
  const issued = Math.floor(opts.serverNowMs / 1000);
  return [
    base64Url(JSON.stringify({ alg: 'none' })),
    base64Url(
      JSON.stringify({
        sub: 'olga',
        role: 'OPERATOR',
        iat: issued,
        exp: issued + (opts.lifetimeMinutes ?? 15) * 60,
      }),
    ),
    'sig',
  ].join('.');
};

/** What the server's `Date` header says. */
const serverDate = (ms: number): string => new Date(ms).toUTCString();

beforeEach(() => {
  resetClockSkew();
  tokenStore.set(null);
});

afterEach(() => {
  vi.useRealTimers();
  resetClockSkew();
  tokenStore.set(null);
});

describe('clock skew', () => {
  it('measures nothing when the clocks agree', () => {
    recordServerTime(serverDate(Date.now()));

    expect(getClockSkewMs()).toBe(0);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(2_000);
  });

  it('measures how far this browser is ahead', () => {
    const realNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(realNow + 20 * 60_000); // this PC is 20 minutes fast

    recordServerTime(serverDate(realNow));

    expect(Math.round(getClockSkewMs() / 60_000)).toBe(20);
    // serverNow() undoes it, so anything comparing against `exp` is judged fairly.
    expect(Math.abs(serverNow() - realNow)).toBeLessThan(2_000);
  });

  it('measures a browser running behind, too', () => {
    const realNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(realNow - 9 * 60_000);

    recordServerTime(serverDate(realNow));

    expect(Math.round(getClockSkewMs() / 60_000)).toBe(-9);
  });

  it('ignores sub-second differences — that is latency, not skew', () => {
    recordServerTime(serverDate(Date.now() - 400));

    expect(getClockSkewMs()).toBe(0);
  });

  it('keeps what it knew when a response has no usable Date', () => {
    const realNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(realNow + 20 * 60_000);
    recordServerTime(serverDate(realNow));
    const measured = getClockSkewMs();

    recordServerTime(undefined);
    recordServerTime('not a date');
    recordServerTime(12345);

    expect(getClockSkewMs()).toBe(measured);
  });

  it('refuses a Date it cannot believe — a broken proxy clock is not our skew', () => {
    recordServerTime(serverDate(Date.now() - 400 * 24 * 60 * 60 * 1000));

    expect(getClockSkewMs()).toBe(0);
  });
});

describe('tokenToUser under a skewed clock (the lockout)', () => {
  it('accepts a freshly issued token on a PC that is 20 minutes fast', () => {
    const realNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(realNow + 20 * 60_000);
    const fresh = token({ serverNowMs: realNow });

    // The response that delivered the token also reported the server's clock.
    recordServerTime(serverDate(realNow));
    tokenStore.set(fresh);

    // Before the fix this was null: exp (server+15m) was already "past" on a clock 20m ahead, so
    // the user could sign in successfully and never get a session.
    expect(tokenToUser(fresh)).toEqual({ sub: 'olga', role: 'operator', profile: null });
  });

  it('still rejects a token that is genuinely expired', () => {
    // The difference the Date header makes: an hour-old token stays expired, where measuring from
    // the token's own `iat` would have read its age as skew and accepted it.
    const realNow = Date.now();
    const stale = token({ serverNowMs: realNow - 60 * 60_000 }); // issued an hour ago, 15m life
    recordServerTime(serverDate(realNow));
    tokenStore.set(stale);

    expect(tokenToUser(stale)).toBeNull();
  });

  it('rejects an expired token even on a clock that is fast', () => {
    const realNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(realNow + 20 * 60_000);
    recordServerTime(serverDate(realNow));

    expect(tokenToUser(token({ serverNowMs: realNow - 60 * 60_000 }))).toBeNull();
  });

  it('rejects a malformed token regardless of the clock', () => {
    expect(tokenToUser('not-a-jwt')).toBeNull();
    expect(tokenToUser(null)).toBeNull();
  });
});
