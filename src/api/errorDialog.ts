// Global error-dialog channel — the modal counterpart to `notify`/Toaster.
//
// The axios response interceptor (see `http.ts`) feeds *business* errors here:
// a mutation the operator just triggered (POST/PUT/PATCH/DELETE) that the
// backend rejected with a 4xx envelope carrying an operator-facing `message`
// (e.g. a 409 "Device 9 is not assigned to any playlist …"). Those previously
// fell through the interceptor silently unless the calling component happened
// to catch and render them inline — so a forgotten `catch` meant the user saw
// nothing. This channel is the safety net: any unhandled business 4xx becomes
// a popup modal showing the backend's own message verbatim.
//
// Two escape hatches keep it from double-messaging the many call sites that
// already render these errors inline (duplicate-name forms, the assignment
// overlap panel, the incident ack/resolve flow, …):
//   1. `_suppressErrorModal` on the request config — a caller that opts out up
//      front (see `markErrorHandled` for the after-the-fact equivalent). Note
//      `_suppressErrorToast` silences only the toast and does NOT suppress the
//      modal — so a mutation that sets it still gets the modal as a backstop.
//   2. `markErrorHandled(err)` — called from an inline `catch`. The interceptor
//      *defers* the modal by one macrotask (`setTimeout(0)`), which always runs
//      after the caller's synchronous catch, so claiming the error there
//      cancels the modal before it ever shows.
//
// Pure rendering data lives on `ErrorDialog`; pub/sub mirrors `notify.ts`
// exactly so the host component is trivially the modal sibling of the Toaster.

import axios from 'axios';
import { isErrorResponse } from './resources/_types';

/** Rendering payload for one error modal (sans id). */
export interface ErrorDialogContent {
  /** Originating HTTP status (always a 4xx in the eligible set). */
  readonly status: number;
  /** Friendly headline derived from the status. */
  readonly title: string;
  /** Verbatim backend `message` — the operator-facing copy. */
  readonly message: string;
  /** Trace id for support tickets; `null` when the envelope carried none. */
  readonly correlationId: string | null;
}

/** A queued/rendered error modal — {@link ErrorDialogContent} plus a stable id. */
export interface ErrorDialog extends ErrorDialogContent {
  readonly id: string;
}

type Listener = (dialog: ErrorDialog) => void;

const listeners = new Set<Listener>();
// Same identical-message coalescing window as notify: a button mashed twice, or
// two concurrent requests failing the same way, shows one modal, not a stack.
const recentEmits = new Map<string, number>();
const DEDUP_WINDOW_MS = 1500;
let counter = 0;

// Statuses deliberately NOT surfaced as a modal:
//   401 — handled by the silent token-refresh / re-login flow.
//   403 — kept as the lighter generic access toast.
//   413 — payload-too-large; the uploaders surface it inline with size hints.
//   429 — rate limiting; the report/login flows surface their own copy.
const EXCLUDED_STATUSES = new Set([401, 403, 413, 429]);
// Only modal errors from an action the operator actively took. A GET that 404s
// is passive navigation (the page renders its own not-found state) — not a popup.
const MUTATION_METHODS = new Set(['post', 'put', 'patch', 'delete']);

const titleForStatus = (status: number): string => {
  switch (status) {
    case 404:
      return 'Not found';
    case 400:
      return 'Invalid request';
    default:
      // 409, 422, and any other eligible business 4xx: the backend message
      // explains the "why"; the title just frames it.
      return "This action can't be completed";
  }
};

/**
 * Decide whether an interceptor-level error should become a global modal, and
 * if so build its content. Pure and side-effect-free so it can be unit-tested
 * exhaustively without timers or a DOM.
 *
 * Returns `null` (no modal) unless ALL hold:
 *  - the caller did not opt out (`suppressed`),
 *  - it's an axios error with a 4xx status in the eligible set,
 *  - the request was a mutation (operator-initiated),
 *  - the body is a well-formed backend envelope with a non-empty `message`,
 *  - there are no `fieldErrors` (those stay per-form / inline).
 */
export const buildErrorDialogContent = (
  err: unknown,
  opts: { readonly method?: string | undefined; readonly suppressed: boolean },
): ErrorDialogContent | null => {
  if (opts.suppressed) return null;
  if (!axios.isAxiosError(err)) return null;

  const status = err.response?.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status >= 500) {
    return null;
  }
  if (EXCLUDED_STATUSES.has(status)) return null;

  const method = opts.method?.toLowerCase();
  if (method === undefined || !MUTATION_METHODS.has(method)) return null;

  const data: unknown = err.response?.data;
  if (!isErrorResponse(data)) return null;
  if (data.message.trim() === '') return null;
  // Field validation belongs next to the inputs, not in a blocking modal.
  // `null`/absent both mean "no field errors" (see ErrorResponse.fieldErrors).
  if (data.fieldErrors !== undefined && data.fieldErrors !== null && data.fieldErrors.length > 0) {
    return null;
  }

  return {
    status,
    title: titleForStatus(status),
    message: data.message,
    correlationId: data.correlationId !== '' ? data.correlationId : null,
  };
};

export const errorDialog = {
  show: (content: ErrorDialogContent): void => {
    const key = `${String(content.status)}:${content.message}`;
    const now = Date.now();
    const last = recentEmits.get(key);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;
    recentEmits.set(key, now);

    counter += 1;
    const dialog: ErrorDialog = { id: `e-${String(counter)}`, ...content };
    listeners.forEach((fn) => {
      fn(dialog);
    });
  },
};

export const onErrorDialog = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

// --- Claim mechanism --------------------------------------------------------
// The interceptor attaches a claim to the rejected error and defers the modal.
// An inline handler calls `markErrorHandled(err)` to flip `handled`, cancelling
// the deferred modal. Stored under a non-enumerable Symbol so it never shows up
// in logging, JSON.stringify, or structuredClone of the error.

interface ErrorClaim {
  handled: boolean;
}

export const ERROR_DIALOG_CLAIM: unique symbol = Symbol('oa.errorDialog.claim');

/**
 * Attach a fresh, unclaimed marker to a rejected error. Called once by the
 * interceptor for every modal-eligible error. Returns the claim so the
 * interceptor can read `handled` inside its deferred callback.
 */
export const attachErrorClaim = (err: object): ErrorClaim => {
  const claim: ErrorClaim = { handled: false };
  Object.defineProperty(err, ERROR_DIALOG_CLAIM, {
    value: claim,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return claim;
};

/**
 * Mark a backend error as handled by the calling component, so the global
 * error-dialog interceptor does NOT also surface it as a modal. Safe to call
 * with any value (no-op for non-axios errors, plain throws, or errors that were
 * never modal-eligible) and idempotent.
 *
 * IMPORTANT: call this BEFORE any `await` in your catch. The interceptor defers
 * the modal by one macrotask, which the synchronous (microtask) part of your
 * catch beats — but an `await` ahead of the claim yields to that macrotask and
 * the modal would fire anyway. Claim first, then do async work:
 *
 * ```ts
 * catch (err) {
 *   markErrorHandled(err);          // claim first — I'm showing this myself
 *   setError(extractMessage(err) ?? 'Failed to save.');
 * }
 * ```
 */
export const markErrorHandled = (err: unknown): void => {
  if (err === null || typeof err !== 'object') return;
  const claim = (err as Record<symbol, unknown>)[ERROR_DIALOG_CLAIM];
  if (claim !== null && typeof claim === 'object' && 'handled' in claim) {
    (claim as ErrorClaim).handled = true;
  }
};
