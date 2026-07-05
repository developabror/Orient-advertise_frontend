// Regions resource — typed wrappers around /api/regions.
// Authorization handled by the global request interceptor.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

export interface RegionSummary {
  readonly id: number;
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly facilityCount: number;
  readonly deviceCount: number;
  readonly createdAt: string;
}

/**
 * Sub-shape inside `RegionDetail.facilities[]`. Mirrors the backend
 * `FacilityBrief` schema verbatim.
 */
export interface FacilityBrief {
  readonly id: number;
  readonly name: string;
  readonly address: string | null;
}

/**
 * Mirror of the backend `RegionDetail` schema verbatim — extends the
 * summary with the nested children needed for the region-detail page.
 * Device groups are **no longer** nested here: a group belongs to a
 * project (not a region) and spans the project's regions, so it lives on
 * `ProjectDetail.deviceGroups` (see `projects.ts`).
 */
export interface RegionDetail extends RegionSummary {
  readonly facilities: readonly FacilityBrief[];
}

export interface RegionListFilters {
  readonly projectId?: number;
  readonly name?: string;
}

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const parseRegionSummary = (raw: unknown): RegionSummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.projectId !== 'number' || !Number.isFinite(v.projectId))
    throw new Error('projectId');
  if (typeof v.code !== 'string') throw new Error('code');
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.facilityCount !== 'number' || !Number.isFinite(v.facilityCount))
    throw new Error('facilityCount');
  const deviceCount =
    typeof v.deviceCount === 'number' && Number.isFinite(v.deviceCount) ? v.deviceCount : 0;
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  return {
    id: v.id,
    projectId: v.projectId,
    code: v.code,
    name: v.name,
    facilityCount: v.facilityCount,
    deviceCount,
    createdAt: v.createdAt,
  };
};

export const listRegions = async (
  filters: RegionListFilters,
  pageable: Pageable,
): Promise<Page<RegionSummary>> => {
  const params = dropUndefined({
    projectId: filters.projectId,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/regions', { params });
  return parsePage(data, parseRegionSummary);
};

export const getRegion = async (id: number): Promise<RegionDetail> => {
  const { data } = await http.get<RegionDetail>(`/api/regions/${String(id)}`);
  return data;
};

export const createRegion = async (req: {
  projectId: number;
  code: string;
  name: string;
}): Promise<RegionDetail> => {
  const { data } = await http.post<RegionDetail>('/api/regions', req);
  return data;
};

/**
 * PUT /api/regions/{id} body `{ code?, name? }`. Both fields optional —
 * `code` and `name` can be updated independently. Pass only the field
 * that's changing; omitted fields are left as-is on the backend.
 */
export const updateRegion = async (
  id: number,
  req: { code?: string; name?: string },
): Promise<RegionDetail> => {
  const body = dropUndefined({ code: req.code, name: req.name });
  const { data } = await http.put<RegionDetail>(`/api/regions/${String(id)}`, body);
  return data;
};

/**
 * DELETE /api/regions/{id}. **ADMIN only.**
 *
 * **409 on RESTRICT block** — the region has active devices, child
 * facilities, or other sub-resources still attached. Surface the
 * message verbatim.
 */
export const deleteRegion = async (id: number): Promise<void> => {
  await http.delete(`/api/regions/${String(id)}`);
};
