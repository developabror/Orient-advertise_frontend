import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getContentSummary,
  listContent,
  type ContentFileStatus,
  type ContentFileSummary,
  type ContentListFilters,
} from '@api/resources/content';
import {
  wsClient,
  type ContentStatusChangeEvent,
  type ContentWsStatus,
} from '@api/wsClient';
import { useWsEvent } from './useWsEvent';

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
  /**
   * Reconcile one row against the server by id — the single entry point for
   * "something happened to content {id}, find out what".
   *
   * A row already in `items` is replaced in place; an unknown row is
   * prepended when it belongs at the head of page 1 under the active filter,
   * and dropped otherwise. An id the caller has no access to (404/403) is
   * remembered and never fetched again for the life of the hook.
   *
   * Callers pass a server id and nothing else — there is no optimistic shape
   * to keep in sync. Safe to call repeatedly for the same id; concurrent
   * calls collapse to one request.
   */
  readonly syncItem: (contentId: string) => void;
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

/**
 * Poll cadence while the live feed is up. At this distance the poll is a
 * safety net behind CONTENT_STATUS_CHANGE, not the mechanism — mirrors
 * `useIncidents`, which owns the same fetch+WS pairing for incidents.
 */
const POLL_OPEN_MS = 60_000;

/** Socket down: the poll *is* the mechanism now, so it tightens. */
const POLL_FALLBACK_MS = 30_000;

/**
 * Debounce before the silent refetch that follows an optimistic insert.
 *
 * A prepend can push a row off the end of a full page, and whether the
 * server already counted it depends on when the last fetch ran — so instead
 * of doing arithmetic on `totalItems`, one refetch restores exact totals and
 * page composition. The delay is what makes a 10-file batch cost one refetch
 * instead of ten.
 */
const INSERT_CONVERGE_MS = 1_500;

/** Same idea, after a fetch was discarded because a local write raced it. */
const WRITE_CONVERGE_MS = 1_000;

const WS_STATUS_DOWN: Record<ContentWsStatus, ContentStatus> = {
  TRANSCODING: 'transcoding',
  READY: 'ready',
  FAILED: 'failed',
  INVALID: 'invalid',
};

/**
 * Does this row belong in a listing filtered by `filter`?
 *
 * `filter` is the raw query-string value the page holds: `''` for "all",
 * otherwise a {@link ContentStatus}. Exported for direct unit testing —
 * pure, no side effects.
 */
export const matchesContentFilter = (item: ContentItem, filter: string): boolean =>
  filter === '' || item.status === filter;

/**
 * Fold a live status frame into a row already on screen.
 *
 * Returns `row` itself when the frame says nothing new, so the caller can
 * skip the write entirely and React can skip the render — a repeated frame
 * must not repaint the grid.
 *
 * Exported for direct unit testing — pure, no side effects.
 */
export const applyWsPatch = (row: ContentItem, e: ContentStatusChangeEvent): ContentItem => {
  const status = WS_STATUS_DOWN[e.status];
  const same = (next: ContentItem): ContentItem =>
    next.status === row.status &&
    next.stalled === row.stalled &&
    next.errorMessage === row.errorMessage &&
    next.progressPct === row.progressPct
      ? row
      : next;

  if (e.status === 'READY') {
    // The frame carries neither thumbnailUrl nor durationSeconds; the caller
    // follows this with a targeted hydrate for those two.
    return same({ ...row, status, stalled: false, errorMessage: null, progressPct: 100 });
  }
  if (e.status === 'TRANSCODING') {
    // The current broadcaster emits five keys and `progressPct` is not one of
    // them, so in production this always keeps the row's existing value. It is
    // honoured when a backend does start reporting it, clamped below 100 so a
    // determinate bar can never claim completion the status contradicts.
    const pct =
      typeof e.progressPct === 'number' && Number.isFinite(e.progressPct)
        ? Math.min(99, Math.max(0, e.progressPct))
        : row.progressPct;
    return same({ ...row, status, stalled: false, errorMessage: null, progressPct: pct });
  }
  // FAILED / INVALID — the frame carries everything the card renders, so no
  // hydrate follows. `invalidReason` is null on a FAILED frame; keep whatever
  // reason the row already had rather than blanking it.
  return same({ ...row, status, stalled: false, errorMessage: e.invalidReason ?? row.errorMessage });
};

/**
 * The content listing, kept live.
 *
 * Ownership note: this hook owns `items`, so it also owns every way `items`
 * can change — the fetch, the poll, the live CONTENT_STATUS_CHANGE feed, and
 * the optimistic writes. That is the whole point of the shape.
 *
 * It used to own only the fetch. The single subscriber to the live feed was
 * `ContentUploader`, which matched frames against its own per-mount reducer
 * state; after a reload that state was empty, so every READY frame for a row
 * uploaded before the reload was discarded and the card sat on "Transcoding"
 * until the operator reloaded a second time. A transient, per-file component
 * cannot be the bridge for a durable, per-row concern.
 */
export const useContentItems = (query: ContentItemsQuery): ContentItemsState => {
  const [items, setItems] = useState<readonly ContentItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  // `items` mirrored synchronously so the WS handler and the hydrate
  // continuations read the current list without waiting for a paint and
  // without capturing a stale render value.
  const itemsRef = useRef<readonly ContentItem[]>([]);

  // The active query, mirrored for the same reason: the WS subscription is
  // keyed on the event type alone and must not re-subscribe when the operator
  // pages or changes the filter.
  const pageRef = useRef(query.page);
  const sizeRef = useRef(query.size);
  const statusRef = useRef(query.status);
  pageRef.current = query.page;
  sizeRef.current = query.size;
  statusRef.current = query.status;

  /**
   * Ids this session must never fetch again.
   *
   * Content frames fan out **unscoped** — every dashboard session receives
   * every content file's frames, including files the viewer has no grant for.
   * Asking for one of those returns 404, and without this set every operator's
   * browser would re-GET every other operator's content on every frame of
   * every transcode. With it the cost is one suppressed GET per distinct
   * foreign id per session.
   */
  const foreignIdsRef = useRef(new Set<string>());
  /** Ids with a hydrate in flight — collapses concurrent calls to one request. */
  const pendingHydrateRef = useRef(new Map<string, AbortController>());
  /**
   * Counts local writes to `items`. A fetch that resolves across a bump was
   * started before the write and would silently undo it, so it keeps its
   * totals and drops its rows. See {@link scheduleConverge}.
   */
  const localWriteEpochRef = useRef(0);
  const convergeTimerRef = useRef<number | null>(null);
  const fetchRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(true);

  /**
   * The only writer of `items`. Keeps `itemsRef` in lockstep, and treats an
   * updater that returns its input as "nothing happened" so an idempotent
   * frame costs no render.
   */
  const commitItems = useCallback(
    (updater: (prev: readonly ContentItem[]) => readonly ContentItem[]): void => {
      const next = updater(itemsRef.current);
      if (next === itemsRef.current) return;
      itemsRef.current = next;
      setItems(next);
    },
    [],
  );

  /** At most one pending converge fetch; a newer request replaces the older. */
  const scheduleConverge = useCallback((ms: number): void => {
    if (convergeTimerRef.current !== null) window.clearTimeout(convergeTimerRef.current);
    convergeTimerRef.current = window.setTimeout(() => {
      convergeTimerRef.current = null;
      if (!mountedRef.current) return;
      fetchRef.current();
    }, ms);
  }, []);

  const syncItem = useCallback(
    (contentId: string): void => {
      if (pendingHydrateRef.current.has(contentId)) return;
      const controller = new AbortController();
      pendingHydrateRef.current.set(contentId, controller);

      getContentSummary(Number(contentId), { signal: controller.signal })
        .then((row) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          const item = contentSummaryToItem(row);
          // The row may have moved out of the active filter between the frame
          // and this response — an UPLOADED row hydrated under a `ready`
          // filter does not belong on screen.
          if (!matchesContentFilter(item, statusRef.current)) return;

          if (itemsRef.current.some((i) => i.id === item.id)) {
            commitItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
            localWriteEpochRef.current += 1;
            return;
          }
          // Under `createdAt,desc` a brand-new row belongs at the head of
          // page 1 and nowhere else; inserting it into page 3 would corrupt
          // the pagination the operator is reading.
          if (pageRef.current !== 1) return;
          commitItems((prev) => [item, ...prev].slice(0, sizeRef.current));
          localWriteEpochRef.current += 1;
          scheduleConverge(INSERT_CONVERGE_MS);
        })
        .catch((err: unknown) => {
          // 404/403 is a verdict about access and will not change while this
          // hook lives — remember it. Anything else (a timeout, a 5xx, an
          // abort) is transient; dropping it leaves the id fetchable on the
          // next frame rather than poisoning it.
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          if (status === 404 || status === 403) foreignIdsRef.current.add(contentId);
        })
        .finally(() => {
          pendingHydrateRef.current.delete(contentId);
        });
    },
    [commitItems, scheduleConverge],
  );

  // Mount lifetime. Anything started by a callback rather than by the fetch
  // effect is torn down here, because those outlive a query change.
  useEffect(() => {
    mountedRef.current = true;
    const hydrates = pendingHydrateRef.current;
    const foreignIds = foreignIdsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of hydrates.values()) controller.abort();
      hydrates.clear();
      foreignIds.clear();
      if (convergeTimerRef.current !== null) {
        window.clearTimeout(convergeTimerRef.current);
        convergeTimerRef.current = null;
      }
    };
  }, []);

  // Fetch + adaptive polling, scoped to the current query. This effect holds
  // the file's only `setIsLoading(true)`: the spinner belongs to "the
  // operator asked for a different list", never to a background refetch.
  // Unmounting 24 cards for a poll tick would collapse the grid, clamp the
  // scroll position and drop focus to <body>.
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let pollId: number | null = null;
    let pollMs = POLL_OPEN_MS;
    setIsLoading(true);

    const upper = STATUS_UP[query.status];
    const filters: ContentListFilters = upper !== undefined ? { status: upper } : {};

    const fetchList = async (): Promise<void> => {
      // One list request in flight, always.
      controller?.abort();
      const active = new AbortController();
      controller = active;
      const epochAtStart = localWriteEpochRef.current;
      try {
        // Operator content scoping (owned ∪ admin-granted) is fully
        // server-side, mirroring the advertiser note in content.ts — no
        // FE-side filtering. ContentPage exposes a 1-based page in the URL;
        // Spring is 0-indexed. The sort is what makes "prepend to page 1"
        // mean the same thing to the client and the server.
        const page = await listContent(
          filters,
          { page: Math.max(0, query.page - 1), size: query.size, sort: 'createdAt,desc' },
          { signal: active.signal, suppressErrorToast: true },
        );
        if (cancelled || active.signal.aborted) return;
        setTotalItems(page.totalElements);
        setTotalPages(page.totalPages);
        setIsStale(false);
        setIsLoading(false);
        if (localWriteEpochRef.current !== epochAtStart) {
          // A local write landed while this was in flight; these rows predate
          // it. Take the totals, drop the rows, come back once it settles.
          scheduleConverge(WRITE_CONVERGE_MS);
          return;
        }
        commitItems(() => page.content.map(contentSummaryToItem));
      } catch (err: unknown) {
        if (cancelled || active.signal.aborted || axios.isCancel(err)) return;
        // Never clear `items` on error — a failed poll must not blank a grid
        // that is still showing the last good answer. `isStale` says so.
        setIsStale(true);
        setIsLoading(false);
      }
    };

    const startPolling = (): void => {
      if (pollId !== null) window.clearInterval(pollId);
      pollId = window.setInterval(() => {
        void fetchList();
      }, pollMs);
    };

    fetchRef.current = () => {
      void fetchList();
    };
    void fetchList();
    startPolling();

    const unsubStatus = wsClient.onStatus((status) => {
      const next = status === 'open' ? POLL_OPEN_MS : POLL_FALLBACK_MS;
      if (next !== pollMs) {
        pollMs = next;
        startPolling();
      }
    });

    return () => {
      cancelled = true;
      controller?.abort();
      if (pollId !== null) window.clearInterval(pollId);
      unsubStatus();
    };
  }, [query.page, query.size, query.status, commitItems, scheduleConverge]);

  // The live feed. `useWsEvent` keeps the handler in a ref and re-subscribes
  // only on the event type, so paging or changing the filter causes no churn
  // — which is why everything below reads refs, never a captured render value.
  useWsEvent('CONTENT_STATUS_CHANGE', (event) => {
    const id = String(event.contentId);
    const row = itemsRef.current.find((i) => i.id === id);

    if (row !== undefined) {
      const patched = applyWsPatch(row, event);
      if (patched !== row) {
        commitItems((prev) => prev.map((i) => (i.id === id ? patched : i)));
        localWriteEpochRef.current += 1;
      }
      // READY is the one transition the frame under-describes: the poster and
      // the duration are written to the row before the broadcast but are not
      // on the wire. One hydrate picks them up — and it is race-free, so it
      // needs no retry.
      if (event.status === 'READY') syncItem(id);
      return;
    }

    // Not on screen. Cheapest guard first — the common case in a fleet is a
    // frame about another operator's file.
    if (foreignIdsRef.current.has(id)) return;
    if (pendingHydrateRef.current.has(id)) return;
    if (pageRef.current !== 1) return;
    if (statusRef.current !== '' && WS_STATUS_DOWN[event.status] !== statusRef.current) return;
    syncItem(id);
  });

  /**
   * Refetch without touching `isLoading`. Identity is stable for the life of
   * the hook — `ContentUploader` mirrors it into a ref, and a changing
   * identity would re-arm that effect on every render.
   */
  const refresh = useCallback((): void => {
    fetchRef.current();
  }, []);

  const patchItem = useCallback(
    (id: string, patch: Partial<ContentItem>): void => {
      const row = itemsRef.current.find((i) => i.id === id);
      if (row === undefined) return;
      const next = { ...row, ...patch };
      commitItems((prev) => prev.map((i) => (i.id === id ? next : i)));
      localWriteEpochRef.current += 1;
    },
    [commitItems],
  );

  return { items, totalPages, totalItems, isLoading, isStale, refresh, patchItem, syncItem };
};
