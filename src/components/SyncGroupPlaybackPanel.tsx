import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './ui/Spinner';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { notify } from '@api/notify';
import { extractApiMessage, getSyncGroupPlayback, jumpSyncGroupToIndex } from '@api';
import type { SyncGroupPlaybackItem, SyncGroupPlaybackView } from '@api';
import { markErrorHandled } from '@api/errorDialog';

// A lighter cousin of ActivePlaylistPanel: that one is device-centric (tracks a
// currently-playing item + live progress); this one lists a *group's* shared
// order and jumps every member in lockstep. The jump is NOT instantaneous — the
// backend schedules a coordinated cut-over at `activateAt` (a few seconds out)
// so screens flip together and offline devices converge on their next beat, so
// we surface "switch at HH:MM:SS" rather than pretending it's immediate.

interface Props {
  readonly groupId: number;
  readonly canControl: boolean;
}

interface QueuedJump {
  readonly index: number;
  readonly activateAt: string;
}

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
};

// The scheduled cut-over is a wall-clock moment; show it as local HH:MM:SS.
const formatClock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const SyncGroupPlaybackPanel = ({ groupId, canControl }: Props) => {
  const { t } = useTranslation();
  const [view, setView] = useState<SyncGroupPlaybackView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [confirmItem, setConfirmItem] = useState<SyncGroupPlaybackItem | null>(null);
  const [queued, setQueued] = useState<QueuedJump | null>(null);
  const queuedRowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSyncGroupPlayback(groupId)
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setQueued(v.activeJump);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(extractApiMessage(err) ?? t('syncGroupsPage.playbackError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, t]);

  // Bring the queued row into view when a jump is scheduled (respecting
  // reduced-motion, like ActivePlaylistPanel). No-op when nothing is queued.
  useEffect(() => {
    const node = queuedRowRef.current;
    if (!node || typeof node.scrollIntoView !== 'function') return;
    node.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [queued?.index]);

  const confirmJump = (): void => {
    const item = confirmItem;
    if (item === null) return;
    // Close the confirm and show the per-row spinner while the request is in
    // flight. The jump is fired fire-and-forget so the dialog owns no async and
    // closes at once; the row's index cell carries the pending state.
    setConfirmItem(null);
    setPendingIndex(item.index);
    jumpSyncGroupToIndex(groupId, item.index)
      .then((result) => {
        setQueued({ index: result.index, activateAt: result.activateAt });
        notify.success(
          t('syncGroupsPage.jumpQueued', {
            title: item.title,
            time: formatClock(result.activateAt),
          }),
        );
      })
      .catch((err: unknown) => {
        markErrorHandled(err);
        notify.error(extractApiMessage(err) ?? t('syncGroupsPage.jumpError'));
      })
      .finally(() => {
        setPendingIndex(null);
      });
  };

  if (loading) return <p className="oa-muted">{t('syncGroupsPage.playbackLoading')}</p>;
  if (error !== null) return <div className="oa-settings-page__error">{error}</div>;
  if (view === null) return null;

  if (!view.coherent) {
    return (
      <p className="oa-settings-page__notice">
        {t('syncGroupsPage.playbackNotCoherent', { reason: view.reason ?? '' })}
      </p>
    );
  }

  if (view.items.length === 0) {
    return <p className="oa-muted">{t('syncGroupsPage.playbackNoItems')}</p>;
  }

  const queuedTitle =
    queued !== null ? (view.items.find((it) => it.index === queued.index)?.title ?? '') : '';
  const anyPending = pendingIndex !== null;

  return (
    <div className="oa-playlist">
      {view.playlistName !== null && <p className="oa-playlist__name">{view.playlistName}</p>}

      {queued !== null && (
        <p className="oa-settings-page__notice" role="status">
          {t('syncGroupsPage.jumpQueued', {
            title: queuedTitle,
            time: formatClock(queued.activateAt),
          })}
        </p>
      )}

      <ol className="oa-playlist__list">
        {view.items.map((item) => {
          const isQueued = queued?.index === item.index;
          const isJumpLoading = pendingIndex === item.index;

          const indexCell = isJumpLoading ? (
            <span className="oa-playlist__index">
              <Spinner size="sm" label={t('syncGroupsPage.loading')} />
            </span>
          ) : (
            <span className="oa-playlist__index">{item.index + 1}</span>
          );

          const rowContent = (
            <>
              {indexCell}
              <div className="oa-playlist__main">
                <span className="oa-playlist__title" title={item.title}>
                  {item.title}
                </span>
              </div>
              <span className="oa-playlist__duration">{formatDuration(item.durationSeconds)}</span>
            </>
          );

          const activeClass = isQueued ? ' oa-playlist__item--active' : '';

          return (
            <li key={item.index} ref={isQueued ? queuedRowRef : null}>
              {canControl ? (
                <button
                  type="button"
                  className={`oa-playlist__item oa-playlist__item--clickable${activeClass}`}
                  onClick={() => {
                    setConfirmItem(item);
                  }}
                  disabled={anyPending}
                  aria-current={isQueued ? 'true' : undefined}
                  aria-label={t('syncGroupsPage.jumpAria', { title: item.title })}
                >
                  {rowContent}
                </button>
              ) : (
                <div
                  className={`oa-playlist__item${activeClass}`}
                  aria-current={isQueued ? 'true' : undefined}
                >
                  {rowContent}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {canControl && (
        <ConfirmDialog
          isOpen={confirmItem !== null}
          title={t('syncGroupsPage.jumpConfirmTitle')}
          message={t('syncGroupsPage.jumpConfirmMessage', { title: confirmItem?.title ?? '' })}
          confirmLabel={t('syncGroupsPage.jumpConfirmLabel')}
          onConfirm={confirmJump}
          onCancel={() => {
            setConfirmItem(null);
          }}
        />
      )}
    </div>
  );
};
