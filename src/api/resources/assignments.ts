// Assignments resource — typed wrappers around /api/assignments,
// /api/assignments/{id}/confirm, and /api/assignments/preview.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.
//
// The two-step draft → confirm workflow exists so the operator can see
// device fan-out (via the preview endpoint) and exclude individual
// devices BEFORE committing the assignment. The backend treats the
// confirm step as the canonical commit point — anything before that is
// soft state.

import { http } from '../http';

/**
 * Backend `TargetType` enum verbatim. The three valid scoping levels for
 * a content assignment.
 */
export type TargetType = 'REGION' | 'FACILITY' | 'DEVICE_GROUP';

/**
 * Mirror of the backend `AssignmentResponse` record. `priority` is the
 * resolution-order integer (lower wins on overlap; the server clamps it
 * before returning). `status` is kept as plain `string` because the
 * backend may add transitional states (e.g. `PENDING_REVIEW`) without
 * a FE deploy — be liberal on read.
 */
export interface AssignmentResponse {
  readonly id: number;
  readonly playlistId: number;
  readonly targetType: TargetType;
  readonly targetId: number;
  readonly priority: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * Body for POST /api/assignments. `startTime` / `endTime` are ISO-8601
 * UTC instants. The backend validates that `startTime < endTime` and
 * rejects past windows; both surface as 400.
 */
export interface CreateDraftRequest {
  readonly playlistId: number;
  readonly targetType: TargetType;
  readonly targetId: number;
  readonly startTime: string;
  readonly endTime: string;
}

/**
 * Body for POST /api/assignments/{id}/confirm. All fields optional:
 * - `excludedDeviceIds`: device ids to skip from the draft's target
 *    fan-out. Empty array vs absent are equivalent on the wire.
 * - `includedDeviceIds`: the inverse — an explicit allow-list. The backend
 *    derives the complement against the draft's target scope
 *    (`confirmWithIncludedDevices`). AssignContentDrawer sends this for an
 *    INDIVIDUAL selection (the operator's chosen device ids) so the
 *    device-aware overlap check scopes to exactly those devices. The FE gates
 *    individual confirm on a non-truncated preview, so the allow-list it sends
 *    is always fully enumerated. Send at most one of excluded/included.
 * - `reason`: free-text justification for the assignment, surfaced in
 *    audit logs. The server enforces a max length (currently 500 chars,
 *    not surfaced here — let the backend reject with 400).
 * - `replaceConflicting`: when `true`, the server atomically supersedes any
 *    CONFIRMED assignment(s) that overlap this draft's window/target instead
 *    of rejecting with a 409. This is the **atomic Replace** path; the FE
 *    falls back to cancel-then-reconfirm on a backend that doesn't honor it
 *    (still 409s). Destructive — only set after an explicit operator
 *    confirmation. An older backend ignores the unknown field.
 */
export interface ConfirmAssignmentRequest {
  readonly excludedDeviceIds?: readonly number[];
  readonly includedDeviceIds?: readonly number[];
  readonly reason?: string;
  readonly replaceConflicting?: boolean;
}

/**
 * One conflicting CONFIRMED assignment carried in a 409 overlap error's
 * `details.conflicts`. `startTime`/`endTime` are ISO-8601 **UTC** instants —
 * localize for display (the product zone is Tashkent; see `@/lib/timezone`).
 *
 * `playlistId`/`playlistName`/`status` are **enrichment** fields — present on a
 * backend that ships the richer overlap envelope, absent (undefined) on an
 * older one. The FE renders the name when available and falls back gracefully
 * otherwise; never assume they exist.
 */
export interface AssignmentConflict {
  readonly id: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly playlistId?: number;
  readonly playlistName?: string;
  readonly status?: string;
  /**
   * The subset of the operator's **selected** devices that actually intersect
   * this conflicting assignment (device-aware overlap). Present on a backend
   * that ships the device-aware overlap check; absent on an older one. Used for
   * display only ("N of your M devices clash") — the Replace action supersedes
   * by `id`, never by this list.
   */
  readonly conflictingDeviceIds?: readonly number[];
}

/**
 * Structured `details` payload on a 409 overlap error. The backend's overlap
 * guard (see the confirm endpoint) returns this so the FE can build a friendly,
 * localized message instead of leaking the raw developer string
 * (`Time overlap with existing assignment(s) [3, 4] for REGION:1`).
 */
export interface AssignmentOverlapDetails {
  /** Discriminator the FE keys off — always {@link ASSIGNMENT_TIME_OVERLAP}. */
  readonly code: string;
  readonly targetType?: TargetType;
  readonly targetId?: number;
  readonly conflicts: readonly AssignmentConflict[];
}

/** `details.code` value the backend sets for a time-overlap 409. */
export const ASSIGNMENT_TIME_OVERLAP = 'ASSIGNMENT_TIME_OVERLAP';

/**
 * Tolerant coercion of an unknown wire value into a non-empty `number[]`, or
 * `undefined`. Non-arrays → undefined; non-number elements are filtered out; an
 * empty/all-garbage result → undefined so consumers test only `!== undefined`
 * (never `.length`) and `exactOptionalPropertyTypes` stays satisfied.
 */
const numberArrayOrUndefined = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ids = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return ids.length > 0 ? ids : undefined;
};

/**
 * Best-effort parse of a 409 response body into {@link AssignmentOverlapDetails}.
 *
 * Returns `null` when the body is any other 409 shape — including one from a
 * backend that predates the structured `details` envelope — so callers fall
 * back to a generic friendly message rather than the raw developer string.
 * Tolerant by design: a malformed conflict row is skipped, never thrown, so a
 * single bad entry can't blank the whole message.
 */
export const parseOverlapDetails = (body: unknown): AssignmentOverlapDetails | null => {
  if (typeof body !== 'object' || body === null) return null;
  const details = (body as Record<string, unknown>).details;
  if (typeof details !== 'object' || details === null) return null;
  const d = details as Record<string, unknown>;
  if (d.code !== ASSIGNMENT_TIME_OVERLAP) return null;

  const conflicts: AssignmentConflict[] = [];
  if (Array.isArray(d.conflicts)) {
    for (const raw of d.conflicts) {
      if (typeof raw !== 'object' || raw === null) continue;
      const c = raw as Record<string, unknown>;
      if (
        typeof c.id === 'number' &&
        typeof c.startTime === 'string' &&
        typeof c.endTime === 'string'
      ) {
        const conflictingDeviceIds = numberArrayOrUndefined(c.conflictingDeviceIds);
        conflicts.push({
          id: c.id,
          startTime: c.startTime,
          endTime: c.endTime,
          // Enrichment fields — included only when the backend supplies them.
          ...(typeof c.playlistId === 'number' ? { playlistId: c.playlistId } : {}),
          ...(typeof c.playlistName === 'string' ? { playlistName: c.playlistName } : {}),
          ...(typeof c.status === 'string' ? { status: c.status } : {}),
          ...(conflictingDeviceIds !== undefined ? { conflictingDeviceIds } : {}),
        });
      }
    }
  }

  const tt = d.targetType;
  const targetType =
    tt === 'REGION' || tt === 'FACILITY' || tt === 'DEVICE_GROUP' ? tt : undefined;

  return {
    code: ASSIGNMENT_TIME_OVERLAP,
    conflicts,
    ...(targetType !== undefined ? { targetType } : {}),
    ...(typeof d.targetId === 'number' ? { targetId: d.targetId } : {}),
  };
};

/**
 * Single row inside `PreviewResult.devices`. Mirrors the backend
 * `PreviewDevice` record. `status` stays as a plain `string` (same
 * rationale as `AssignmentResponse.status`); `offline` is a derived
 * boolean the backend sets so consumers don't have to re-implement
 * status-to-offline mapping.
 */
export interface PreviewDevice {
  readonly deviceId: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: string;
  readonly offline: boolean;
  readonly currentAssignmentId: number | null;
  readonly currentPlaylistId: number | null;
}

/**
 * Response shape of GET /api/assignments/preview. `truncated` is `true`
 * when `returnedCount < totalDevices` (the server caps the device list
 * to keep responses small for very large targets — UI should surface
 * the truncation rather than imply the full list is shown).
 */
export interface PreviewResult {
  readonly devices: readonly PreviewDevice[];
  readonly totalDevices: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
}

/**
 * POST /api/assignments — create a DRAFT assignment.
 *
 * Drafts are soft state on the backend (no fan-out, no device commands)
 * and exist purely so the operator can preview device-level impact
 * before committing. Server-side validation rejects past windows and
 * `startTime >= endTime` with 400.
 */
export const createDraft = async (req: CreateDraftRequest): Promise<AssignmentResponse> => {
  const { data } = await http.post<AssignmentResponse>('/api/assignments', req);
  return data;
};

/**
 * POST /api/assignments/{id}/confirm — promote a draft to CONFIRMED.
 *
 * **Atomic commit.** Failure modes surface as thrown axios errors; the
 * global response interceptor does NOT toast 4xx, so callers render
 * their own inline messaging:
 *
 *  1. **409 Conflict — overlap with existing CONFIRMED assignment(s).**
 *     The backend re-checks time overlap at confirm time (race
 *     protection: another operator may have confirmed an overlapping
 *     window between this caller's `createDraft` and `confirmAssignment`).
 *     The response body's `message` field carries the conflicting
 *     assignment ids in the exact form
 *     `Time overlap with existing assignment(s) [12, 17] for DEVICE_GROUP:42`.
 *     The draft itself is NOT mutated — the operator can edit times
 *     and retry. Surface the message **verbatim inline** so the operator
 *     sees which assignment(s) to inspect; do NOT replace it with a
 *     generic "could not confirm" string.
 *  2. **404 Not Found** — an entry in `excludedDeviceIds` doesn't
 *     resolve to a real device under the draft's target. Treat as a
 *     programming/UI bug; the device-picker should never produce an
 *     invalid id.
 *
 * Both narrow on `err.response?.status`. The non-blocking
 * `overlapWarnings` emitted earlier (`createDraft` / `updateSchedule`)
 * are unrelated — those are advisory; this 409 is a hard failure.
 */
export const confirmAssignment = async (
  id: number,
  req: ConfirmAssignmentRequest,
): Promise<AssignmentResponse> => {
  const { data } = await http.post<AssignmentResponse>(
    `/api/assignments/${String(id)}/confirm`,
    req,
  );
  return data;
};

/**
 * DELETE /api/assignments/{id} — cancel (soft-delete) an assignment.
 *
 * The backend transitions the assignment to CANCELLED rather than hard-deleting
 * it (audit trail). This is the prerequisite for **replacing an open-ended
 * ("forever") assignment**: the time-overlap guard blocks any new assignment to
 * the same target while a CONFIRMED one is live, so the operator must cancel the
 * existing assignment first.
 *
 * 4xx fall through the global response interceptor (no toast), so the caller
 * surfaces the envelope message inline:
 *  - **404** — unknown/already-deleted assignment id.
 *  - **409** — backend refuses the cancel (e.g. state transition not allowed).
 */
export const cancelAssignment = async (id: number): Promise<void> => {
  await http.delete(`/api/assignments/${String(id)}`);
};

/**
 * GET /api/assignments/preview — preview the device fan-out for a
 * target before creating a draft. Returns the rolled-up device list
 * along with `truncated: boolean` indicating whether the server capped
 * the list size; the UI should surface the cap rather than imply the
 * full set is shown.
 */
export const previewAssignment = async (
  targetType: TargetType,
  targetId: number,
): Promise<PreviewResult> => {
  const { data } = await http.get<PreviewResult>('/api/assignments/preview', {
    params: { targetType, targetId },
  });
  return data;
};
