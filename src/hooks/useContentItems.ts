import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import {
  listContent,
  type ContentFileStatus,
  type ContentFileSummary,
  type ContentListFilters,
} from '@api/resources/content';

export type ContentStatus = 'ready' | 'transcoding' | 'failed' | 'invalid' | 'uploading';

export interface ContentItem {
  readonly id: string;
  readonly filename: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly status: ContentStatus;
  readonly progressPct: number;
  readonly urgent: boolean;
  readonly assignedTo: number;
  readonly errorMessage: string | null;
  readonly thumbnailUrl: string | null;
  readonly uploadedByUsername: string | null;
  readonly canManage: boolean;
  /**
   * The row has sat in a pre-terminal status far longer than the pipeline
   * should take — nothing is going to finish it without intervention.
   *
   * **Derived from server data on every fetch**, so it survives a reload and
   * a route change. The uploader's old 10-minute deadline lived only in
   * component state: the message told the operator to refresh, and the
   * refresh erased both the message and the polling that produced it.
   */
  readonly stalled: boolean;
  /** Server `createdAt` — the age basis for a stalled `UPLOADED` row. */
  readonly createdAt: string;
}

export interface ContentItemsQuery {
  readonly page: number;
  readonly size: number;
  readonly status: string;
}

export interface ContentItemsState {
  readonly items: readonly ContentItem[];
  readonly totalPages: number;
  readonly totalItems: number;
  readonly isLoading: boolean;
  readonly isStale: boolean;
  readonly refresh: () => void;
  /**
   * Apply a local patch to one already-loaded row. Used for the optimistic
   * flip to `transcoding` after a successful retranscode, so the card moves
   * immediately and WS/poll takes over from there. The next `refresh()`
   * overwrites it with server truth.
   */
  readonly patchItem: (id: string, patch: Partial<ContentItem>) => void;
}

/**
 * A row still `UPLOADED` this long after creation has lost its transcode
 * dispatch. Mirrors `TranscodeSweeper`'s `app.video.sweeper.stale-alert-after`
 * (default `PT10M`) — the same age at which the backend raises its own alert.
 */
const STALL_UPLOADED_MS = 10 * 60 * 1000;

/**
 * A row `TRANSCODING` this long has almost certainly been killed mid-ffmpeg.
 * Mirrors `app.video.sweeper.lease-timeout` (default `PT20M`), so the FE never
 * declares a row stuck while the server still considers its lease live and is
 * about to reclaim it.
 *
 * Both thresholds are heuristics on data the listing already carries. If the
 * backend ever puts its own verdict on the row (`stalled`), that wins — see
 * {@link isRowStalled}.
 */
const STALL_TRANSCODING_MS = 20 * 60 * 1000;

const ageMs = (iso: string | null, now: number): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : null;
};

/**
 * Is this row stuck? The server's own `stalled` verdict wins whenever it
 * sends one; the age heuristic below is the fallback for a backend that
 * predates the transcode-lease migration.
 *
 * Exported for direct unit testing — pure, no side effects.
 */
export const isRowStalled = (row: ContentFileSummary, now: number = Date.now()): boolean => {
  if (row.stalled !== null) return row.stalled;
  if (row.status === 'UPLOADED') {
    const age = ageMs(row.createdAt, now);
    return age !== null && age >= STALL_UPLOADED_MS;
  }
  if (row.status === 'TRANSCODING') {
    // `updatedAt` is the fallback basis precisely because it does NOT advance
    // during the encode: the row is touched when it enters TRANSCODING and
    // not again until the terminal state.
    const age = ageMs(row.transcodeStartedAt ?? row.updatedAt, now);
    return age !== null && age >= STALL_TRANSCODING_MS;
  }
  return false;
};

const STATUS_DOWN: Record<ContentFileStatus, ContentStatus> = {
  UPLOADED: 'uploading',
  TRANSCODING: 'transcoding',
  READY: 'ready',
  FAILED: 'failed',
  INVALID: 'invalid',
};

const STATUS_UP: Partial<Record<string, ContentFileStatus>> = {
  ready: 'READY',
  transcoding: 'TRANSCODING',
  failed: 'FAILED',
  invalid: 'INVALID',
  uploading: 'UPLOADED',
};

export const contentSummaryToItem = (row: ContentFileSummary): ContentItem => ({
  id: String(row.id),
  filename: row.name,
  durationSeconds: row.durationSeconds ?? 0,
  sizeBytes: row.sizeBytes,
  status: STATUS_DOWN[row.status],
  // ContentFileSummary doesn't carry transient FE concerns. Defaults keep
  // ContentCard's progress/urgent/assignment UI inert until those fields
  // are sourced separately.
  progressPct: 0,
  urgent: false,
  assignedTo: 0,
  errorMessage: row.invalidReason,
  thumbnailUrl: row.thumbnailUrl,
  uploadedByUsername: row.uploadedByUsername,
  canManage: row.canManage,
  stalled: isRowStalled(row),
  createdAt: row.createdAt,
});

export const useContentItems = (query: ContentItemsQuery): ContentItemsState => {
  const [items, setItems] = useState<readonly ContentItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const upper = STATUS_UP[query.status];
    const filters: ContentListFilters = upper !== undefined ? { status: upper } : {};

    // Operator content scoping (owned ∪ admin-granted) is fully server-side,
    // mirroring the advertiser note in content.ts — no FE-side filtering.
    // ContentPage exposes a 1-based page in the URL; Spring is 0-indexed.
    const pageable = { page: Math.max(0, query.page - 1), size: query.size };

    listContent(filters, pageable)
      .then((page) => {
        if (cancelled) return;
        setItems(page.content.map(contentSummaryToItem));
        setTotalItems(page.totalElements);
        setTotalPages(page.totalPages);
        setIsStale(false);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setIsStale(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query.page, query.size, query.status, refreshKey]);

  const refresh = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<ContentItem>): void => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  return { items, totalPages, totalItems, isLoading, isStale, refresh, patchItem };
};
