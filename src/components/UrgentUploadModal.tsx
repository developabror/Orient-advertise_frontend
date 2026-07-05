import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { http } from '@api/http';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import {
  isWebSocketPushResult,
  type WebSocketPushResult,
} from '@api/resources/contentUpload';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

// Same /api/content/upload endpoint and server cap as ContentUploader.
const MAX_BYTES = 50 * 1024 * 1024;

// Deliberately separate state machine from ContentUploader's reducer-based flow.
// The intent is structural: routine upload code paths should not branch on a
// flag — duplicating the small surface here keeps the urgent flow visibly and
// behaviorally distinct.
type UrgentState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'rejected'; readonly error: string }
  | { readonly kind: 'uploading'; readonly filename: string; readonly progressPct: number }
  | {
      readonly kind: 'success';
      readonly filename: string;
      readonly notifiedDevices: number;
    }
  | { readonly kind: 'failed'; readonly filename: string; readonly error: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const validateFile = (file: File, t: TFunction): string | null => {
  if (!file.type.startsWith('video/')) return t('urgentUploadModal.errorOnlyVideo');
  if (file.size > MAX_BYTES) return t('urgentUploadModal.errorTooLargeClient');
  return null;
};

// Wire shape of POST /api/content/upload?urgent=true. We only need
// `fileId` to confirm acceptance and the typed `webSocketPush.sent`
// counter to populate the success-copy fan-out figure.
interface UrgentResponse {
  readonly fileId: number;
  readonly webSocketPush: WebSocketPushResult | null;
}

const isUrgentResponse = (v: unknown): v is UrgentResponse => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.fileId !== 'number' || !Number.isFinite(r.fileId)) return false;
  // `webSocketPush` is null for urgent uploads with no eligible devices,
  // and a fully-formed counter triple otherwise. Anything else is
  // wire-shape drift — reject so the success-copy can't lie.
  if (r.webSocketPush !== null && !isWebSocketPushResult(r.webSocketPush)) return false;
  return true;
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

export const UrgentUploadModal = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const [state, setState] = useState<UrgentState>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // When the modal closes, abort any in-flight upload and reset state so the
  // next time it opens it's pristine. No carry-over from previous sessions.
  useEffect(() => {
    if (!isOpen) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setState({ kind: 'idle' });
      setDragOver(false);
    }
  }, [isOpen]);

  const startUpload = async (file: File): Promise<void> => {
    const error = validateFile(file, t);
    if (error !== null) {
      setState({ kind: 'rejected', error });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({ kind: 'uploading', filename: file.name, progressPct: 0 });

    const formData = new FormData();
    formData.append('file', file);

    try {
      // POST /api/content/upload — multipart `file` body. `urgent=true`
      // triggers the immediate-push path. `projectId` is intentionally
      // omitted (orphan upload); operators rebind later via
      // PATCH /api/content/{id}/project.
      const { data } = await http.post<unknown>('/api/content/upload', formData, {
        params: { urgent: true },
        signal: controller.signal,
        _suppressErrorToast: true,
        onUploadProgress: (e) => {
          const total = e.total ?? file.size;
          if (total > 0) {
            const pct = (e.loaded / total) * 100;
            setState({
              kind: 'uploading',
              filename: file.name,
              progressPct: Math.min(99, pct),
            });
          }
        },
      });
      if (controller.signal.aborted) return;
      if (!isUrgentResponse(data)) {
        setState({
          kind: 'failed',
          filename: file.name,
          error: t('urgentUploadModal.errorUnexpectedResponse'),
        });
        return;
      }
      // `sent` is the only fan-out figure the success copy quotes. The
      // server treats `null` webSocketPush as "no eligible devices" —
      // surface that as 0 rather than fabricating a non-zero count.
      const sent = data.webSocketPush?.sent ?? 0;
      setState({
        kind: 'success',
        filename: file.name,
        notifiedDevices: sent,
      });
    } catch (err: unknown) {
      if (axios.isCancel(err) || controller.signal.aborted) return;
      // This modal renders the error inline, so claim it to stop the global
      // modal double-popping for an upload 4xx.
      markErrorHandled(err);
      // Same /api/content/upload endpoint + server cap as ContentUploader: a
      // 413 (e.g. a proxy limit below our 50 MB pre-check) gets a clear size
      // message; otherwise prefer the backend's own reason over "Upload failed."
      const tooLarge = axios.isAxiosError(err) && err.response?.status === 413;
      setState({
        kind: 'failed',
        filename: file.name,
        error: tooLarge
          ? t('urgentUploadModal.errorTooLargeServer')
          : (extractApiMessage(err) ?? t('urgentUploadModal.errorUploadFailed')),
      });
    }
  };

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
    const file = e.dataTransfer.files.item(0);
    if (file !== null) void startUpload(file);
  };
  const onPickerChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.item(0) ?? null;
    if (file !== null) void startUpload(file);
    e.target.value = '';
  };

  const isUploading = state.kind === 'uploading';

  // While an upload is running, suppress every close path (X / Esc / backdrop)
  // so the user can't accidentally orphan the upload mid-flight.
  const handleClose = (): void => {
    if (isUploading) return;
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      variant="urgent"
      closeOnBackdrop={!isUploading}
      title={
        <span className="oa-urgent__title">
          <span className="oa-urgent__icon" aria-hidden="true">
            ⚠
          </span>
          {t('urgentUploadModal.title')}
        </span>
      }
    >
      <div className="oa-urgent">
        {state.kind === 'success' ? (
          <div className="oa-urgent__success">
            <p className="oa-urgent__success-headline">
              ✓ {t('urgentUploadModal.successHeadline', { count: state.notifiedDevices })}
            </p>
            <p className="oa-urgent__success-note">
              <Trans
                i18nKey="urgentUploadModal.successNote"
                values={{ filename: state.filename }}
                components={{ strong: <strong /> }}
              />
            </p>
            <div className="oa-urgent__success-actions">
              <Button variant="primary" onClick={onClose}>
                {t('urgentUploadModal.close')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="oa-urgent__warning" role="note">
              <span className="oa-urgent__icon" aria-hidden="true">
                ⚠
              </span>
              <span>
                <Trans
                  i18nKey="urgentUploadModal.warning"
                  components={{ strong: <strong /> }}
                />
              </span>
            </div>

            <div
              className={`oa-urgent__drop${dragOver ? ' oa-urgent__drop--active' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <p className="oa-urgent__drop-hint">{t('urgentUploadModal.dropHint')}</p>
              <Button
                variant="urgent"
                onClick={() => {
                  inputRef.current?.click();
                }}
                disabled={isUploading}
              >
                {t('urgentUploadModal.chooseVideo')}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="oa-uploader__file-input"
                onChange={onPickerChange}
              />
            </div>

            {state.kind === 'rejected' && (
              <p className="oa-urgent__error" role="alert">
                {state.error}
              </p>
            )}

            {state.kind === 'uploading' && (
              <div className="oa-urgent__upload">
                <div className="oa-urgent__upload-head">
                  <span className="oa-urgent__upload-name" title={state.filename}>
                    {state.filename}
                  </span>
                  <span className="oa-urgent__upload-pct">
                    {String(Math.round(state.progressPct))}%
                  </span>
                </div>
                <div
                  className="oa-urgent__progress"
                  role="progressbar"
                  aria-label={t('urgentUploadModal.uploadProgress')}
                  aria-valuenow={Math.round(state.progressPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    className="oa-urgent__progress-fill"
                    style={{ width: `${String(state.progressPct)}%` }}
                  />
                </div>
              </div>
            )}

            {state.kind === 'failed' && (
              <p className="oa-urgent__error" role="alert">
                {state.filename} ({formatBytes(0)}): {state.error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
