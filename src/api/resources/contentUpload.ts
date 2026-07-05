// Content upload resource — typed wrapper around POST /api/content/upload.
//
// This is the **modern upload path** (the legacy /api/files endpoints in
// resources/files.ts will be retired once all callers migrate). It runs
// the file through the backend's VideoUploadValidator pipeline; this
// resource mirrors that validation client-side so the user sees a
// rejection instantly rather than after a multi-MB upload round-trip.
//
// Authorization is handled by the global request interceptor in
// `../http.ts`; resource layers MUST NOT set the Authorization header
// themselves.

import { http } from '../http';

/**
 * Per-device fan-out result for an urgent upload. Mirrors the backend
 * `WebSocketPushResult` schema verbatim — three counters that always
 * sum to the number of currently-assigned devices for the content's
 * project (or to zero on a non-urgent upload, in which case the entire
 * envelope is null).
 *
 *   - `sent` — devices that ACK'd the push frame.
 *   - `skipped` — devices the server didn't push to (e.g. UNREGISTERED,
 *     not currently subscribed to the content channel).
 *   - `failed` — devices the server tried to push to but the WS write
 *     itself errored (broken pipe, timeout, etc.).
 *
 * **This is device-delivery fan-out, NOT the operator's upload/transcoding
 * progress.** It answers "how many screens were notified", not "is my file
 * uploaded/ready". Upload progress is the axios byte-progress bar in
 * ContentUploader; transcoding readiness arrives via the `CONTENT_STATUS_CHANGE`
 * WS event / GET /api/content/{id} poll. Surface `sent` as "devices notified",
 * never as an upload percentage.
 */
export interface WebSocketPushResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Mirror of the backend `UploadResponse` envelope returned by
 * `POST /api/content/upload`. The OpenAPI documents an older
 * `{objectName, size}` shape that's no longer emitted; the live
 * backend returns this richer envelope. Source of truth for FE
 * consumers is this file, not the OpenAPI.
 *
 * Field semantics:
 *  - `fileId` — newly created `ContentFile.id`. Use this to drive
 *    detail polling at `GET /api/content/{fileId}`.
 *  - `status` — initial `ContentFile.Status` (typically `UPLOADED` or
 *    `TRANSCODING`). The upload itself is accepted before
 *    transcoding completes.
 *  - `storageKey` — object-store key of the raw upload (e.g.
 *    `raw/<uuid>_filename.mp4`).
 *  - `urgent` — echoes the request's `urgent` query param.
 *  - `projectId` — bound project, or `null` for orphan uploads
 *    (`projectId` omitted at upload time). Attach later via
 *    `PATCH /api/content/{id}/project`.
 *  - `webSocketPush` — fan-out counts for an urgent upload (see
 *    {@link WebSocketPushResult}). `null` for non-urgent uploads or
 *    when there were no eligible devices.
 *  - `message` — operator-facing copy explaining the post-upload
 *    state (e.g. orphan-content reminder, transcoding-in-progress
 *    notice).
 */
export interface UploadResponse {
  readonly fileId: number;
  readonly status: string;
  readonly storageKey: string;
  readonly urgent: boolean;
  readonly projectId: number | null;
  readonly webSocketPush: WebSocketPushResult | null;
  readonly message: string;
}

/**
 * Runtime guard for {@link WebSocketPushResult}. Use at the consumer
 * boundary before reading individual counts — the resource layer
 * itself doesn't validate the wire.
 */
export const isWebSocketPushResult = (v: unknown): v is WebSocketPushResult => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.sent === 'number' &&
    Number.isFinite(r.sent) &&
    typeof r.skipped === 'number' &&
    Number.isFinite(r.skipped) &&
    typeof r.failed === 'number' &&
    Number.isFinite(r.failed)
  );
};

/**
 * Allow-list of extensions the backend's VideoUploadValidator accepts.
 * **Keep in lockstep with the backend list** — divergence here means
 * either a) we reject files the server would have accepted (bad UX), or
 * b) we send files the server will reject (defeats the purpose of
 * client-side validation).
 */
const VIDEO_EXTENSIONS: readonly string[] = [
  'mp4',
  'mov',
  'm4v',
  'mkv',
  'webm',
  'avi',
  'mpeg',
  'mpg',
  'wmv',
];

/**
 * Reasons {@link uploadContent} rejects a file before sending. Surfaced
 * via {@link InvalidVideoFileError.reason} so the calling form can
 * render targeted inline messaging without parsing the message string.
 */
export type InvalidVideoFileReason = 'EMPTY' | 'EXTENSION' | 'MIME';

/**
 * Thrown by {@link uploadContent} when client-side validation rejects
 * the file BEFORE the upload starts. `reason` is the discriminator the
 * caller branches on; `message` is the user-facing default copy.
 */
export class InvalidVideoFileError extends Error {
  readonly code = 'INVALID_VIDEO_FILE' as const;
  readonly reason: InvalidVideoFileReason;

  constructor(message: string, reason: InvalidVideoFileReason) {
    super(message);
    this.name = 'InvalidVideoFileError';
    this.reason = reason;
  }
}

const extensionOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
};

/**
 * Mirrors the backend `VideoUploadValidator`:
 *   1. file.size must be > 0
 *   2. extension must be in {@link VIDEO_EXTENSIONS} (case-insensitive)
 *   3. file.type must start with `'video/'` (covers any container
 *      variant: video/mp4, video/x-matroska, video/quicktime, …)
 *
 * Throws on the first failure rather than aggregating — a video that's
 * empty AND has the wrong MIME is presumably the wrong file entirely;
 * one error message keeps the form feedback simple.
 */
const validateVideoFile = (file: File): void => {
  if (file.size <= 0) {
    throw new InvalidVideoFileError('Video file is empty.', 'EMPTY');
  }
  const ext = extensionOf(file.name);
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    throw new InvalidVideoFileError(
      `Unsupported file extension. Use one of: ${VIDEO_EXTENSIONS.join(', ')}.`,
      'EXTENSION',
    );
  }
  if (!file.type.startsWith('video/')) {
    throw new InvalidVideoFileError(
      'File does not appear to be a video (unexpected MIME type).',
      'MIME',
    );
  }
};

/**
 * POST /api/content/upload — multipart/form-data carrying ONLY the
 * binary; `projectId` (optional) and `urgent` (optional) are **query
 * parameters** per the spec, not form fields.
 *
 * Wire shape:
 *   - URL: `/api/content/upload[?projectId=<id>][&urgent=true]`
 *   - Body: `multipart/form-data` with one field `file` = the binary.
 *   - `projectId` is only attached when `req.projectId` is a number;
 *     omit it for orphan uploads and rebind later via
 *     `PATCH /api/content/{id}/project`.
 *   - `urgent` is only attached when `req.urgent === true` (omitted for
 *     false / undefined so the wire is minimal and the backend's
 *     default kicks in).
 *
 * Returns `UploadResponse` on 202 Accepted. axios's default
 * `validateStatus` covers 2xx, so the global response interceptor's
 * 4xx/5xx toasts still apply to actual failures.
 *
 * **Client-side validation** mirrors the backend `VideoUploadValidator`
 * and runs synchronously BEFORE the network call — see
 * {@link InvalidVideoFileError}. A rejection here spares the user a
 * round-trip on a file the server would have rejected anyway.
 *
 * `onProgress(loaded, total)` is invoked on each axios upload-progress
 * tick. `total` falls back to `file.size` when axios reports it as
 * undefined (some proxies strip the request Content-Length, in which
 * case the upload event has no total).
 */
export const uploadContent = async (
  req: { projectId?: number; file: File; urgent?: boolean },
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadResponse> => {
  validateVideoFile(req.file);

  const form = new FormData();
  form.append('file', req.file);

  const params: Record<string, string> = {};
  if (typeof req.projectId === 'number' && Number.isFinite(req.projectId)) {
    params.projectId = String(req.projectId);
  }
  if (req.urgent === true) params.urgent = 'true';

  const { data } = await http.post<UploadResponse>('/api/content/upload', form, {
    params,
    // Axios infers `multipart/form-data` with the proper boundary when
    // the body is a FormData instance — don't set Content-Type manually.
    onUploadProgress: (event) => {
      if (onProgress === undefined) return;
      const total = typeof event.total === 'number' && event.total > 0 ? event.total : req.file.size;
      onProgress(event.loaded, total);
    },
  });
  return data;
};
