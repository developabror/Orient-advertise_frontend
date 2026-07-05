// Shared types and helpers used by every typed resource wrapper in this
// directory. Importing these from a single module means each resource file
// stays narrow (one domain → one file) and we don't drift on Page envelope
// shape or error parsing.
//
// Page<T> intentionally uses Spring's exact JSON keys (`number`,
// `numberOfElements`) rather than rebranding to FE-friendly names. Two
// reasons:
//   1. The wire format IS the contract — relabeling here means anyone
//      cross-referencing a backend trace or a Postman call has to mentally
//      translate. Cheap to type once, expensive to debug forever.
//   2. We never want a resource wrapper to mask a server-side rename: if
//      the backend returns `pageNumber` next quarter, our parser should
//      surface that — not paper over it with a hand-rolled alias.
// Adapt-at-the-component-boundary remains an option for any consumer that
// genuinely wants a domain name (e.g. `currentPage` for UI clarity).

import axios from 'axios';

/**
 * Spring `Page<T>` envelope — keys mirror the JSON exactly.
 *
 * - `number` is the **0-indexed** current page (Spring convention).
 *   Components that render 1-indexed page numbers add 1 at render time.
 * - `numberOfElements` is the count of items on THIS page (≤ size).
 *   May diverge from `content.length` when `parsePage` skips malformed
 *   rows; treat it as the server's authoritative count.
 */
export interface Page<T> {
  readonly content: readonly T[];
  readonly number: number;
  readonly size: number;
  readonly numberOfElements: number;
  readonly totalElements: number;
  readonly totalPages: number;
  readonly first: boolean;
  readonly last: boolean;
}

/**
 * Spring `Pageable` request shape used by every paged list endpoint.
 * `page` is **0-indexed** (Spring convention); `sort` is a single string
 * in `field,direction` format (e.g. `'lastHeartbeatAt,desc'`). Multi-sort
 * is the caller's responsibility — axios serializes string arrays as
 * repeated `?sort=` params, which Spring also accepts.
 */
export interface Pageable {
  readonly page?: number;
  readonly size?: number;
  readonly sort?: string;
}

/**
 * Field-level validation error inside `ErrorResponse.fieldErrors`.
 * `rejectedValue` is `unknown` because the server echoes whatever the
 * client sent — could be a string, number, null, object, anything.
 */
export interface FieldError {
  readonly field: string;
  readonly message: string;
  readonly rejectedValue: unknown;
}

/**
 * Backend `GlobalExceptionHandler` envelope. Every non-2xx response from
 * `/api/**` should match this shape. `correlationId` is the trace id that
 * shows up in server logs — quote it in support tickets.
 */
export interface ErrorResponse {
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly correlationId: string;
  readonly timestamp: string;
  // Absent on non-validation errors. Jackson serializes the empty case as an
  // explicit `null` on some endpoints (e.g. the 409 conflict envelope) and
  // omits it on others — both mean "no field errors". Reflected here so the
  // guard and consumers treat `null` and absent identically.
  readonly fieldErrors?: readonly FieldError[] | null;
  // Optional structured payload (e.g. ASSIGNMENT_TIME_OVERLAP { code, conflicts[] }).
  // Present only on errors that carry machine-readable context; `unknown` so callers
  // narrow it deliberately. Does not affect `isErrorResponse` (extra keys are ignored).
  readonly details?: unknown;
}

const isFieldError = (value: unknown): value is FieldError => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.field === 'string' && typeof v.message === 'string';
  // `rejectedValue` is intentionally unchecked — it's `unknown` by contract.
};

/**
 * Runtime guard for {@link ErrorResponse}. Use this BEFORE pulling fields
 * out of an axios `error.response.data` payload — never trust the wire.
 */
export const isErrorResponse = (value: unknown): value is ErrorResponse => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.status !== 'number' || !Number.isFinite(v.status)) return false;
  if (typeof v.error !== 'string') return false;
  if (typeof v.message !== 'string') return false;
  if (typeof v.correlationId !== 'string') return false;
  if (typeof v.timestamp !== 'string') return false;
  // `null` and absent both mean "no field errors" — only a present, non-null
  // value must be a well-formed array.
  if (v.fieldErrors !== undefined && v.fieldErrors !== null) {
    if (!Array.isArray(v.fieldErrors)) return false;
    for (const fe of v.fieldErrors) {
      if (!isFieldError(fe)) return false;
    }
  }
  return true;
};

/**
 * The operator-facing backend message for a rejected request, or `null` when
 * the response carried no usable envelope message (network drop, non-envelope
 * body, blank message). The single front-of-catch helper for every mutation:
 *
 * ```ts
 * catch (err) {
 *   const msg = extractApiMessage(err);
 *   if (msg) { markErrorHandled(err); notify.error(msg); }   // I own this surface
 *   // msg === null → let the interceptor toast / global modal handle it
 * }
 * ```
 *
 * `null` (not a generic string) is returned on a miss so callers control the
 * fallback AND can decide whether to let the global error-dialog modal fire.
 */
export const extractApiMessage = (err: unknown): string | null => {
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (!isErrorResponse(data)) return null;
  return data.message.trim() !== '' ? data.message : null;
};

/**
 * Pull validation errors out of an axios error so a form can highlight
 * inputs. Returns a `field → messages[]` map. Multiple errors on the same
 * field are accumulated in order. Always returns an object — never throws,
 * never returns `null`. Callers can iterate `Object.keys(result)` safely.
 *
 * Returns `{}` for:
 *  - non-axios errors (TypeError, plain Error, etc.)
 *  - axios errors without a response (network drop, abort)
 *  - responses whose body doesn't match `ErrorResponse`
 *  - responses with no `fieldErrors` (or an empty array)
 */
export const extractFieldErrors = (err: unknown): Record<string, string[]> => {
  if (!axios.isAxiosError(err)) return {};
  const data: unknown = err.response?.data;
  if (!isErrorResponse(data) || data.fieldErrors === undefined || data.fieldErrors === null)
    return {};
  const out: Record<string, string[]> = {};
  for (const fe of data.fieldErrors) {
    const existing = out[fe.field];
    if (existing === undefined) out[fe.field] = [fe.message];
    else existing.push(fe.message);
  }
  return out;
};

const safeNonNegInt = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

/**
 * Defensive parser for Spring `Page<T>` payloads. Use this from every
 * list-endpoint resource wrapper — it isolates list endpoints from the
 * usual envelope-key drift and lets each domain focus on its row shape.
 *
 * Behavior:
 *  - non-object / null `value` → empty page (all counts zero, `first`+`last` true)
 *  - missing `content` → empty array
 *  - per-row: `parseItem` is called inside try/catch. Rows that throw are
 *    silently skipped (the rest of the page survives). `numberOfElements`
 *    still reports the SERVER's count, not the surviving row count, so the
 *    UI can detect when rows were dropped.
 *  - missing `totalPages` → derived from `totalElements / size` when
 *    possible, else 0 (or 1 if there's at least one element).
 *  - missing `first` / `last` → derived from `number` / `totalPages`.
 */
export const parsePage = <T>(
  value: unknown,
  parseItem: (raw: unknown) => T,
): Page<T> => {
  if (typeof value !== 'object' || value === null) {
    return {
      content: [],
      number: 0,
      size: 0,
      numberOfElements: 0,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
    };
  }
  const v = value as Record<string, unknown>;
  const rawContent = Array.isArray(v.content) ? v.content : [];
  const content: T[] = [];
  for (const raw of rawContent) {
    try {
      content.push(parseItem(raw));
    } catch {
      // Bad row — skip rather than poison the whole page. The server's
      // `numberOfElements` will still reflect the original count, so a
      // consumer comparing it against `content.length` can detect drops.
    }
  }

  const number = safeNonNegInt(v.number);
  const size = safeNonNegInt(v.size);
  const totalElements = safeNonNegInt(v.totalElements);
  const numberOfElements =
    typeof v.numberOfElements === 'number' &&
    Number.isFinite(v.numberOfElements) &&
    v.numberOfElements >= 0
      ? Math.floor(v.numberOfElements)
      : content.length;

  const rawTotalPages = safeNonNegInt(v.totalPages);
  const totalPages =
    rawTotalPages > 0
      ? rawTotalPages
      : size > 0
        ? Math.ceil(totalElements / size)
        : totalElements > 0
          ? 1
          : 0;

  const first = typeof v.first === 'boolean' ? v.first : number === 0;
  const last =
    typeof v.last === 'boolean' ? v.last : totalPages === 0 || number >= totalPages - 1;

  return {
    content,
    number,
    size,
    numberOfElements,
    totalElements,
    totalPages,
    first,
    last,
  };
};
