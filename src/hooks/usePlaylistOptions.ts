import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { listPlaylists, type PlaylistSummary } from '@api/resources/playlists';

export interface PlaylistOption {
  readonly id: number;
  readonly name: string;
  readonly itemCount: number;
  readonly totalDurationSeconds: number;
}

export interface PlaylistOptionsState {
  readonly playlists: readonly PlaylistOption[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

// Drop-down is single-shot; request the server's max page size (Spring caps
// at 100). Typical tenants have <50 playlists — if that ever changes, swap
// in a server-side search via PlaylistListFilters.name.
const PICKER_PAGE = { page: 0, size: 100 };

const toOption = (p: PlaylistSummary): PlaylistOption => ({
  id: p.id,
  name: p.name,
  itemCount: p.itemCount,
  totalDurationSeconds: p.totalDurationSeconds,
});

export const usePlaylistOptions = (enabled: boolean): PlaylistOptionsState => {
  const [playlists, setPlaylists] = useState<readonly PlaylistOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listPlaylists({}, PICKER_PAGE)
      .then((page) => {
        if (cancelled) return;
        setPlaylists(page.content.map(toOption));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setPlaylists([]);
        setError('Could not load playlists.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { playlists, isLoading, error, retry };
};
