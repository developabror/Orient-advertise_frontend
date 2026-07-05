// Facilities resource — typed wrappers around /api/facilities.
// Authorization handled by the global request interceptor.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

export interface FacilitySummary {
  readonly id: number;
  readonly regionId: number;
  readonly regionName: string;
  readonly name: string;
  readonly deviceCount: number;
  readonly createdAt: string;
}

/**
 * Sub-shape inside `FacilityDetail.devices`. Mirrors the backend
 * `DeviceSummary` schema verbatim.
 */
export interface FacilityDevice {
  readonly id: number;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: string;
}

/**
 * Mirror of the backend `FacilityDetail` schema verbatim — extends
 * the summary with `address` and the nested device summaries needed
 * for the facility-detail page.
 */
export interface FacilityDetail extends FacilitySummary {
  readonly address: string | null;
  readonly devices: readonly FacilityDevice[];
}

export interface FacilityListFilters {
  readonly regionId?: number;
  readonly name?: string;
}

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const parseFacilitySummary = (raw: unknown): FacilitySummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  if (typeof v.regionId !== 'number' || !Number.isFinite(v.regionId)) throw new Error('regionId');
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.deviceCount !== 'number' || !Number.isFinite(v.deviceCount))
    throw new Error('deviceCount');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  return {
    id: v.id,
    regionId: v.regionId,
    regionName: typeof v.regionName === 'string' ? v.regionName : '',
    name: v.name,
    deviceCount: v.deviceCount,
    createdAt: v.createdAt,
  };
};

export const listFacilities = async (
  filters: FacilityListFilters,
  pageable: Pageable,
): Promise<Page<FacilitySummary>> => {
  const params = dropUndefined({
    regionId: filters.regionId,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/facilities', { params });
  return parsePage(data, parseFacilitySummary);
};

export const getFacility = async (id: number): Promise<FacilityDetail> => {
  const { data } = await http.get<FacilityDetail>(`/api/facilities/${String(id)}`);
  return data;
};

export const createFacility = async (req: {
  regionId: number;
  name: string;
}): Promise<FacilityDetail> => {
  const { data } = await http.post<FacilityDetail>('/api/facilities', req);
  return data;
};

export const renameFacility = async (id: number, name: string): Promise<FacilityDetail> => {
  const { data } = await http.put<FacilityDetail>(`/api/facilities/${String(id)}`, { name });
  return data;
};

/**
 * DELETE /api/facilities/{id}. **ADMIN only.**
 *
 * **409 on active devices or active assignments.** Surface the
 * message verbatim so the operator knows which devices/assignments
 * are blocking.
 */
export const deleteFacility = async (id: number): Promise<void> => {
  await http.delete(`/api/facilities/${String(id)}`);
};
