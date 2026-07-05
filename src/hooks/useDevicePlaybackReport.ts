import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import {
  getDevicePlaybackReport,
  type PlaybackReportResponse,
} from '@api/resources/playbackReport';

export interface DevicePlaybackReportFilter {
  readonly deviceId: number;
  readonly dateFrom: string; // 'YYYY-MM-DD' (local UI value)
  readonly dateTo: string; // 'YYYY-MM-DD'
}

export interface UseDevicePlaybackReportResult {
  readonly data: PlaybackReportResponse | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly notFound: boolean; // true on 404 (unknown / out-of-scope device)
  readonly retry: () => void;
}

export const useDevicePlaybackReport = (
  filter: DevicePlaybackReportFilter | null,
): UseDevicePlaybackReportResult => {
  const [data, setData] = useState<PlaybackReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const key = filter === null ? '' : [filter.deviceId, filter.dateFrom, filter.dateTo].join('|');

  useEffect(() => {
    if (filter === null) {
      setData(null);
      setIsLoading(false);
      setError(null);
      setNotFound(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setNotFound(false);

    getDevicePlaybackReport(
      filter.deviceId,
      { from: filter.dateFrom, to: filter.dateTo },
      controller.signal,
    )
      .then((res) => {
        if (cancelled || controller.signal.aborted) return;
        setData(res);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        // Branch by HTTP status ONLY — no error `code` strings, no 501 path.
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setNotFound(true);
          setData(null);
          setIsLoading(false);
          return;
        }
        setError('Could not load the playback report.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { data, isLoading, error, notFound, retry };
};
