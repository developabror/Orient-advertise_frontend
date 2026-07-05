// Files resource — typed wrappers around the legacy /api/files/* endpoints.
//
// **Status: legacy.** The modern upload path is /api/content/upload (see
// resources/content.ts when it ships). These raw-file endpoints are
// still in the OpenAPI spec for now; this resource exists so the
// remaining callers don't reach for `http.get` directly. Plan to delete
// this file once the last caller migrates to the content endpoints.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves. Endpoints in this file are scoped on the backend:
//   - upload, download, presigned-url: any authenticated user
//   - delete: ADMIN or OPERATOR
//   - status: ADMIN

import axios from 'axios';
import { http } from '../http';

export interface UploadResponse {
  readonly objectName: string;
  readonly size: number;
}

export interface PresignedUrlResponse {
  readonly objectName: string;
  readonly url: string;
}

/**
 * Backend storage health. `'DEGRADED'` covers both partial-MinIO-outage
 * (some operations OK, others rejected) and the case where the backend
 * returns 503 — see {@link getStorageStatus}.
 */
export type StorageStatus = 'UP' | 'DEGRADED';

const FILENAME_RE = /filename="([^"]+)"/;
const FALLBACK_FILENAME = 'download.bin';

const parseFilename = (headers: unknown): string => {
  if (typeof headers !== 'object' || headers === null) return FALLBACK_FILENAME;
  let raw: unknown = (headers as Record<string, unknown>)['content-disposition'];
  if (raw === undefined) {
    const get = (headers as { get?: unknown }).get;
    if (typeof get === 'function') {
      raw = (get as (k: string) => unknown).call(headers, 'content-disposition');
    }
  }
  if (typeof raw !== 'string') return FALLBACK_FILENAME;
  const match = FILENAME_RE.exec(raw);
  return match?.[1] ?? FALLBACK_FILENAME;
};

/**
 * POST /api/files — multipart upload under field name `'file'`.
 *
 * `onProgress(loaded, total)` is invoked on each axios upload-progress
 * tick when supplied. `total` falls back to `file.size` when the
 * underlying `ProgressEvent` reports it as undefined (some proxies
 * strip the Content-Length header on the request side, in which case
 * axios can't compute it from the response either).
 */
export const uploadFile = async (
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadResponse> => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<UploadResponse>('/api/files', form, {
    // Axios infers `multipart/form-data` with the proper boundary when
    // the body is a FormData instance — don't set Content-Type manually.
    onUploadProgress: (event) => {
      if (onProgress === undefined) return;
      const total = typeof event.total === 'number' && event.total > 0 ? event.total : file.size;
      onProgress(event.loaded, total);
    },
  });
  return data;
};

/**
 * GET /api/files/{objectName} — streams the raw object as a blob.
 *
 * `objectName` is URL-encoded into the path because MinIO object keys
 * frequently contain `/`, `.`, and other reserved characters. The
 * filename is parsed from `Content-Disposition`; falls back to
 * `'download.bin'` when the header is missing or malformed.
 */
export const downloadFile = async (
  objectName: string,
): Promise<{ readonly blob: Blob; readonly filename: string }> => {
  try {
    const response = await http.get<Blob>(
      `/api/files/${encodeURIComponent(objectName)}`,
      { responseType: 'blob' },
    );
    return {
      blob: response.data,
      filename: parseFilename(response.headers),
    };
  } catch (err) {
    // A missing object now returns a clean 404 (previously the backend leaked a
    // 500/empty body that surfaced as a confusing `download.bin`). Translate it
    // to a clear, caller-renderable message instead of a generic axios error.
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      throw new Error('File not found — it may have been deleted.');
    }
    throw err;
  }
};

/**
 * GET /api/files/{objectName}/presigned-url.
 *
 * Returns a signed URL the caller can hand to a `<video>`, `<img>`, or
 * `<a download>` without the user's session token leaking into the
 * page. Treat the URL as **time-bounded**; do not stash it in a
 * long-lived store.
 */
export const getPresignedUrl = async (objectName: string): Promise<PresignedUrlResponse> => {
  const { data } = await http.get<PresignedUrlResponse>(
    `/api/files/${encodeURIComponent(objectName)}/presigned-url`,
  );
  return data;
};

/**
 * DELETE /api/files/{objectName}. ADMIN/OPERATOR only — non-privileged
 * callers surface as 403 via the global response interceptor toast.
 */
export const deleteFile = async (objectName: string): Promise<void> => {
  await http.delete(`/api/files/${encodeURIComponent(objectName)}`);
};

/**
 * GET /api/files/status — storage health probe (ADMIN only).
 *
 * **503 collapses to `{ status: 'DEGRADED' }`.** When MinIO is in a
 * degraded state the backend returns 503; the global response
 * interceptor toasts that as "Service temporarily unavailable". This
 * resource ALSO catches the 503 and resolves with the DEGRADED status
 * so the admin status page can render the inline indicator without
 * having to inspect the axios error envelope. (The toast is the
 * surprise/notification surface; this resolved value is the data
 * surface — both are useful, neither is redundant.)
 *
 * For unknown body status strings (anything other than `'UP'`), this
 * function biases to `'DEGRADED'` rather than `'UP'` — better to
 * over-report a problem than mask it.
 */
export const getStorageStatus = async (): Promise<{ readonly status: StorageStatus }> => {
  try {
    const { data } = await http.get<{ status: string }>('/api/files/status');
    return { status: data.status === 'UP' ? 'UP' : 'DEGRADED' };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 503) {
      return { status: 'DEGRADED' };
    }
    throw err;
  }
};
