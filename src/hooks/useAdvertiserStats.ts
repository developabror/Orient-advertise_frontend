import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { http } from '@api/http';
import { useAuth } from './useAuth';

export interface AdvertiserContentItem {
  readonly id: string;
  readonly filename: string;
}

export interface PlayCountRow {
  readonly contentId: string;
  readonly filename: string;
  readonly plays: number;
}

export interface AdvertiserStatsFilter {
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface UseAdvertiserStatsResult {
  readonly content: readonly AdvertiserContentItem[];
  readonly rows: readonly PlayCountRow[];
  readonly totalPlays: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

const safeNumber = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

// Spec: GET /api/users/{userId}/content → LinkedContent[] { id, name, status }.
const sanitizeContent = (data: unknown): readonly AdvertiserContentItem[] => {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (typeof data === 'object' && data !== null) {
    const inner = (data as Record<string, unknown>).data;
    if (Array.isArray(inner)) arr = inner;
  }
  const items: AdvertiserContentItem[] = [];
  for (const v of arr) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    const id = idStr(r.id);
    if (id === null) continue;
    const filename =
      typeof r.name === 'string' && r.name !== ''
        ? r.name
        : typeof r.filename === 'string'
          ? r.filename
          : id;
    items.push({ id, filename });
  }
  return items;
};

// Spec: GET /api/stats/content/{contentFileId} → ContentStatsResponse.
const parseTotalPlays = (data: unknown): number => {
  if (typeof data !== 'object' || data === null) return 0;
  const v = data as Record<string, unknown>;
  return safeNumber(v.totalPlayCount);
};

export const useAdvertiserStats = (filter: AdvertiserStatsFilter): UseAdvertiserStatsResult => {
  const { user } = useAuth();
  const [content, setContent] = useState<readonly AdvertiserContentItem[]>([]);
  const [playsById, setPlaysById] = useState<ReadonlyMap<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const userId = user?.sub ?? '';
  const key = `${userId}|${filter.dateFrom}|${filter.dateTo}`;

  useEffect(() => {
    if (userId === '') {
      setContent([]);
      setPlaysById(new Map());
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    const load = async (): Promise<void> => {
      try {
        // 1) Fetch the advertiser's linked content (one call).
        const linkedRes = await http.get<unknown>(
          `/api/users/${encodeURIComponent(userId)}/content`,
          { signal: controller.signal, _suppressErrorToast: true },
        );
        if (cancelled || controller.signal.aborted) return;
        const items = sanitizeContent(linkedRes.data);
        setContent(items);

        // 2) Fan out to per-content stats in parallel — one call per linked
        //    content. Spec doesn't expose a "stats for all my content" rollup,
        //    so this is the cleanest approximation. allSettled so a single
        //    flaky stat call doesn't sink the whole dashboard.
        const fromIso = `${filter.dateFrom}T00:00:00Z`;
        const toIso = `${filter.dateTo}T23:59:59Z`;
        const results = await Promise.allSettled(
          items.map((c) =>
            http.get<unknown>(`/api/stats/content/${encodeURIComponent(c.id)}`, {
              params: { from: fromIso, to: toIso, page: 0, size: 1 },
              signal: controller.signal,
              _suppressErrorToast: true,
            }),
          ),
        );
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled || controller.signal.aborted) return;
        const map = new Map<string, number>();
        results.forEach((r, i) => {
          const c = items[i];
          if (!c) return;
          if (r.status === 'fulfilled') map.set(c.id, parseTotalPlays(r.value.data));
          else map.set(c.id, 0);
        });
        setPlaysById(map);
        setIsLoading(false);
      } catch (err: unknown) {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setError('Could not load play counts.');
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  const { rows, totalPlays } = useMemo(() => {
    const filtered: PlayCountRow[] = content.map((c) => ({
      contentId: c.id,
      filename: c.filename,
      plays: playsById.get(c.id) ?? 0,
    }));
    filtered.sort((a, b) => b.plays - a.plays || a.filename.localeCompare(b.filename));
    const total = filtered.reduce((s, r) => s + r.plays, 0);
    return { rows: filtered, totalPlays: total };
  }, [content, playsById]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { content, rows, totalPlays, isLoading, error, retry };
};
