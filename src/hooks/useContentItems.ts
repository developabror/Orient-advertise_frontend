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
}

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

  return { items, totalPages, totalItems, isLoading, isStale, refresh };
};
