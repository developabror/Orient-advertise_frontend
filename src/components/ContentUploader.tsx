import { useEffect, useReducer, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { http } from '@api/http';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import type { UploadResponse } from '@api/resources/contentUpload';
import { useWsEvent } from '@hooks/useWsEvent';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

// Matches the backend upload cap. Pre-checking here spares the user a doomed
// multi-MB upload that the server would reject with 413.
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_MB_LABEL = '50 MB';
const POLL_MS = 5_000;
// Give up polling after this long stuck in TRANSCODING. A dead fire-and-forget
// transcode would otherwise leave the bar frozen at 100% "Processing" forever.
const MAX_POLL_MS = 10 * 60 * 1000;

type UploadStatus = 'rejected' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';

interface UploadEntry {
  readonly localId: string;
  readonly filename: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly progressPct: number;
  readonly contentId: string | null;
  readonly error: string | null;
}

type Action =
  | { type: 'add'; entry: UploadEntry }
  | { type: 'update'; localId: string; patch: Partial<UploadEntry> };

const reducer = (state: readonly UploadEntry[], action: Action): readonly UploadEntry[] => {
  if (action.type === 'add') return [...state, action.entry];
  return state.map((e) => (e.localId === action.localId ? { ...e, ...action.patch } : e));
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex] ?? 'B'}`;
};

const validateFile = (
  file: File,
  t: TFunction,
): { ok: true } | { ok: false; error: string } => {
  if (!file.type.startsWith('video/')) {
    return { ok: false, error: t('contentUploader.errorOnlyVideo') };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: t('contentUploader.errorTooLargeClient', { limit: MAX_MB_LABEL }) };
  }
  return { ok: true };
};

// Runtime guard for {@link UploadResponse}. We only assert the field that
// drives the UI flow (`fileId`, used to poll detail) — the resource's
// stricter type is the source of truth for the wire shape.
const isUploadResp = (v: unknown): v is UploadResponse => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.fileId === 'number' && Number.isFinite(r.fileId);
};

// Wire shape of GET /api/content/{id} (ContentFileDetail). Status is the
// backend `ContentFile.Status` enum — uppercase. `invalidReason` is the
// per-row failure copy; null/absent unless status === 'INVALID'.
type ContentStatus = 'UPLOADED' | 'TRANSCODING' | 'READY' | 'FAILED' | 'INVALID';

interface ContentDetail {
  readonly id: number;
  readonly status: ContentStatus;
  readonly invalidReason?: string | null;
}

const isContentStatus = (v: unknown): v is ContentStatus =>
  v === 'UPLOADED' ||
  v === 'TRANSCODING' ||
  v === 'READY' ||
  v === 'FAILED' ||
  v === 'INVALID';

const isContentDetail = (v: unknown): v is ContentDetail => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'number' && Number.isFinite(r.id) && isContentStatus(r.status)
  );
};

const statusLabel = (t: TFunction, status: UploadStatus): string =>
  t(`contentUploader.status_${status}`);

interface ContentUploaderProps {
  /**
   * Fires when a polling cycle observes an upload transition into a
   * terminal status (READY, FAILED, or INVALID). The Content page uses
   * this to refetch the listing so a freshly-transcoded upload appears
   * in the grid with its new thumbnail and becomes click-to-preview
   * without a manual reload. Best-effort — listeners must tolerate
   * being called more than once per upload.
   */
  onItemReady?: () => void;
}

export const ContentUploader = ({ onItemReady }: ContentUploaderProps = {}) => {
  const { t } = useTranslation();
  const [entries, dispatch] = useReducer(reducer, [] as readonly UploadEntry[]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controllersRef = useRef(new Map<string, AbortController>());
  const timersRef = useRef(new Map<string, number>());
  // Hold the latest callback in a ref so the polling closure always sees
  // the current handler, without retriggering subscriptions on every
  // re-render of the parent.
  const onItemReadyRef = useRef(onItemReady);
  useEffect(() => {
    onItemReadyRef.current = onItemReady;
  }, [onItemReady]);

  const stopPolling = (localId: string): void => {
    const t = timersRef.current.get(localId);
    if (t !== undefined) {
      window.clearInterval(t);
      timersRef.current.delete(localId);
    }
  };

  const startPolling = (localId: string, contentId: string): void => {
    const deadline = Date.now() + MAX_POLL_MS;
    const tick = async (): Promise<void> => {
      try {
        const { data } = await http.get<unknown>(`/api/content/${contentId}`, {
          _suppressErrorToast: true,
        });
        if (isContentDetail(data)) {
          if (data.status === 'READY') {
            dispatch({ type: 'update', localId, patch: { status: 'ready', progressPct: 100 } });
            stopPolling(localId);
            onItemReadyRef.current?.();
            return;
          }
          if (data.status === 'FAILED' || data.status === 'INVALID') {
            dispatch({
              type: 'update',
              localId,
              patch: {
                status: 'failed',
                error: data.invalidReason ?? t('contentUploader.errorProcessingFailed'),
              },
            });
            stopPolling(localId);
            onItemReadyRef.current?.();
            return;
          }
        }
      } catch {
        // Best-effort polling; fall through to the deadline check and retry.
      }
      // Deadline fallback. WS (CONTENT_STATUS_CHANGE) is the fast path; this
      // poll covers a disconnected socket. After MAX_POLL_MS still not terminal,
      // stop and surface a timeout rather than spinning at 100% forever.
      if (Date.now() >= deadline) {
        dispatch({
          type: 'update',
          localId,
          patch: { status: 'failed', error: t('contentUploader.errorProcessingTimedOut') },
        });
        stopPolling(localId);
        onItemReadyRef.current?.();
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    timersRef.current.set(localId, id);
  };

  const startUpload = async (localId: string, file: File): Promise<void> => {
    const controller = new AbortController();
    controllersRef.current.set(localId, controller);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // POST /api/content/upload — multipart `file` body, `projectId` and
      // `urgent` as optional query params. Omitting `projectId` produces an
      // orphan upload that the operator rebinds later via
      // PATCH /api/content/{id}/project — this UI does not yet expose a
      // project picker, so we always upload as orphan from here.
      const { data } = await http.post<unknown>('/api/content/upload', formData, {
        signal: controller.signal,
        _suppressErrorToast: true,
        onUploadProgress: (e) => {
          const total = e.total ?? file.size;
          if (total > 0) {
            const pct = (e.loaded / total) * 100;
            // Cap at 99% so the bar doesn't read 100% before the server
            // confirms the upload completed.
            dispatch({
              type: 'update',
              localId,
              patch: { progressPct: Math.min(99, pct) },
            });
          }
        },
      });
      if (controller.signal.aborted) return;
      if (!isUploadResp(data)) {
        dispatch({
          type: 'update',
          localId,
          patch: { status: 'failed', error: t('contentUploader.errorUnexpectedResponse') },
        });
        return;
      }
      const contentId = String(data.fileId);
      dispatch({
        type: 'update',
        localId,
        patch: {
          status: 'processing',
          progressPct: 100,
          contentId,
        },
      });
      startPolling(localId, contentId);
    } catch (err: unknown) {
      if (axios.isCancel(err) || controller.signal.aborted) return;
      // The entry renders this error inline, so claim it to stop the global
      // modal double-popping for an upload 4xx.
      markErrorHandled(err);
      // 413 = server rejected the size. The client-side pre-check should catch
      // most cases, but the server is the source of truth (a proxy limit may be
      // lower), so surface a clear size message; otherwise prefer the backend's
      // own reason over a bare "Upload failed."
      const tooLarge = axios.isAxiosError(err) && err.response?.status === 413;
      dispatch({
        type: 'update',
        localId,
        patch: {
          status: 'failed',
          error: tooLarge
            ? t('contentUploader.errorTooLargeServer', { limit: MAX_MB_LABEL })
            : (extractApiMessage(err) ?? t('contentUploader.errorUploadFailed')),
        },
      });
    } finally {
      controllersRef.current.delete(localId);
    }
  };

  const handleFiles = (files: FileList): void => {
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i);
      if (!file) continue;
      const localId = `${String(Date.now())}-${String(i)}-${file.name}`;
      const validation = validateFile(file, t);
      const entry: UploadEntry = {
        localId,
        filename: file.name,
        size: file.size,
        status: validation.ok ? 'uploading' : 'rejected',
        progressPct: 0,
        contentId: null,
        error: validation.ok ? null : validation.error,
      };
      dispatch({ type: 'add', entry });
      if (validation.ok) void startUpload(localId, file);
    }
  };

  const cancelUpload = async (entry: UploadEntry): Promise<void> => {
    controllersRef.current.get(entry.localId)?.abort();
    controllersRef.current.delete(entry.localId);
    stopPolling(entry.localId);
    dispatch({ type: 'update', localId: entry.localId, patch: { status: 'cancelled' } });

    // Best-effort server cleanup — only meaningful if the upload had reached
    // the server far enough to receive an ID.
    if (entry.contentId !== null) {
      try {
        await http.delete(`/api/content/${entry.contentId}`, {
          _suppressErrorToast: true,
        });
      } catch (err) {
        // Best-effort cleanup: already gone server-side, or unreachable — either
        // way nothing more to do. Claim the error so a cleanup 4xx (e.g. a 404
        // "already deleted") doesn't pop the global modal for an action the user
        // can't act on; the upload is already marked cancelled.
        markErrorHandled(err);
      }
    }
  };

  // On unmount, abort everything. Uploads do not survive component unmount —
  // for cross-page upload persistence, lift this state into a provider.
  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = timersRef.current;
    return () => {
      controllers.forEach((c) => {
        c.abort();
      });
      timers.forEach((t) => {
        window.clearInterval(t);
      });
      controllers.clear();
      timers.clear();
    };
  }, []);

  // Live transcoding status over /ws/dashboard — the fast path that replaces
  // the 5s poll lag (polling stays as the fallback when the socket is down).
  // The event's numeric contentId is matched to our string-keyed entry; only
  // in-flight entries are touched so a late event can't resurrect a cancelled
  // or already-terminal upload.
  useWsEvent('CONTENT_STATUS_CHANGE', (event) => {
    const contentId = String(event.contentId);
    const entry = entries.find((e) => e.contentId === contentId);
    if (entry === undefined) return;
    if (entry.status !== 'uploading' && entry.status !== 'processing') return;
    if (event.status === 'READY') {
      dispatch({ type: 'update', localId: entry.localId, patch: { status: 'ready', progressPct: 100 } });
      stopPolling(entry.localId);
      onItemReadyRef.current?.();
    } else if (event.status === 'FAILED' || event.status === 'INVALID') {
      dispatch({
        type: 'update',
        localId: entry.localId,
        patch: { status: 'failed', error: event.invalidReason ?? t('contentUploader.errorProcessingFailed') },
      });
      stopPolling(entry.localId);
      onItemReadyRef.current?.();
    } else if (typeof event.progressPct === 'number') {
      // TRANSCODING with a fine-grained percentage — advance the bar, stay
      // in 'processing'.
      dispatch({
        type: 'update',
        localId: entry.localId,
        patch: { status: 'processing', progressPct: Math.min(99, Math.max(0, event.progressPct)) },
      });
    }
  });

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };
  const onDragLeave = (): void => {
    setDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };
  const onPickerChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files !== null && files.length > 0) handleFiles(files);
    e.target.value = '';
  };

  return (
    <div className="oa-uploader">
      <div
        className={`oa-uploader__drop${dragOver ? ' oa-uploader__drop--active' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p className="oa-uploader__hint">
          {t('contentUploader.dropHint', { limit: MAX_MB_LABEL })}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          {t('contentUploader.chooseFiles')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*"
          className="oa-uploader__file-input"
          onChange={onPickerChange}
        />
      </div>

      {entries.length > 0 && (
        <ul className="oa-uploader__list">
          {entries.map((entry) => {
            const showCancel = entry.status === 'uploading' || entry.status === 'processing';
            return (
              <li key={entry.localId} className="oa-uploader__item" data-status={entry.status}>
                <div className="oa-uploader__item-head">
                  <span className="oa-uploader__item-name" title={entry.filename}>
                    {entry.filename}
                  </span>
                  <span className="oa-uploader__item-size">{formatBytes(entry.size)}</span>
                </div>

                {entry.status === 'uploading' && (
                  <div
                    className="oa-uploader__progress"
                    role="progressbar"
                    aria-valuenow={Math.round(entry.progressPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${String(Math.round(entry.progressPct))}%`}
                  >
                    <span
                      className="oa-uploader__progress-fill"
                      style={{ width: `${String(entry.progressPct)}%` }}
                    />
                  </div>
                )}

                {entry.status === 'processing' && (
                  <div className="oa-uploader__processing">
                    {entry.progressPct < 100 ? (
                      // A CONTENT_STATUS_CHANGE event reported a concrete
                      // transcode percentage — show a determinate bar instead
                      // of the indeterminate spinner.
                      <div
                        className="oa-uploader__progress"
                        role="progressbar"
                        aria-label={t('contentUploader.transcodingProgress')}
                        aria-valuenow={Math.round(entry.progressPct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuetext={`${String(Math.round(entry.progressPct))}%`}
                      >
                        <span
                          className="oa-uploader__progress-fill"
                          style={{ width: `${String(entry.progressPct)}%` }}
                        />
                      </div>
                    ) : (
                      <Spinner size="sm" label={t('contentUploader.status_processing')} />
                    )}
                    <span>{t('contentUploader.transcodingOnServer')}</span>
                  </div>
                )}

                <div className="oa-uploader__item-foot">
                  <span className="oa-uploader__item-status">{statusLabel(t, entry.status)}</span>
                  {entry.error !== null && (
                    <span className="oa-uploader__item-error" role="alert" title={entry.error}>
                      {entry.error}
                    </span>
                  )}
                  {showCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void cancelUpload(entry);
                      }}
                    >
                      {t('contentUploader.cancel')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
