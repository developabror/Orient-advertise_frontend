// Vitest unit tests for src/api/resources/_types.ts.
//
// Run with `vitest run src/api/resources/__tests__/types.test.ts` once the
// project's test framework is installed.

import { describe, expect, it } from 'vitest';

import {
  extractApiMessage,
  extractFieldErrors,
  isErrorResponse,
  parsePage,
  type ErrorResponse,
} from '../_types';

// Minimal axios-error shape. axios.isAxiosError() only checks for
// `isAxiosError === true` on a non-null object — no need to involve the
// real axios client to construct one.
const makeAxiosError = (data: unknown): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 400',
  response: { data, status: 400, statusText: 'Bad Request', headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

describe('isErrorResponse', () => {
  const valid = (): ErrorResponse => ({
    status: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    correlationId: '7e0e8b22-0c9a-4b13-9aa0-2c9a8c0e1234',
    timestamp: '2026-05-08T10:00:00Z',
  });

  it('accepts a fully-formed payload without fieldErrors', () => {
    expect(isErrorResponse(valid())).toBe(true);
  });

  it('accepts a payload with an empty fieldErrors array', () => {
    expect(isErrorResponse({ ...valid(), fieldErrors: [] })).toBe(true);
  });

  it('accepts fieldErrors: null (the 409 conflict envelope serializes it explicitly)', () => {
    expect(isErrorResponse({ ...valid(), fieldErrors: null })).toBe(true);
  });

  it('accepts a payload with a well-formed fieldErrors array', () => {
    expect(
      isErrorResponse({
        ...valid(),
        fieldErrors: [
          { field: 'username', message: 'must not be blank', rejectedValue: '' },
          { field: 'role', message: 'must be one of [...]', rejectedValue: 'guest' },
        ],
      }),
    ).toBe(true);
  });

  it('accepts fieldErrors entries with rejectedValue of any type (including undefined)', () => {
    expect(
      isErrorResponse({
        ...valid(),
        fieldErrors: [
          { field: 'a', message: 'm', rejectedValue: null },
          { field: 'b', message: 'm', rejectedValue: 0 },
          { field: 'c', message: 'm', rejectedValue: { nested: true } },
          { field: 'd', message: 'm' }, // rejectedValue absent
        ],
      }),
    ).toBe(true);
  });

  it('rejects null and primitives', () => {
    expect(isErrorResponse(null)).toBe(false);
    expect(isErrorResponse(undefined)).toBe(false);
    expect(isErrorResponse('error')).toBe(false);
    expect(isErrorResponse(404)).toBe(false);
    expect(isErrorResponse(true)).toBe(false);
  });

  it('rejects when any required field is missing', () => {
    for (const field of ['status', 'error', 'message', 'correlationId', 'timestamp']) {
      const p = valid() as Record<string, unknown>;
      delete p[field];
      expect(isErrorResponse(p)).toBe(false);
    }
  });

  it('rejects when a required field has the wrong type', () => {
    expect(isErrorResponse({ ...valid(), status: '400' })).toBe(false);
    expect(isErrorResponse({ ...valid(), status: Number.NaN })).toBe(false);
    expect(isErrorResponse({ ...valid(), error: 400 })).toBe(false);
    expect(isErrorResponse({ ...valid(), message: null })).toBe(false);
    expect(isErrorResponse({ ...valid(), correlationId: 12345 })).toBe(false);
    expect(isErrorResponse({ ...valid(), timestamp: new Date() })).toBe(false);
  });

  it('rejects when fieldErrors is not an array', () => {
    expect(isErrorResponse({ ...valid(), fieldErrors: 'oops' })).toBe(false);
    expect(isErrorResponse({ ...valid(), fieldErrors: { a: 'b' } })).toBe(false);
  });

  it('rejects when a fieldErrors entry is malformed', () => {
    expect(
      isErrorResponse({
        ...valid(),
        fieldErrors: [{ message: 'no field key', rejectedValue: 1 }],
      }),
    ).toBe(false);
    expect(
      isErrorResponse({
        ...valid(),
        fieldErrors: [{ field: 'username', rejectedValue: 1 }],
      }),
    ).toBe(false);
    expect(
      isErrorResponse({
        ...valid(),
        fieldErrors: [{ field: 1, message: 'wrong type', rejectedValue: null }],
      }),
    ).toBe(false);
  });
});

describe('extractFieldErrors', () => {
  const baseResponse = (): ErrorResponse => ({
    status: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    correlationId: 'corr-1',
    timestamp: '2026-05-08T10:00:00Z',
  });

  it('returns {} for non-axios errors', () => {
    expect(extractFieldErrors(new Error('boom'))).toEqual({});
    expect(extractFieldErrors('boom')).toEqual({});
    expect(extractFieldErrors(null)).toEqual({});
    expect(extractFieldErrors(undefined)).toEqual({});
  });

  it('returns {} for axios errors with no response (network drop)', () => {
    const err = { isAxiosError: true, name: 'AxiosError', message: 'Network Error' };
    expect(extractFieldErrors(err)).toEqual({});
  });

  it('returns {} for axios errors whose response body is not an ErrorResponse', () => {
    expect(extractFieldErrors(makeAxiosError({ unrelated: true }))).toEqual({});
    expect(extractFieldErrors(makeAxiosError('plain string body'))).toEqual({});
    expect(extractFieldErrors(makeAxiosError(null))).toEqual({});
  });

  it('returns {} when ErrorResponse has no fieldErrors', () => {
    expect(extractFieldErrors(makeAxiosError(baseResponse()))).toEqual({});
  });

  it('returns {} when fieldErrors is null', () => {
    expect(extractFieldErrors(makeAxiosError({ ...baseResponse(), fieldErrors: null }))).toEqual({});
  });

  it('extracts a single fieldError into a one-entry map', () => {
    const err = makeAxiosError({
      ...baseResponse(),
      fieldErrors: [{ field: 'username', message: 'must not be blank', rejectedValue: '' }],
    });
    expect(extractFieldErrors(err)).toEqual({
      username: ['must not be blank'],
    });
  });

  it('groups multiple errors on the same field, preserving order', () => {
    const err = makeAxiosError({
      ...baseResponse(),
      fieldErrors: [
        { field: 'password', message: 'too short', rejectedValue: 'abc' },
        { field: 'password', message: 'must contain a digit', rejectedValue: 'abc' },
        { field: 'username', message: 'taken', rejectedValue: 'admin' },
      ],
    });
    expect(extractFieldErrors(err)).toEqual({
      password: ['too short', 'must contain a digit'],
      username: ['taken'],
    });
  });

  it('returns {} when fieldErrors is an empty array', () => {
    const err = makeAxiosError({ ...baseResponse(), fieldErrors: [] });
    expect(extractFieldErrors(err)).toEqual({});
  });
});

describe('extractApiMessage', () => {
  const envelope = (over: Record<string, unknown> = {}): unknown => ({
    status: 409,
    error: 'Conflict',
    message: 'Region is in use by 3 facilities',
    correlationId: 'x',
    timestamp: 't',
    fieldErrors: null,
    ...over,
  });

  it('returns the verbatim backend message for a 409 envelope (fieldErrors: null)', () => {
    expect(extractApiMessage(makeAxiosError(envelope()))).toBe('Region is in use by 3 facilities');
  });

  it('returns null for a network error with no response', () => {
    expect(
      extractApiMessage({ isAxiosError: true, name: 'AxiosError', message: 'Network Error' }),
    ).toBeNull();
  });

  it('returns null for a non-envelope body', () => {
    expect(extractApiMessage(makeAxiosError({ oops: true }))).toBeNull();
    expect(extractApiMessage(makeAxiosError('<html>502 Bad Gateway</html>'))).toBeNull();
  });

  it('returns null for a blank envelope message', () => {
    expect(extractApiMessage(makeAxiosError(envelope({ message: '   ' })))).toBeNull();
  });

  it('returns null for non-axios throws', () => {
    expect(extractApiMessage(new Error('boom'))).toBeNull();
    expect(extractApiMessage('a string')).toBeNull();
    expect(extractApiMessage(null)).toBeNull();
  });
});

describe('parsePage', () => {
  // Identity parser for tests that don't care about row shape — passes the
  // raw value straight through. Type assertion is acceptable here because
  // we only assert on the envelope keys.
  const passthrough = <T>(raw: unknown): T => raw as T;

  it('returns an empty page for null / undefined / non-object input', () => {
    const empty = {
      content: [],
      number: 0,
      size: 0,
      numberOfElements: 0,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
    };
    expect(parsePage(null, passthrough)).toEqual(empty);
    expect(parsePage(undefined, passthrough)).toEqual(empty);
    expect(parsePage('not a page', passthrough)).toEqual(empty);
    expect(parsePage(42, passthrough)).toEqual(empty);
    // Arrays are objects, but the parser only treats well-shaped envelopes.
    // An array has no `content` key, so it's treated as an empty page with
    // arrays-are-objects: parser should return defaults (first=true, last=true).
    const fromArray = parsePage([1, 2, 3], passthrough);
    expect(fromArray.content).toEqual([]);
  });

  it('passes through a fully-formed page envelope unchanged', () => {
    const page = parsePage(
      {
        content: [{ id: 1 }, { id: 2 }],
        number: 0,
        size: 20,
        numberOfElements: 2,
        totalElements: 2,
        totalPages: 1,
        first: true,
        last: true,
      },
      passthrough,
    );
    expect(page.content).toEqual([{ id: 1 }, { id: 2 }]);
    expect(page.number).toBe(0);
    expect(page.size).toBe(20);
    expect(page.numberOfElements).toBe(2);
    expect(page.totalElements).toBe(2);
    expect(page.totalPages).toBe(1);
    expect(page.first).toBe(true);
    expect(page.last).toBe(true);
  });

  it('treats a missing content array as empty', () => {
    const page = parsePage({ totalElements: 0, totalPages: 0 }, passthrough);
    expect(page.content).toEqual([]);
    expect(page.numberOfElements).toBe(0);
  });

  it('clamps negative / non-finite / non-number counts to 0', () => {
    const page = parsePage(
      {
        content: [],
        number: -5,
        size: Number.NaN,
        numberOfElements: '12' as unknown as number,
        totalElements: Number.POSITIVE_INFINITY,
        totalPages: -1,
      },
      passthrough,
    );
    expect(page.number).toBe(0);
    expect(page.size).toBe(0);
    expect(page.numberOfElements).toBe(0); // wrong type → falls back to content.length (0)
    expect(page.totalElements).toBe(0);
    expect(page.totalPages).toBe(0);
  });

  it('derives totalPages from totalElements/size when totalPages is missing', () => {
    const page = parsePage(
      { content: [], totalElements: 95, size: 20, number: 4 },
      passthrough,
    );
    expect(page.totalPages).toBe(5); // ceil(95/20)
    expect(page.last).toBe(true); // number 4 == totalPages-1
  });

  it('derives first/last from number when booleans absent', () => {
    expect(
      parsePage({ content: [], number: 0, totalPages: 5 }, passthrough).first,
    ).toBe(true);
    expect(
      parsePage({ content: [], number: 2, totalPages: 5 }, passthrough).first,
    ).toBe(false);
    expect(
      parsePage({ content: [], number: 4, totalPages: 5 }, passthrough).last,
    ).toBe(true);
    expect(
      parsePage({ content: [], number: 2, totalPages: 5 }, passthrough).last,
    ).toBe(false);
  });

  it('honors explicit first/last booleans even when they disagree with number', () => {
    const page = parsePage(
      { content: [], number: 0, totalPages: 5, first: false, last: true },
      passthrough,
    );
    expect(page.first).toBe(false);
    expect(page.last).toBe(true);
  });

  it('skips rows whose parseItem throws and keeps the rest', () => {
    interface Row {
      readonly id: number;
    }
    const parseRow = (raw: unknown): Row => {
      if (typeof raw !== 'object' || raw === null) throw new Error('bad row');
      const v = raw as Record<string, unknown>;
      if (typeof v.id !== 'number') throw new Error('bad id');
      return { id: v.id };
    };
    const page = parsePage<Row>(
      {
        content: [{ id: 1 }, 'garbage', { id: 3 }, null, { id: 5 }],
        numberOfElements: 5,
        totalElements: 5,
      },
      parseRow,
    );
    expect(page.content).toEqual([{ id: 1 }, { id: 3 }, { id: 5 }]);
    // numberOfElements still reports the SERVER's count — the divergence
    // from content.length is the signal that rows were dropped.
    expect(page.numberOfElements).toBe(5);
  });

  it('returns an empty page when every row is malformed', () => {
    const parseRow = (): never => {
      throw new Error('always fails');
    };
    const page = parsePage(
      { content: [{}, {}, {}], numberOfElements: 3, totalElements: 3 },
      parseRow,
    );
    expect(page.content).toEqual([]);
    expect(page.numberOfElements).toBe(3);
    expect(page.totalElements).toBe(3);
  });
});
