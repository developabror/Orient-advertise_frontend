import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import type { TargetType } from './useAssignmentTargets';

// FE picker uses lowercase ('region'/'facility'/'group'); the backend
// `TargetType` enum is uppercase ('REGION'/'FACILITY'/'DEVICE_GROUP').
// Map at the boundary so we never ship the wrong-case value on the wire.
const TARGET_TYPE_API: Record<TargetType, 'REGION' | 'FACILITY' | 'DEVICE_GROUP'> = {
  region: 'REGION',
  facility: 'FACILITY',
  group: 'DEVICE_GROUP',
};

// Mirrors the backend `PreviewDevice` record (see api/resources/assignments.ts)
// but normalized for the picker UI: ids are stringified for set keys, name /
// serialNumber default to '' when missing so render code doesn't have to null-
// check, and `offline` is the authoritative offline flag (the `status` string
// is informational — the backend may add transitional states without a FE
// deploy, so we keep it liberal).
export interface PreviewDevice {
  readonly id: string;
  readonly name: string;
  readonly serialNumber: string;
  readonly status: string;
  readonly offline: boolean;
  readonly currentAssignmentId: number | null;
  readonly currentPlaylistId: number | null;
}

export interface AssignmentPreviewQuery {
  readonly targetType: TargetType;
  readonly targetId: string;
}

export interface AssignmentPreviewState {
  readonly devices: readonly PreviewDevice[];
  // Real device count in the target scope. May exceed `devices.length` when
  // the server caps the response (see `truncated`).
  readonly totalDevices: number;
  // How many devices the server actually returned in this response. Equals
  // `devices.length` after sanitization.
  readonly returnedCount: number;
  // True when `returnedCount < totalDevices` — UI must show this and disable
  // per-device subsetting (we'd otherwise exclude devices the operator never
  // saw). The server-side cap is currently 200.
  readonly truncated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

const toNullableNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const sanitizeDevice = (v: unknown): PreviewDevice | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  // `deviceId` is required — without it we have no stable selection key.
  // Everything else is best-effort: missing strings default to '', missing
  // booleans default to a safe value.
  if (typeof r.deviceId !== 'number' || !Number.isFinite(r.deviceId)) return null;
  const name = typeof r.name === 'string' ? r.name : '';
  const serialNumber = typeof r.serialNumber === 'string' ? r.serialNumber : '';
  const status = typeof r.status === 'string' ? r.status : 'unknown';
  const offline = r.offline === true;
  return {
    id: String(r.deviceId),
    name,
    serialNumber,
    status,
    offline,
    currentAssignmentId: toNullableNumber(r.currentAssignmentId),
    currentPlaylistId: toNullableNumber(r.currentPlaylistId),
  };
};

interface ParsedResponse {
  readonly devices: readonly PreviewDevice[];
  readonly totalDevices: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
}

/**
 * Parse a raw `/api/assignments/preview` body into the normalized FE shape.
 * Exported for unit testing — runtime callers should go through the hook so
 * that loading/error states stay in sync.
 */
export const sanitizePreviewResult = (data: unknown): ParsedResponse => {
  if (typeof data !== 'object' || data === null) {
    return { devices: [], totalDevices: 0, returnedCount: 0, truncated: false };
  }
  const v = data as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(v.devices) ? v.devices : [];
  const devices: PreviewDevice[] = [];
  for (const d of arr) {
    const parsed = sanitizeDevice(d);
    if (parsed) devices.push(parsed);
  }

  const totalDevices =
    typeof v.totalDevices === 'number' && Number.isFinite(v.totalDevices)
      ? Math.max(0, Math.floor(v.totalDevices))
      : devices.length;
  const returnedCount =
    typeof v.returnedCount === 'number' && Number.isFinite(v.returnedCount)
      ? Math.max(0, Math.floor(v.returnedCount))
      : devices.length;
  // Trust the server flag when present; otherwise derive from the counts.
  // Either-or is fine because the backend always sets one of them.
  const truncated = v.truncated === true || returnedCount < totalDevices;

  return { devices, totalDevices, returnedCount, truncated };
};

export const useAssignmentPreview = (
  query: AssignmentPreviewQuery | null,
): AssignmentPreviewState => {
  const [devices, setDevices] = useState<readonly PreviewDevice[]>([]);
  const [totalDevices, setTotalDevices] = useState(0);
  const [returnedCount, setReturnedCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Null query => not active. Reset state without firing a request.
    if (query === null) {
      setDevices([]);
      setTotalDevices(0);
      setReturnedCount(0);
      setTruncated(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    // Endpoint accepts only `targetType` and `targetId`; it is not paginated.
    // The server caps the device list (currently at 200) and reports the cap
    // via `truncated`/`returnedCount`/`totalDevices` so the UI can surface it.
    http
      .get<unknown>('/api/assignments/preview', {
        params: {
          targetType: TARGET_TYPE_API[query.targetType],
          targetId: query.targetId,
        },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitizePreviewResult(data);
        setDevices(parsed.devices);
        setTotalDevices(parsed.totalDevices);
        setReturnedCount(parsed.returnedCount);
        setTruncated(parsed.truncated);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setDevices([]);
        setError('Could not load device preview.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.targetType, query?.targetId, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { devices, totalDevices, returnedCount, truncated, isLoading, error, retry };
};
