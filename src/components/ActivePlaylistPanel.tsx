import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { http } from '@api/http';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import type { DevicePlaylist } from '@hooks/useDevice';

interface Props {
  deviceId: string;
  playlist: DevicePlaylist | null;
  controlsEnabled?: boolean;
}

type ControlAction =
  | { readonly type: 'prev' }
  | { readonly type: 'next' }
  | { readonly type: 'jump'; readonly itemId: string };

type PendingControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'prev' }
  | { readonly kind: 'next' }
  | { readonly kind: 'jump'; readonly itemId: string };

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ActivePlaylistPanel = ({ deviceId, playlist, controlsEnabled = false }: Props) => {
  const { t } = useTranslation();
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(playlist?.currentItemElapsedSeconds ?? 0);
  const [pending, setPending] = useState<PendingControl>({ kind: 'none' });

  useEffect(() => {
    setElapsedSeconds(playlist?.currentItemElapsedSeconds ?? 0);
  }, [playlist?.currentItemId, playlist?.currentItemElapsedSeconds]);

  useEffect(() => {
    if (playlist?.currentItemId === undefined || playlist.currentItemId === null) return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1_000);
    return () => {
      window.clearInterval(id);
    };
  }, [playlist?.currentItemId]);

  useEffect(() => {
    const node = activeItemRef.current;
    if (!node) return;
    node.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [playlist?.currentItemId]);

  const sendControl = async (action: ControlAction): Promise<void> => {
    setPending(
      action.type === 'jump' ? { kind: 'jump', itemId: action.itemId } : { kind: action.type },
    );
    try {
      // Spec: POST /api/devices/{id}/playlist/control body
      // PlaylistControlRequest{ action: PREV|NEXT|JUMP, position?: int }.
      // For JUMP, derive `position` from the index of the target item in
      // the playlist (the FE keeps items in playback order).
      let body: { action: 'PREV' | 'NEXT' | 'JUMP'; position?: number };
      if (action.type === 'prev') body = { action: 'PREV' };
      else if (action.type === 'next') body = { action: 'NEXT' };
      else {
        const idx = playlist?.items.findIndex((it) => it.id === action.itemId) ?? -1;
        body = { action: 'JUMP', position: idx >= 0 ? idx : 0 };
      }
      await http.post(`/api/devices/${encodeURIComponent(deviceId)}/playlist/control`, body, {
        _suppressErrorToast: true,
      });
    } catch (err) {
      markErrorHandled(err);
      notify.error(extractApiMessage(err) ?? t('activePlaylistPanel.controlError'));
    } finally {
      setPending({ kind: 'none' });
    }
  };

  if (playlist === null) {
    return (
      <article className="oa-card oa-playlist">
        <header className="oa-panel-header">
          <h2>{t('activePlaylistPanel.heading')}</h2>
        </header>
        <p className="oa-muted">{t('activePlaylistPanel.noPlaylist')}</p>
      </article>
    );
  }

  if (playlist.items.length === 0) {
    return (
      <article className="oa-card oa-playlist">
        <header className="oa-panel-header">
          <h2>{t('activePlaylistPanel.heading')}</h2>
        </header>
        <p className="oa-playlist__name">{playlist.name}</p>
        <p className="oa-muted">{t('activePlaylistPanel.noItems')}</p>
      </article>
    );
  }

  const currentIndex =
    playlist.currentItemId !== null
      ? playlist.items.findIndex((i) => i.id === playlist.currentItemId)
      : -1;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < playlist.items.length - 1;
  const anyPending = pending.kind !== 'none';

  return (
    <article className="oa-card oa-playlist">
      <header className="oa-panel-header">
        <h2>{t('activePlaylistPanel.heading')}</h2>
      </header>
      <p className="oa-playlist__name">{playlist.name}</p>

      {controlsEnabled && (
        <div className="oa-playlist__controls">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void sendControl({ type: 'prev' });
            }}
            disabled={!canPrev || anyPending}
            isLoading={pending.kind === 'prev'}
          >
            {t('activePlaylistPanel.previous')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void sendControl({ type: 'next' });
            }}
            disabled={!canNext || anyPending}
            isLoading={pending.kind === 'next'}
          >
            {t('activePlaylistPanel.next')}
          </Button>
        </div>
      )}

      <ol className="oa-playlist__list">
        {playlist.items.map((item, i) => {
          const isActive = item.id === playlist.currentItemId;
          const canJump = controlsEnabled && !isActive;
          const isJumpLoading = pending.kind === 'jump' && pending.itemId === item.id;
          const progressPct =
            isActive && item.durationSeconds > 0
              ? Math.min(100, (elapsedSeconds / item.durationSeconds) * 100)
              : 0;

          const indexCell = isJumpLoading ? (
            <span className="oa-playlist__index">
              <Spinner size="sm" label={t('activePlaylistPanel.sending')} />
            </span>
          ) : (
            <span className="oa-playlist__index">{i + 1}</span>
          );

          const itemContent = (
            <>
              {indexCell}
              <div className="oa-playlist__main">
                <span className="oa-playlist__title" title={item.title}>
                  {item.title}
                </span>
                {isActive && (
                  <div
                    className="oa-playlist__progress"
                    role="progressbar"
                    aria-label={t('activePlaylistPanel.progressLabel', { title: item.title })}
                    aria-valuenow={Math.round(progressPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={t('activePlaylistPanel.progressValue', {
                      elapsed: formatDuration(elapsedSeconds),
                      total: formatDuration(item.durationSeconds),
                    })}
                  >
                    <span
                      className="oa-playlist__progress-fill"
                      style={{ width: `${String(progressPct)}%` }}
                    />
                  </div>
                )}
              </div>
              <span className="oa-playlist__duration">{formatDuration(item.durationSeconds)}</span>
            </>
          );

          return (
            <li key={item.id}>
              {canJump ? (
                <button
                  type="button"
                  className="oa-playlist__item oa-playlist__item--clickable"
                  onClick={() => {
                    void sendControl({ type: 'jump', itemId: item.id });
                  }}
                  disabled={anyPending}
                  aria-label={t('activePlaylistPanel.jumpLabel', { title: item.title })}
                >
                  {itemContent}
                </button>
              ) : (
                <div
                  ref={isActive ? activeItemRef : null}
                  className={`oa-playlist__item${isActive ? ' oa-playlist__item--active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {itemContent}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
};
