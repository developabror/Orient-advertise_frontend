import { useEffect, useState } from 'react';
import axios from 'axios';
import { listRegions } from '@api/resources/regions';

export interface Region {
  readonly id: string;
  readonly name: string;
  // The project this region belongs to. Carried so consumers (e.g. the
  // Devices page) can derive a selected region's project for the
  // project-scoped device-group fetch.
  readonly projectId: number;
}

export const useRegions = (): readonly Region[] => {
  const [regions, setRegions] = useState<readonly Region[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRegions({}, { page: 0, size: 100 })
      .then((page) => {
        if (cancelled) return;
        setRegions(
          page.content.map((r) => ({ id: String(r.id), name: r.name, projectId: r.projectId })),
        );
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return;
        // Best-effort; the filter falls back to "All regions" if the call fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return regions;
};
