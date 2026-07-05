import { http } from './http';
import { markErrorHandled } from './errorDialog';
import { extractApiMessage } from './resources/_types';

// ASSIGN_CONTENT carries a playlistId payload — the runner forwards
// `payload` (a JSON-serialised `{"playlistId": <id>}` string per the
// backend BulkRemoteActionService contract) on the wire. SYNC_CONTENT
// and REBOOT are payload-free; passing a payload for those is a no-op
// on the backend but the runner doesn't gate on action type — caller
// is responsible.
export type DeviceGroupAction = 'SYNC_CONTENT' | 'REBOOT' | 'ASSIGN_CONTENT';

// Pre-flight grouping. `byGroup` is `groupId → selected device ids` so the
// caller can show per-group counts in the confirm dialog. `ungrouped` is
// devices the API can't reach via the group endpoint — they get skipped with
// a warning.
export interface BulkPlan {
  readonly byGroup: ReadonlyMap<string, readonly string[]>;
  readonly ungrouped: readonly string[];
}

export interface BulkSummary {
  readonly groupCount: number;
  readonly groupsSucceeded: number;
  readonly groupsFailed: number;
  // Device-level totals aggregated across all group responses.
  readonly total: number;
  readonly queued: number;
  readonly failed: number;
  // Devices the action couldn't be sent to (no group affiliation).
  readonly skipped: number;
  // Verbatim backend messages from the groups whose request was rejected, so
  // the done-modal can show *why* (e.g. a 409 reason) instead of a bare count.
  readonly errors?: readonly string[];
}

export interface GroupResult {
  readonly groupId: string;
  readonly total: number;
  readonly queued: number;
  readonly failed: number;
  readonly errored: boolean;
  // Operator-facing backend message when this group's request was rejected
  // with an ErrorResponse envelope (absent for success / message-less failures).
  readonly message?: string;
}

export const planBulkSelection = (
  selectedDevices: ReadonlyMap<string, string | null>,
): BulkPlan => {
  const byGroup = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const [deviceId, groupId] of selectedDevices) {
    if (groupId === null) {
      ungrouped.push(deviceId);
      continue;
    }
    const list = byGroup.get(groupId);
    if (list !== undefined) list.push(deviceId);
    else byGroup.set(groupId, [deviceId]);
  }
  return { byGroup, ungrouped };
};

const safeNumber = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

interface ParsedGroupResponse {
  readonly total: number;
  readonly queued: number;
  readonly failed: number;
}

// Spec BulkActionResponse:
//   { deviceGroupId, actionType, totalDevices, succeededCount,
//     skippedCount, failedCount, succeededActionIds[], skipped[], failed[] }
// We fold skippedCount into the failed bucket: from the operator's POV both
// "skipped" and "failed" are non-success outcomes for that group's devices.
const parseGroupResponse = (data: unknown, fallbackTotal: number): ParsedGroupResponse => {
  if (typeof data !== 'object' || data === null) {
    return { total: fallbackTotal, queued: fallbackTotal, failed: 0 };
  }
  const v = data as Record<string, unknown>;
  const totalRaw = safeNumber(v.totalDevices ?? v.total);
  const queued = safeNumber(v.succeededCount ?? v.queued);
  const failed = safeNumber(v.failedCount ?? v.failed) + safeNumber(v.skippedCount);
  const total = totalRaw > 0 ? totalRaw : queued + failed > 0 ? queued + failed : fallbackTotal;
  return { total, queued, failed };
};

interface RunBulkOptions {
  readonly action: DeviceGroupAction;
  readonly plan: BulkPlan;
  // Optional payload string forwarded as-is to the backend's
  // `BulkActionRequest.payload` field. Required for ASSIGN_CONTENT — the
  // backend validates it as a JSON `{"playlistId":<id>}`. Pass undefined
  // for SYNC_CONTENT / REBOOT.
  readonly payload?: string;
  // Fired after each group response (success or failure). Lets the page show
  // live progress — incremented on settlement, not start, so the bar reflects
  // actually-completed work.
  readonly onProgress?: (doneGroups: number, totalGroups: number) => void;
}

export interface RunBulkResult {
  readonly summary: BulkSummary;
  readonly perGroup: readonly GroupResult[];
}

/**
 * Execute a bulk action across the planned groups in parallel via
 * Promise.allSettled — one group failing does not cancel the others. Returns
 * an aggregated summary plus per-group results for diagnostics.
 */
export const runBulkGroupActions = async (options: RunBulkOptions): Promise<RunBulkResult> => {
  const groupIds = Array.from(options.plan.byGroup.keys());
  const total = groupIds.length;
  let done = 0;

  const settled = await Promise.allSettled(
    groupIds.map(async (groupId): Promise<GroupResult> => {
      const selected = options.plan.byGroup.get(groupId) ?? [];
      try {
        const { data } = await http.post<unknown>(
          `/api/device-groups/${encodeURIComponent(groupId)}/actions`,
          // Spec: BulkActionRequest { actionType, payload? }.
          // payload is included only when present — the backend treats
          // `payload: undefined` and an absent key the same way (JSON
          // omission), but explicitly omitting keeps logs clean.
          options.payload === undefined
            ? { actionType: options.action }
            : { actionType: options.action, payload: options.payload },
          { _suppressErrorToast: true },
        );
        const parsed = parseGroupResponse(data, selected.length);
        return {
          groupId,
          total: parsed.total,
          queued: parsed.queued,
          failed: parsed.failed,
          errored: false,
        };
      } catch (err: unknown) {
        // Claim each rejection here — synchronously as its POST settles, before
        // the interceptor's deferred macrotask fires — so a failing group does
        // NOT pop the global modal mid-bulk. The reason is folded into the
        // done-modal via `message` instead.
        markErrorHandled(err);
        const message = extractApiMessage(err);
        return {
          groupId,
          total: selected.length,
          queued: 0,
          failed: selected.length,
          errored: true,
          ...(message !== null ? { message } : {}),
        };
      } finally {
        // Increment regardless of outcome — `errored` carries the success bit.
        done += 1;
        options.onProgress?.(done, total);
      }
    }),
  );

  const perGroup: GroupResult[] = [];
  let groupsSucceeded = 0;
  let groupsFailed = 0;
  let totalDevices = 0;
  let queued = 0;
  let failed = 0;

  for (let i = 0; i < settled.length; i++) {
    const groupId = groupIds[i];
    if (groupId === undefined) continue;
    const r = settled[i];
    if (r === undefined) continue;
    if (r.status === 'fulfilled') {
      const g = r.value;
      perGroup.push(g);
      totalDevices += g.total;
      queued += g.queued;
      failed += g.failed;
      // The per-group function now resolves (never rejects) for a failed
      // request, carrying `errored: true` + an optional reason — so branch on
      // the success bit, not the settle state.
      if (g.errored) groupsFailed += 1;
      else groupsSucceeded += 1;
    } else {
      // Defensive only — the per-group function catches its own request
      // failures, so this triggers only on an unexpected throw (e.g. inside the
      // onProgress callback). Treat as a whole-group failure; we don't know the
      // group's full size so use the selected count as an honest lower bound.
      const selectedInGroup = options.plan.byGroup.get(groupId)?.length ?? 0;
      perGroup.push({
        groupId,
        total: selectedInGroup,
        queued: 0,
        failed: selectedInGroup,
        errored: true,
      });
      totalDevices += selectedInGroup;
      failed += selectedInGroup;
      groupsFailed += 1;
    }
  }

  const errors: string[] = [];
  for (const g of perGroup) {
    if (g.message !== undefined && g.message !== '') errors.push(g.message);
  }

  return {
    summary: {
      groupCount: total,
      groupsSucceeded,
      groupsFailed,
      total: totalDevices,
      queued,
      failed,
      skipped: options.plan.ungrouped.length,
      ...(errors.length > 0 ? { errors } : {}),
    },
    perGroup,
  };
};
