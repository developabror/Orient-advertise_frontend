import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import {
  listRegions,
  type RegionSummary,
} from '@api/resources/regions';
import {
  listFacilities,
  type FacilitySummary,
} from '@api/resources/facilities';
import {
  listDeviceGroups,
  type DeviceGroupSummary,
} from '@api/resources/deviceGroups';

export type TargetType = 'region' | 'facility' | 'group';

export interface AssignmentTarget {
  readonly id: string;
  readonly name: string;
  readonly deviceCount: number;
}

export interface AssignmentTargetsState {
  readonly targets: readonly AssignmentTarget[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

// Picker is a single-shot drop-down, so request the server's max page size
// (Spring caps at 100) — typical tenants have <50 of any of these.
const PICKER_PAGE = { page: 0, size: 100 };

const regionToTarget = (r: RegionSummary): AssignmentTarget => ({
  id: String(r.id),
  name: r.name,
  deviceCount: r.deviceCount,
});

const facilityToTarget = (f: FacilitySummary): AssignmentTarget => ({
  id: String(f.id),
  name: f.name,
  deviceCount: f.deviceCount,
});

const groupToTarget = (g: DeviceGroupSummary): AssignmentTarget => ({
  id: String(g.id),
  name: g.name,
  deviceCount: g.deviceCount,
});

const fetchTargets = async (
  type: TargetType,
): Promise<readonly AssignmentTarget[]> => {
  if (type === 'region') {
    const page = await listRegions({}, PICKER_PAGE);
    return page.content.map(regionToTarget);
  }
  if (type === 'facility') {
    const page = await listFacilities({}, PICKER_PAGE);
    return page.content.map(facilityToTarget);
  }
  const page = await listDeviceGroups({}, PICKER_PAGE);
  return page.content.map(groupToTarget);
};

export const useAssignmentTargets = (type: TargetType): AssignmentTargetsState => {
  const [targets, setTargets] = useState<readonly AssignmentTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchTargets(type)
      .then((rows) => {
        if (cancelled) return;
        setTargets(rows);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setTargets([]);
        setError(`Could not load ${type}s.`);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { targets, isLoading, error, retry };
};
