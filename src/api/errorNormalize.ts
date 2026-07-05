// Backend-error normaliser — single helper that goes in front of every
// `catch` in component code so the rendering layer never has to
// remember the wire envelope shape.
//
// Handles four input shapes:
//   (a) axios error with a backend ErrorResponse body — extract everything
//   (b) axios error without a body (network drop, abort, CORS preflight fail)
//   (c) non-axios `Error` instances (TypeError, plain Error, custom subclasses)
//   (d) anything else (string thrown, plain object, undefined, null)

import axios from 'axios';
import { extractFieldErrors, isErrorResponse } from './resources/_types';

export interface NormalizedError {
  /**
   * HTTP status when known. `null` for non-axios errors and for axios
   * errors with no response (network drop, abort, etc.).
   */
  readonly status: number | null;
  /** User-facing display message. Always a non-empty string. */
  readonly message: string;
  /**
   * Trace id for support tickets. Only present when the response
   * carried a backend ErrorResponse envelope.
   */
  readonly correlationId: string | null;
  /**
   * Field → messages[] map for validation errors. Always present (an
   * empty object when there are no field errors) so callers can iterate
   * `Object.keys` without null-checking.
   */
  readonly fieldErrors: Record<string, string[]>;
  /** True when the input was an axios error (any shape). */
  readonly isAxios: boolean;
}

const GENERIC_AXIOS_NETWORK = 'Network error. Check your connection.';
const GENERIC_NON_ERROR = 'An unexpected error occurred.';

/**
 * Convert any thrown value into a {@link NormalizedError} a component
 * can render. Never throws; every input shape resolves to a defined
 * `NormalizedError`.
 *
 * Component usage:
 * ```ts
 * try { await listDevices(...); }
 * catch (err) {
 *   const n = normalizeError(err);
 *   if (n.status === 409) showInline(n.message);
 *   else if (Object.keys(n.fieldErrors).length) showFieldErrors(n.fieldErrors);
 *   else notify.error(n.message);
 * }
 * ```
 */
export const normalizeError = (err: unknown): NormalizedError => {
  // (a) and (b) — axios errors. axios.isAxiosError checks the brand
  // property, so this catches both the with-response and without-response
  // forms in one branch.
  if (axios.isAxiosError(err)) {
    const status = typeof err.response?.status === 'number' ? err.response.status : null;
    const data: unknown = err.response?.data;
    if (isErrorResponse(data)) {
      // (a) Full envelope present — pull every field. Use the server's
      // `message` verbatim; that's the operator-facing copy. Fall back
      // to the axios `message` only if the body somehow has an empty
      // string (defensive — backend shouldn't emit one).
      return {
        status,
        message: data.message !== '' ? data.message : err.message,
        correlationId: data.correlationId,
        fieldErrors: extractFieldErrors(err),
        isAxios: true,
      };
    }
    // (b) No envelope — network drop, abort, CORS preflight fail. The
    // axios `err.message` is the most useful display value
    // ("Network Error", "timeout of 10000ms exceeded", "canceled").
    return {
      status,
      message: status === null ? GENERIC_AXIOS_NETWORK : err.message,
      correlationId: null,
      fieldErrors: {},
      isAxios: true,
    };
  }

  // (c) Native Error or subclass — use its message.
  if (err instanceof Error) {
    return {
      status: null,
      message: err.message !== '' ? err.message : GENERIC_NON_ERROR,
      correlationId: null,
      fieldErrors: {},
      isAxios: false,
    };
  }

  // (d) Anything else: a string thrown, a plain object, undefined, null.
  // Don't try to cleverly stringify — render a generic message and let
  // the dev console show the raw value via the original throw.
  return {
    status: null,
    message: typeof err === 'string' && err !== '' ? err : GENERIC_NON_ERROR,
    correlationId: null,
    fieldErrors: {},
    isAxios: false,
  };
};
