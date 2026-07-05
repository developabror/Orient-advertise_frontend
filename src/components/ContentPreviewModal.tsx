import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Modal } from './ui/Modal';
import { Spinner } from './ui/Spinner';
import { getContentStreamUrl, type StreamUrlResponse } from '@api/resources/content';

interface Props {
  contentId: string | null;
  filename?: string | undefined;
  onClose: () => void;
}

// Refresh the presigned URL slightly before the server-side TTL expires.
// 30s is comfortable for a metadata refetch + decode primer; tighter and
// we risk firing after the URL is already invalid; looser and a slow
// network can let the player load a dead URL before we swap.
const REFRESH_LEAD_MS = 30_000;

type ErrorPanel =
  | { kind: 'still-processing' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'network' }
  | { kind: 'generic' };

interface Loaded {
  readonly state: 'loaded';
  readonly stream: StreamUrlResponse;
}

type State =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | Loaded
  | { readonly state: 'error'; readonly panel: ErrorPanel };

// Maps each error panel kind to its i18n key suffix; translated at render.
const ERROR_KEY: Record<ErrorPanel['kind'], string> = {
  'still-processing': 'stillProcessing',
  forbidden: 'forbidden',
  'not-found': 'notFound',
  network: 'network',
  generic: 'generic',
};

const classifyFetchError = (err: unknown): ErrorPanel => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 409) return { kind: 'still-processing' };
    if (status === 403) return { kind: 'forbidden' };
    if (status === 404) return { kind: 'not-found' };
  }
  return { kind: 'generic' };
};

export const ContentPreviewModal = ({ contentId, filename, onClose }: Props) => {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ state: 'idle' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const isOpen = contentId !== null;

  const clearRefreshTimer = useCallback((): void => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // Fetch (or refetch) the stream URL. On refresh path, restore the player's
  // currentTime + paused state so the operator doesn't lose their place.
  const fetchStream = useCallback(
    async (id: string, isRefresh: boolean): Promise<void> => {
      const video = videoRef.current;
      const prevTime = isRefresh && video !== null ? video.currentTime : 0;
      const wasPaused = isRefresh && video !== null ? video.paused : false;

      if (!isRefresh) setState({ state: 'loading' });

      try {
        const stream = await getContentStreamUrl(Number.parseInt(id, 10));
        setState({ state: 'loaded', stream });

        if (isRefresh && video !== null) {
          // Wait one tick for React to swap the <source>; then seek back.
          window.setTimeout(() => {
            const v = videoRef.current;
            if (v === null) return;
            try {
              v.currentTime = prevTime;
              if (!wasPaused) void v.play().catch(() => undefined);
            } catch {
              // Seeking can throw if metadata isn't loaded yet; the loadedmetadata
              // handler below covers that case.
            }
          }, 0);
        }
      } catch (err: unknown) {
        if (isRefresh) {
          // Refresh-path failure: pause the player and surface inline.
          videoRef.current?.pause();
        }
        setState({ state: 'error', panel: classifyFetchError(err) });
      }
    },
    [],
  );

  // Open / close lifecycle. Kicks off the initial fetch and cleans up the
  // refresh timer on unmount.
  useEffect(() => {
    if (contentId === null) {
      setState({ state: 'idle' });
      clearRefreshTimer();
      return;
    }
    void fetchStream(contentId, false);
    return () => {
      clearRefreshTimer();
    };
  }, [contentId, fetchStream, clearRefreshTimer]);

  // Schedule the refresh exactly once per `loaded` state. Re-running on
  // every state change would also fire after the refresh swaps the URL
  // (the load function moves us back into 'loaded'), keeping the chain
  // alive for as long as the modal is open.
  useEffect(() => {
    if (state.state !== 'loaded' || contentId === null) return;
    const expiresAt = state.stream.expiresAt;
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return;

    const fireIn = expiresMs - Date.now() - REFRESH_LEAD_MS;
    // If the URL is already <30s from expiry on arrival, refresh immediately.
    const delay = Math.max(0, fireIn);

    refreshTimerRef.current = window.setTimeout(() => {
      void fetchStream(contentId, true);
    }, delay);

    return () => {
      clearRefreshTimer();
    };
  }, [state, contentId, fetchStream, clearRefreshTimer]);

  // On close: pause + tear down the <source> so the URL leaves the DOM and
  // no audio keeps playing in the background. React unmounts the element
  // shortly after; the explicit teardown also runs in cases where the
  // modal stays mounted (e.g. when contentId flips between two ids).
  useEffect(() => {
    if (isOpen) return;
    const video = videoRef.current;
    if (video === null) return;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // Element already torn down; nothing to do.
    }
  }, [isOpen]);

  const onVideoError = (e: SyntheticEvent<HTMLVideoElement>): void => {
    const code = e.currentTarget.error?.code;
    // MediaError.MEDIA_ERR_NETWORK === 2 — most operationally meaningful
    // signal we can act on; anything else (DECODE / SRC_NOT_SUPPORTED /
    // ABORTED) falls through to the generic copy.
    if (code === 2) {
      setState({ state: 'error', panel: { kind: 'network' } });
    } else {
      setState({ state: 'error', panel: { kind: 'generic' } });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={filename ?? t('contentPreviewModal.previewTitle')}
      size="lg"
    >
      <div className="oa-content-preview">
        {state.state === 'loading' && (
          <div className="oa-content-preview__state">
            <Spinner size="lg" label={t('contentPreviewModal.loadingPreview')} />
          </div>
        )}

        {state.state === 'loaded' && (
          <video
            ref={videoRef}
            src={state.stream.url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="oa-content-preview__video"
            onError={onVideoError}
          >
            <source src={state.stream.url} type={state.stream.contentType} />
            {t('contentPreviewModal.noVideoSupport')}
          </video>
        )}

        {state.state === 'error' && (
          <div className="oa-content-preview__error" role="alert">
            <h3 className="oa-content-preview__error-title">
              {t(`contentPreviewModal.error_${ERROR_KEY[state.panel.kind]}_title`)}
            </h3>
            <p>{t(`contentPreviewModal.error_${ERROR_KEY[state.panel.kind]}_body`)}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};
