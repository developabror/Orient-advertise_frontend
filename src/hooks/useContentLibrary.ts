import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { listContent, type ContentListFilters } from '@api/resources/content';
import { contentSummaryToItem, type ContentItem } from './useContentItems';

export interface ContentLibraryQuery {
  readonly q: string;
  readonly size: number;
}

export interface UseContentLibraryResult {
  readonly items: readonly ContentItem[];
  readonly totalItems: number;
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly loadMore: () => void;
  // Local mutations the consumer can call to keep the list in sync with
  // adjacent state (e.g. removing a row that the admin just linked elsewhere).
  readonly removeLocally: (contentId: string) => void;
}

export const useContentLibrary = (query: ContentLibraryQuery): UseContentLibraryResult => {
  const [items, setItems] = useState<readonly ContentItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  // 1-based page index for parity with the previous hook contract; converted
  // to 0-based when calling the resource (Spring is 0-indexed).
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset the cumulative list whenever `q` changes — old results no longer
  // match the new query.
  useEffect(() => {
    setPage(1);
    setItems([]);
    setTotalItems(0);
    setTotalPages(0);
  }, [query.q]);

  useEffect(() => {
    let cancelled = false;
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    setError(null);

    const filters: ContentListFilters = query.q !== '' ? { name: query.q } : {};
    const pageable = { page: Math.max(0, page - 1), size: query.size };

    listContent(filters, pageable)
      .then((res) => {
        if (cancelled) return;
        const mapped = res.content.map(contentSummaryToItem);
        if (page === 1) {
          setItems(mapped);
        } else {
          setItems((curr) => {
            // Dedupe — if the server returns an id already in the list (race
            // during fast load-more), skip it.
            const seen = new Set(curr.map((c) => c.id));
            const merged: ContentItem[] = [...curr];
            for (const e of mapped) {
              if (!seen.has(e.id)) merged.push(e);
            }
            return merged;
          });
        }
        setTotalItems(res.totalElements);
        setTotalPages(res.totalPages);
        setIsLoading(false);
        setIsLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setError('Could not load content library.');
        setIsLoading(false);
        setIsLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, query.q, query.size, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  const loadMore = useCallback((): void => {
    setPage((p) => p + 1);
  }, []);

  const removeLocally = useCallback((contentId: string): void => {
    setItems((curr) => curr.filter((c) => c.id !== contentId));
    setTotalItems((t) => Math.max(0, t - 1));
  }, []);

  const hasMore = page < totalPages;

  return {
    items,
    totalItems,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    retry,
    loadMore,
    removeLocally,
  };
};
