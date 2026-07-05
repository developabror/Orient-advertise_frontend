// Content resource — typed wrappers around /api/content and
// /api/content/{id}.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves. ADVERTISER scoping is enforced server-side (the advertiser
// only sees content files explicitly linked to them via
// /api/users/{userId}/content) — no FE-side filtering needed.

import { http } from '../http';
import { parsePage, type Page, type Pageable } from './_types';

/** Backend `ContentFile.Status` enum verbatim. */
export type ContentFileStatus =
  | 'UPLOADED'
  | 'TRANSCODING'
  | 'READY'
  | 'FAILED'
  | 'INVALID';

export interface ContentListFilters {
  readonly projectId?: number;
  readonly status?: ContentFileStatus;
  readonly name?: string;
}

/**
 * Mirror of the backend `ContentFileSummary` row shape returned by
 * GET /api/content. `invalidReason` is non-null only for `INVALID`
 * rows; `durationSeconds` is null until transcoding completes.
 *
 * `projectId` is **nullable** — orphan content uploaded without a
 * project binding (POST /api/content/upload?projectId=0) returns null
 * here until a follow-up `PATCH /api/content/{id}/project` attaches it.
 * The OpenAPI doesn't mark this as nullable today; the wire reality
 * does.
 */
export interface ContentFileSummary {
  readonly id: number;
  readonly projectId: number | null;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number | null;
  readonly status: ContentFileStatus;
  readonly invalidReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Presigned URL for the row's thumbnail. Non-null only for READY rows
   * with a generated thumbnail; absent or null otherwise. Treated as a
   * short-lived URL — the wire shape pairs it with `thumbnailExpiresAt`.
   */
  readonly thumbnailUrl: string | null;
  /**
   * ISO-8601 instant after which `thumbnailUrl` stops working. Useful
   * for long-lived caches; for an in-memory list view the 15-min TTL is
   * comfortably longer than the surface that holds the URL, so the card
   * doesn't bother tracking expiry.
   */
  readonly thumbnailExpiresAt: string | null;
  /**
   * Username of the uploader (`content_file.uploaded_by`); null for
   * legacy/system rows. **Wire field name is `uploadedByUsername`** (not
   * the BE entity getter `uploadedBy`).
   */
  readonly uploadedByUsername: string | null;
  /**
   * True iff the current caller may delete/manage this row. Computed
   * server-side (ADMIN: always; operator: owned only). FE gates the
   * delete button on this — no role re-derivation.
   */
  readonly canManage: boolean;
}

/**
 * GET /api/content/{id} response — extends the summary with the
 * underlying object-store keys, content-checksum, and the soft-delete
 * trail. `processedStorageKey` is non-null once transcoding finishes.
 */
export interface ContentFileDetail extends ContentFileSummary {
  readonly storageKey: string;
  readonly processedStorageKey: string | null;
  readonly checksum: string | null;
  readonly deletedAt: string | null;
}

const isContentFileStatus = (v: unknown): v is ContentFileStatus =>
  v === 'UPLOADED' ||
  v === 'TRANSCODING' ||
  v === 'READY' ||
  v === 'FAILED' ||
  v === 'INVALID';

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error('expected number or null');
};

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new Error('expected string or null');
};

const parseContentFileSummary = (raw: unknown): ContentFileSummary => {
  if (typeof raw !== 'object' || raw === null) throw new Error('row is not an object');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'number' || !Number.isFinite(v.id)) throw new Error('id');
  const projectId = numOrNull(v.projectId);
  if (typeof v.name !== 'string') throw new Error('name');
  if (typeof v.contentType !== 'string') throw new Error('contentType');
  if (typeof v.sizeBytes !== 'number' || !Number.isFinite(v.sizeBytes)) throw new Error('sizeBytes');
  if (!isContentFileStatus(v.status)) throw new Error('status');
  if (typeof v.createdAt !== 'string') throw new Error('createdAt');
  if (typeof v.updatedAt !== 'string') throw new Error('updatedAt');
  return {
    id: v.id,
    projectId,
    name: v.name,
    contentType: v.contentType,
    sizeBytes: v.sizeBytes,
    durationSeconds: numOrNull(v.durationSeconds),
    status: v.status,
    invalidReason: strOrNull(v.invalidReason),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    thumbnailUrl: strOrNull(v.thumbnailUrl),
    thumbnailExpiresAt: strOrNull(v.thumbnailExpiresAt),
    // Wire-name pin: read `uploadedByUsername`, NOT `uploadedBy` (the BE
    // entity getter name) — the latter would silently parse null.
    uploadedByUsername: strOrNull(v.uploadedByUsername),
    // Fail-closed: default to false when absent so we never show a delete
    // button we're unsure about during a rollout.
    canManage: typeof v.canManage === 'boolean' ? v.canManage : false,
  };
};

const dropUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * GET /api/content — paged + filtered list of content files.
 *
 * **ADVERTISER scoping is server-side.** When called by an advertiser,
 * the backend transparently filters to content files linked to that
 * user via /api/users/{userId}/content. The FE doesn't need to scope
 * the query — just call the endpoint and let the backend handle it.
 */
export const listContent = async (
  filters: ContentListFilters,
  pageable: Pageable,
): Promise<Page<ContentFileSummary>> => {
  const params = dropUndefined({
    projectId: filters.projectId,
    status: filters.status,
    name: filters.name,
    page: pageable.page,
    size: pageable.size,
    sort: pageable.sort,
  });
  const { data } = await http.get<unknown>('/api/content', { params });
  return parsePage(data, parseContentFileSummary);
};

/**
 * GET /api/content/{id}.
 *
 * **ADVERTISER without grant → 403.** The advertiser can only see
 * content files explicitly linked to them via the
 * /api/users/{userId}/content access control. The 403 is surfaced via
 * the global response interceptor's "You don't have access" toast —
 * the resource doesn't suppress it.
 */
export const getContent = async (id: number): Promise<ContentFileDetail> => {
  const { data } = await http.get<ContentFileDetail>(`/api/content/${String(id)}`);
  return data;
};

/**
 * DELETE /api/content/{id} — soft delete.
 *
 * **ADMIN/OPERATOR only.** Calling as a lower-privilege role surfaces
 * as 403 via the interceptor toast.
 *
 * **409 if the content is in use by playlists.** The backend response
 * body's `message` field carries the count and names of the blocking
 * playlists ("In use by 3 playlists: Spring Promo, Summer Push, …").
 * Surface that message to the user **verbatim** — the operator needs
 * to know exactly what's blocking the delete to decide whether to
 * remove the content from those playlists first.
 *
 * ```ts
 * try { await softDeleteContent(id); }
 * catch (err) {
 *   if (axios.isAxiosError(err) && err.response?.status === 409) {
 *     showInlineError(err.response.data.message); // verbatim
 *   } else throw err;
 * }
 * ```
 */
export const softDeleteContent = async (id: number): Promise<void> => {
  await http.delete(`/api/content/${String(id)}`);
};

/**
 * PATCH /api/content/{id}/project — bind (or rebind) an orphan content
 * file to a project.
 *
 * Used after `POST /api/content/upload` was called without a `projectId`
 * (orphan upload). The response is the updated `ContentFileDetail` with
 * `projectId` populated.
 *
 * Failure modes (axios throws; global interceptor does NOT toast 4xx):
 *  - **400** — `projectId` is malformed.
 *  - **404** — content id unknown / soft-deleted, or project id unknown.
 *  - **403** — caller lacks ADMIN/OPERATOR.
 */
export const setContentProject = async (
  id: number,
  projectId: number,
): Promise<ContentFileDetail> => {
  const { data } = await http.patch<ContentFileDetail>(
    `/api/content/${String(id)}/project`,
    { projectId },
  );
  return data;
};

/** Mirror of the backend `StreamUrlResponse` envelope. */
export interface StreamUrlResponse {
  /** Time-limited signed URL the player can `<video src>` directly. */
  readonly url: string;
  /**
   * ISO-8601 instant after which `url` stops working — the FE should
   * refetch (or kick the player into "expired" state) shortly before
   * this time.
   */
  readonly expiresAt: string;
  /**
   * MIME type of the underlying media (e.g. `video/mp4`,
   * `video/webm`). Forward verbatim to the `<source type="…">` hint;
   * Safari relies on this attribute to pick a decoder rather than
   * sniffing the bytestream, so a missing or fabricated type causes
   * the player to refuse playback.
   */
  readonly contentType: string;
}

/**
 * GET /api/content/{id}/stream-url — issue a short-lived signed URL the
 * operator's browser can stream directly from object storage. Useful
 * for the in-page preview tile on the content-detail page.
 *
 * The signed URL bypasses the API gateway, so respect `expiresAt`
 * locally — the global response interceptor won't see expirations.
 *
 * Failure modes:
 *  - **403** — caller lacks the read scope (ADVERTISER without grant,
 *    or any user against soft-deleted content).
 *  - **409** — content is not in `READY` status; preview is only
 *    meaningful once transcoding has completed. Surface inline.
 */
export const getContentStreamUrl = async (
  id: number,
): Promise<StreamUrlResponse> => {
  const { data } = await http.get<StreamUrlResponse>(
    `/api/content/${String(id)}/stream-url`,
  );
  return data;
};
