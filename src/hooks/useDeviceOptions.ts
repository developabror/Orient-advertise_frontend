import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { listDevices, type DeviceListItem } from '@api/resources/devices';

export interface DeviceOption {
  readonly value: number; // numeric device id (matches scope.id being a number)
  readonly label: string; // device name (fallback to id)
}

export interface DeviceOptionsState {
  readonly options: readonly DeviceOption[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

// Single-shot picker load; request the server's max page size (Spring caps at
// 100). Operator callers are server-scoped to their own devices. Typical
// tenants fit in one page — if a fleet ever exceeds 100, swap this for
// server-side search via DeviceListFilters.name.
const PICKER_PAGE = { page: 0, size: 100 };

const toOption = (d: DeviceListItem): DeviceOption => ({
  value: d.id,
  label: d.name !== '' ? d.name : String(d.id),
});

export const useDeviceOptions = (): DeviceOptionsState => {
  const [options, setOptions] = useState<readonly DeviceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listDevices({}, PICKER_PAGE)
      .then((page) => {
        if (cancelled) return;
        setOptions(page.content.map(toOption));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setOptions([]);
        setError('Could not load devices.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { options, isLoading, error, retry };
};
