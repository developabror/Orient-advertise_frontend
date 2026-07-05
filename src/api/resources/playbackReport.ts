// Playback-report resource — typed wrapper around GET /api/stats/device/{deviceId}.
//
// Device-scoped mirror of /api/stats/content/{id}: "for this device, what
// played, how often, and for how long". The response envelope is scope-agnostic
// (see the prompt's Flexible scope design), so the types carry a `scope` object
// rather than flat device fields.
//
// Authorization is handled by the global request interceptor in `../http.ts`;
// resource layers MUST NOT set the Authorization header themselves.

import { http } from '../http';

export type ReportScopeType = 'DEVICE' | 'REGION' | 'DEVICE_GROUP' | 'FACILITY' | 'PROJECT';

export interface ReportScope {
  readonly type: ReportScopeType;
  readonly id: number;
  readonly name: string;
}

export interface PlaybackByContentRow {
  readonly contentFileId: number;
  readonly contentFileName: string;
  readonly playCount: number;
  readonly totalDurationSeconds: number;
  readonly durationComplete: boolean;
}

export interface PlaybackReportResponse {
  readonly scope: ReportScope;
  readonly from: string;
  readonly to: string;
  readonly totalPlayCount: number;
  readonly totalDurationSeconds: number;
  readonly durationComplete: boolean;
  readonly perContent: readonly PlaybackByContentRow[];
}

export interface PlaybackReportRange {
  readonly from: string; // 'YYYY-MM-DD' (local UI value)
  readonly to: string; // 'YYYY-MM-DD'
}

const safeNumber = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

const safeBool = (v: unknown): boolean => v === true;

// scope.id is a NUMBER on the wire; coerce a stray string defensively.
const idNum = (v: unknown, fallback: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};

// Parse the BARE perContent array. NOT a { content: [] } Page envelope.
const sanitizePerContent = (raw: unknown): PlaybackByContentRow[] => {
  if (!Array.isArray(raw)) return [];
  const rows: PlaybackByContentRow[] = [];
  for (const v of raw) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    const contentFileId = idNum(r.contentFileId, NaN);
    if (!Number.isFinite(contentFileId)) continue;
    rows.push({
      contentFileId,
      // contentFileName is never null on the wire; coerce to '' only as a guard.
      contentFileName: typeof r.contentFileName === 'string' ? r.contentFileName : '',
      playCount: safeNumber(r.playCount),
      totalDurationSeconds: safeNumber(r.totalDurationSeconds),
      durationComplete: safeBool(r.durationComplete),
    });
  }
  // Defensive client-side re-sort to the contract order (playCount DESC, name ASC).
  rows.sort(
    (a, b) => b.playCount - a.playCount || a.contentFileName.localeCompare(b.contentFileName),
  );
  return rows;
};

const sanitize = (raw: unknown, deviceId: number): PlaybackReportResponse => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const scopeRaw =
    typeof o.scope === 'object' && o.scope !== null ? (o.scope as Record<string, unknown>) : {};
  const perContent = sanitizePerContent(o.perContent);
  return {
    scope: {
      type: (typeof scopeRaw.type === 'string' ? scopeRaw.type : 'DEVICE') as ReportScopeType,
      id: idNum(scopeRaw.id, deviceId),
      name: typeof scopeRaw.name === 'string' ? scopeRaw.name : '',
    },
    from: typeof o.from === 'string' ? o.from : '',
    to: typeof o.to === 'string' ? o.to : '',
    // Prefer server totals; fall back to summing perContent if absent.
    totalPlayCount: safeNumber(o.totalPlayCount) || perContent.reduce((s, r) => s + r.playCount, 0),
    totalDurationSeconds:
      safeNumber(o.totalDurationSeconds) ||
      perContent.reduce((s, r) => s + r.totalDurationSeconds, 0),
    durationComplete: safeBool(o.durationComplete),
    perContent,
  };
};

/**
 * GET /api/stats/device/{deviceId}. Passive read — safe to retry. Pass an
 * AbortSignal so the caller hook can cancel on unmount / filter change.
 * `_suppressErrorToast: true`: a passive read renders its own inline error
 * (and a GET never triggers the error-dialog modal, so do NOT also set
 * `_suppressErrorModal`).
 */
export const getDevicePlaybackReport = async (
  deviceId: number,
  range: PlaybackReportRange,
  signal?: AbortSignal,
): Promise<PlaybackReportResponse> => {
  const { data } = await http.get<unknown>(`/api/stats/device/${String(deviceId)}`, {
    params: {
      from: `${range.from}T00:00:00Z`,
      to: `${range.to}T23:59:59Z`,
    },
    // Only attach `signal` when present — `exactOptionalPropertyTypes` rejects
    // an explicit `signal: undefined`.
    ...(signal ? { signal } : {}),
    _suppressErrorToast: true,
  });
  return sanitize(data, deviceId);
};
