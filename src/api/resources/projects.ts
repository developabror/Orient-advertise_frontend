// Projects resource — typed wrappers around /api/projects.
// Authorization handled by the global request interceptor.

import { http } from '../http';

export interface ProjectSummary {
  readonly id: number;
  readonly name: string;
  readonly regionCount: number;
  readonly createdAt: string;
}

/**
 * Single child-region entry inside `ProjectDetail.regions`. Mirrors the
 * backend `RegionBrief` schema verbatim — a reduced region shape used
 * only for the project-detail nesting.
 */
export interface RegionBrief {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly createdAt: string;
}

/**
 * Sub-shape inside `ProjectDetail.deviceGroups[]`. Mirrors the backend
 * `DeviceGroupBrief` schema verbatim — a reduced device-group shape.
 * Device groups belong to a project (not a region) and span the
 * project's regions, so they nest here rather than on `RegionDetail`.
 */
export interface DeviceGroupBrief {
  readonly id: number;
  readonly name: string;
}

/**
 * Mirror of the backend `ProjectDetail` schema verbatim — adds the
 * nested `regions[]` and `deviceGroups[]` collections on top of the
 * summary fields.
 */
export interface ProjectDetail extends ProjectSummary {
  readonly regions: readonly RegionBrief[];
  readonly deviceGroups: readonly DeviceGroupBrief[];
}

/**
 * GET /api/projects — full list, **not paged**. Projects are a small
 * top-level set (typically <50 per tenant) so the backend returns the
 * full collection in one shot.
 */
export const listProjects = async (): Promise<ProjectSummary[]> => {
  const { data } = await http.get<ProjectSummary[]>('/api/projects');
  return data;
};

export const getProject = async (id: number): Promise<ProjectDetail> => {
  const { data } = await http.get<ProjectDetail>(`/api/projects/${String(id)}`);
  return data;
};

export const createProject = async (req: { name: string }): Promise<ProjectDetail> => {
  const { data } = await http.post<ProjectDetail>('/api/projects', req);
  return data;
};

export const renameProject = async (id: number, name: string): Promise<ProjectDetail> => {
  const { data } = await http.put<ProjectDetail>(`/api/projects/${String(id)}`, { name });
  return data;
};

/**
 * DELETE /api/projects/{id}. **ADMIN only.**
 *
 * **409 on RESTRICT block** — the project has child regions/devices
 * still attached. Surface the message verbatim.
 */
export const deleteProject = async (id: number): Promise<void> => {
  await http.delete(`/api/projects/${String(id)}`);
};
