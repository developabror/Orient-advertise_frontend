import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { http } from '@api/http';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import type { DeviceActivePlaylistState } from '@hooks';

interface Props {
  deviceId: string;
  state: DeviceActivePlaylistState;
  controlsEnabled?: boolean;
}

type ControlAction =
  | { readonly type: 'prev' }
  | { readonly type: 'next' }
  | { readonly type: 'jump'; readonly index: number };

type PendingControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'prev' }
  | { readonly kind: 'next' }
  | { readonly kind: 'jump'; readonly index: number };

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
};

const Frame = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation();
  return (
    <article className="oa-card oa-playlist">
      <header className="oa-panel-header">
        <h2>{t('activePlaylistPanel.heading')}</h2>
      </header>
      {children}
    </article>
  );
};

export const ActivePlaylistPanel = ({ deviceId, state, controlsEnabled = false }: Props) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingControl>({ kind: 'none' });

  const sendControl = async (action: ControlAction): Promise<void> => {
    setPending(
      action.type === 'jump' ? { kind: 'jump', index: action.index } : { kind: action.type },
    );
    try {
      // POST /api/devices/{id}/playlist/control body
      // PlaylistControlRequest{ action: PREV|NEXT|JUMP, position?: int }.
      // `position` is the item's delivered index, which the backend range-checks
      // against the same list this panel renders — never the row's ordinal in
      // some other ordering, and never the raw playlist position.
      const body: { action: 'PREV' | 'NEXT' | 'JUMP'; position?: number } =
        action.type === 'jump'
          ? { action: 'JUMP', position: action.index }
          : { action: action.type === 'prev' ? 'PREV' : 'NEXT' };
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

  if (state.state === 'loading') {
    return (
      <Frame>
        <Spinner size="sm" label={t('activePlaylistPanel.loading')} />
      </Frame>
    );
  }

  if (state.state === 'error') {
    // The old code swallowed this and showed "No playlist assigned" instead,
    // which is why a permanent 403 went unnoticed for so long (VG-02).
    return (
      <Frame>
        <p className="oa-settings-page__error" role="alert">
          {state.message ?? t('activePlaylistPanel.loadError')}
        </p>
      </Frame>
    );
  }

  const playlist = state.playlist;

  if (playlist === null) {
    return (
      <Frame>
        <p className="oa-muted">{t('activePlaylistPanel.noPlaylist')}</p>
      </Frame>
    );
  }

  if (playlist.items.length === 0) {
    return (
      <Frame>
        <p className="oa-playlist__name">{playlist.name}</p>
        <p className="oa-muted">{t('activePlaylistPanel.noItems')}</p>
      </Frame>
    );
  }

  // Per-device transport is refused while the device follows a group anchor
  // (the device answers PLAYLIST_CONTROL with FAILED "SCHEDULE_MODE"), so the
  // panel offers the sync-group jump instead of buttons that quietly do nothing.
  const controlsUsable = controlsEnabled && !playlist.scheduled;
  // There is no "currently playing" signal on this endpoint — the device never
  // reports its position — so transport is offered whenever there is somewhere
  // to step to, and the device resolves prev/next against what it is playing.
  const canStep = playlist.items.length > 1;
  const anyPending = pending.kind !== 'none';

  return (
    <Frame>
      <p className="oa-playlist__name">{playlist.name}</p>

      {controlsEnabled && playlist.scheduled && (
        <p className="oa-muted">{t('activePlaylistPanel.scheduleMode')}</p>
      )}

      {controlsUsable && (
        <div className="oa-playlist__controls">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void sendControl({ type: 'prev' });
            }}
            disabled={!canStep || anyPending}
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
            disabled={!canStep || anyPending}
            isLoading={pending.kind === 'next'}
          >
            {t('activePlaylistPanel.next')}
          </Button>
        </div>
      )}

      <ol className="oa-playlist__list">
        {playlist.items.map((item) => {
          const isJumpLoading = pending.kind === 'jump' && pending.index === item.index;

          const itemContent = (
            <>
              {isJumpLoading ? (
                <span className="oa-playlist__index">
                  <Spinner size="sm" label={t('activePlaylistPanel.sending')} />
                </span>
              ) : (
                <span className="oa-playlist__index">{item.index + 1}</span>
              )}
              <div className="oa-playlist__main">
                <span className="oa-playlist__title" title={item.title}>
                  {item.title}
                </span>
              </div>
              <span className="oa-playlist__duration">{formatDuration(item.durationSeconds)}</span>
            </>
          );

          return (
            // Keyed by the delivered index, not fileId: a playlist may schedule
            // the same clip twice, and fileId keys would collide.
            <li key={item.index}>
              {controlsUsable ? (
                <button
                  type="button"
                  className="oa-playlist__item oa-playlist__item--clickable"
                  onClick={() => {
                    void sendControl({ type: 'jump', index: item.index });
                  }}
                  disabled={anyPending}
                  aria-label={t('activePlaylistPanel.jumpLabel', { title: item.title })}
                >
                  {itemContent}
                </button>
              ) : (
                <div className="oa-playlist__item">{itemContent}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Frame>
  );
};
