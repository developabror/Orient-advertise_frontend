// Unit tests for the global error-dialog channel (src/api/errorDialog.ts):
//   - buildErrorDialogContent: the pure eligibility + payload builder that the
//     axios interceptor consults to decide whether a rejected request becomes a
//     modal. This is the heart of the feature, so it's exercised exhaustively.
//   - errorDialog.show / onErrorDialog: the notify-style pub/sub + dedup.
//   - attachErrorClaim / markErrorHandled: the deferred-modal escape hatch.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ERROR_DIALOG_CLAIM,
  attachErrorClaim,
  buildErrorDialogContent,
  errorDialog,
  markErrorHandled,
  onErrorDialog,
  type ErrorDialog,
} from '../errorDialog';

// Minimal axios-error shape — axios.isAxiosError only checks `isAxiosError`.
const makeAxios = (status: number, data?: unknown): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: { status, statusText: '', data, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

const makeNetworkAxios = (): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Network Error',
  config: {},
  toJSON: () => ({}),
});

const envelope = (over: Record<string, unknown> = {}) => ({
  status: 409,
  error: 'Conflict',
  message: 'Device 9 is not assigned to any playlist — assign a playlist first.',
  correlationId: '49259d97-7392-409c-aeaf-21f42dba000d',
  timestamp: '2026-06-04T14:57:36Z',
  fieldErrors: null,
  ...over,
});

const POST = { method: 'post', suppressed: false } as const;

describe('buildErrorDialogContent — the conflict case the user reported', () => {
  it('surfaces a 409 mutation with a backend message verbatim', () => {
    const content = buildErrorDialogContent(makeAxios(409, envelope()), POST);
    expect(content).not.toBeNull();
    expect(content?.status).toBe(409);
    expect(content?.title).toBe("This action can't be completed");
    expect(content?.message).toBe(
      'Device 9 is not assigned to any playlist — assign a playlist first.',
    );
    expect(content?.correlationId).toBe('49259d97-7392-409c-aeaf-21f42dba000d');
  });
});

describe('buildErrorDialogContent — eligible statuses & titles', () => {
  it.each([
    [400, 'Invalid request'],
    [404, 'Not found'],
    [409, "This action can't be completed"],
    [422, "This action can't be completed"],
  ])('status %i → title %s', (status, title) => {
    const content = buildErrorDialogContent(makeAxios(status, envelope({ status })), POST);
    expect(content?.title).toBe(title);
  });

  it('accepts any HTTP method casing', () => {
    expect(buildErrorDialogContent(makeAxios(409, envelope()), { method: 'POST', suppressed: false })).not.toBeNull();
    expect(buildErrorDialogContent(makeAxios(409, envelope()), { method: 'DELETE', suppressed: false })).not.toBeNull();
  });

  it('normalises an empty correlationId to null', () => {
    const content = buildErrorDialogContent(makeAxios(409, envelope({ correlationId: '' })), POST);
    expect(content?.correlationId).toBeNull();
  });
});

describe('buildErrorDialogContent — filtered out (no modal)', () => {
  it('returns null when the caller opted out', () => {
    expect(buildErrorDialogContent(makeAxios(409, envelope()), { method: 'post', suppressed: true })).toBeNull();
  });

  it('returns null for passive GET errors (page handles its own not-found)', () => {
    expect(buildErrorDialogContent(makeAxios(404, envelope({ status: 404 })), { method: 'get', suppressed: false })).toBeNull();
  });

  it('returns null when the method is unknown', () => {
    expect(buildErrorDialogContent(makeAxios(409, envelope()), { method: undefined, suppressed: false })).toBeNull();
  });

  it.each([401, 403, 413, 429])('returns null for excluded status %i', (status) => {
    expect(buildErrorDialogContent(makeAxios(status, envelope({ status })), POST)).toBeNull();
  });

  it('returns null for 5xx (those stay toasts)', () => {
    expect(buildErrorDialogContent(makeAxios(500, envelope({ status: 500 })), POST)).toBeNull();
    expect(buildErrorDialogContent(makeAxios(503, envelope({ status: 503 })), POST)).toBeNull();
  });

  it('returns null for a network error with no response', () => {
    expect(buildErrorDialogContent(makeNetworkAxios(), POST)).toBeNull();
  });

  it('returns null when the body is not a backend envelope', () => {
    expect(buildErrorDialogContent(makeAxios(409, { oops: true }), POST)).toBeNull();
    expect(buildErrorDialogContent(makeAxios(409, undefined), POST)).toBeNull();
    expect(buildErrorDialogContent(makeAxios(409, '<html>502</html>'), POST)).toBeNull();
  });

  it('returns null when the envelope message is blank', () => {
    expect(buildErrorDialogContent(makeAxios(409, envelope({ message: '   ' })), POST)).toBeNull();
  });

  it('returns null for field-validation errors (those stay per-form)', () => {
    const withFields = envelope({
      status: 400,
      message: 'Validation failed',
      fieldErrors: [{ field: 'name', message: 'required', rejectedValue: '' }],
    });
    expect(buildErrorDialogContent(makeAxios(400, withFields), POST)).toBeNull();
  });

  it('returns null for non-axios throws', () => {
    expect(buildErrorDialogContent(new Error('boom'), POST)).toBeNull();
    expect(buildErrorDialogContent('a string', POST)).toBeNull();
    expect(buildErrorDialogContent(null, POST)).toBeNull();
  });
});

describe('errorDialog.show / onErrorDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a dialog with a generated id to subscribers', () => {
    const seen: ErrorDialog[] = [];
    const off = onErrorDialog((d) => seen.push(d));
    errorDialog.show({ status: 409, title: 'T', message: 'show-unique-1', correlationId: null });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe('show-unique-1');
    expect(seen[0]?.id).toMatch(/^e-\d+$/);
  });

  it('stops delivering after unsubscribe', () => {
    const seen: ErrorDialog[] = [];
    const off = onErrorDialog((d) => seen.push(d));
    off();
    errorDialog.show({ status: 409, title: 'T', message: 'show-unique-2', correlationId: null });
    expect(seen).toHaveLength(0);
  });

  it('coalesces an identical status+message within the dedup window', () => {
    const seen: ErrorDialog[] = [];
    const off = onErrorDialog((d) => seen.push(d));
    errorDialog.show({ status: 409, title: 'T', message: 'dup-message', correlationId: null });
    errorDialog.show({ status: 409, title: 'T', message: 'dup-message', correlationId: null });
    off();
    expect(seen).toHaveLength(1);
  });

  it('does not coalesce different messages', () => {
    const seen: ErrorDialog[] = [];
    const off = onErrorDialog((d) => seen.push(d));
    errorDialog.show({ status: 409, title: 'T', message: 'distinct-a', correlationId: null });
    errorDialog.show({ status: 409, title: 'T', message: 'distinct-b', correlationId: null });
    off();
    expect(seen).toHaveLength(2);
  });
});

describe('attachErrorClaim / markErrorHandled', () => {
  it('marks a claimed error as handled', () => {
    const err = makeAxios(409, envelope()) as object;
    const claim = attachErrorClaim(err);
    expect(claim.handled).toBe(false);
    markErrorHandled(err);
    expect(claim.handled).toBe(true);
  });

  it('stores the claim under a non-enumerable symbol', () => {
    const err = makeAxios(409, envelope()) as object;
    attachErrorClaim(err);
    expect(Object.keys(err)).not.toContain('handled');
    expect(ERROR_DIALOG_CLAIM in err).toBe(true);
  });

  it('is a safe no-op for unclaimed or non-object values', () => {
    expect(() => markErrorHandled(makeAxios(409, envelope()))).not.toThrow();
    expect(() => markErrorHandled(null)).not.toThrow();
    expect(() => markErrorHandled('nope')).not.toThrow();
    expect(() => markErrorHandled(undefined)).not.toThrow();
  });

  it('a claim set before the deferred timer fires cancels the modal; an unclaimed one fires', () => {
    // Mirror the interceptor's contract: attach a claim, then defer the show by
    // one macrotask. A synchronous claim (the inline-handler case) must win.
    vi.useFakeTimers();
    const shown: string[] = [];
    const schedule = (err: object, label: string): void => {
      const claim = attachErrorClaim(err);
      setTimeout(() => {
        if (!claim.handled) shown.push(label);
      }, 0);
    };
    const claimed = makeAxios(409, envelope()) as object;
    const unclaimed = makeAxios(409, envelope()) as object;
    schedule(claimed, 'claimed');
    schedule(unclaimed, 'unclaimed');
    markErrorHandled(claimed); // inline handler claims before timers run
    vi.runAllTimers();
    vi.useRealTimers();
    expect(shown).toEqual(['unclaimed']);
  });
});
