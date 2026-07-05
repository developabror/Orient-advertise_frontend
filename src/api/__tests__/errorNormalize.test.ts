// Vitest unit tests for src/api/errorNormalize.ts.

import { describe, expect, it } from 'vitest';

import { normalizeError } from '../errorNormalize';

const makeAxios = (status: number, data?: unknown): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: { status, statusText: '', data, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

const makeAxiosNetwork = (msg: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: msg,
  config: {},
  toJSON: () => ({}),
});

const errorResponse = (over: Partial<{ message: string; correlationId: string }> = {}) => ({
  status: 400,
  error: 'Bad Request',
  message: 'Validation failed',
  correlationId: 'corr-1',
  timestamp: '2026-05-08T10:00:00Z',
  ...over,
});

describe('normalizeError — (a) axios with backend envelope', () => {
  it('extracts every field from the ErrorResponse body', () => {
    const err = makeAxios(400, errorResponse());
    const n = normalizeError(err);
    expect(n.status).toBe(400);
    expect(n.message).toBe('Validation failed');
    expect(n.correlationId).toBe('corr-1');
    expect(n.fieldErrors).toEqual({});
    expect(n.isAxios).toBe(true);
  });

  it('groups fieldErrors by field and preserves order', () => {
    const err = makeAxios(400, {
      ...errorResponse(),
      fieldErrors: [
        { field: 'password', message: 'too short', rejectedValue: 'abc' },
        { field: 'password', message: 'must contain a digit', rejectedValue: 'abc' },
        { field: 'username', message: 'taken', rejectedValue: 'admin' },
      ],
    });
    const n = normalizeError(err);
    expect(n.fieldErrors).toEqual({
      password: ['too short', 'must contain a digit'],
      username: ['taken'],
    });
  });

  it('uses the server message verbatim (operator-facing copy)', () => {
    const err = makeAxios(409, {
      ...errorResponse({ message: 'In use by 3 playlists: A, B, C' }),
    });
    const n = normalizeError(err);
    expect(n.message).toBe('In use by 3 playlists: A, B, C');
  });
});

describe('normalizeError — (b) axios without envelope', () => {
  it('falls back to a generic network message when there is no response', () => {
    const err = makeAxiosNetwork('Network Error');
    const n = normalizeError(err);
    expect(n.status).toBeNull();
    expect(n.message).toBe('Network error. Check your connection.');
    expect(n.correlationId).toBeNull();
    expect(n.fieldErrors).toEqual({});
    expect(n.isAxios).toBe(true);
  });

  it('uses axios.message when there IS a response but no envelope (e.g. plain text 502)', () => {
    const err = makeAxios(502, '<html>...</html>');
    const n = normalizeError(err);
    expect(n.status).toBe(502);
    expect(n.message).toBe('Request failed with status code 502');
    expect(n.correlationId).toBeNull();
    expect(n.fieldErrors).toEqual({});
  });
});

describe('normalizeError — (c) non-axios Error', () => {
  it('uses Error.message', () => {
    const n = normalizeError(new Error('boom'));
    expect(n.status).toBeNull();
    expect(n.message).toBe('boom');
    expect(n.correlationId).toBeNull();
    expect(n.fieldErrors).toEqual({});
    expect(n.isAxios).toBe(false);
  });

  it('falls back to a generic message when Error.message is empty', () => {
    const n = normalizeError(new Error(''));
    expect(n.message).toBe('An unexpected error occurred.');
  });

  it('handles TypeError and other Error subclasses', () => {
    const n = normalizeError(new TypeError('cannot read x of undefined'));
    expect(n.message).toBe('cannot read x of undefined');
    expect(n.isAxios).toBe(false);
  });
});

describe('normalizeError — (d) anything else', () => {
  it('returns a generic message for null/undefined', () => {
    expect(normalizeError(null).message).toBe('An unexpected error occurred.');
    expect(normalizeError(undefined).message).toBe('An unexpected error occurred.');
  });

  it('uses a thrown string as the message', () => {
    expect(normalizeError('something went wrong').message).toBe('something went wrong');
  });

  it('returns a generic message for a thrown empty string', () => {
    expect(normalizeError('').message).toBe('An unexpected error occurred.');
  });

  it('returns a generic message for a plain object', () => {
    expect(normalizeError({ foo: 'bar' }).message).toBe('An unexpected error occurred.');
  });

  it('marks every non-axios case with isAxios: false and status: null', () => {
    for (const input of [null, undefined, 'a string', { foo: 1 }, 42, true]) {
      const n = normalizeError(input);
      expect(n.isAxios).toBe(false);
      expect(n.status).toBeNull();
      expect(n.correlationId).toBeNull();
      expect(n.fieldErrors).toEqual({});
    }
  });
});
