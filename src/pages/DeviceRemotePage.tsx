import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Badge, Button, Spinner, StatusDot } from '@components';
import {
  getDeviceConnection,
  getRemoteSession,
  startRemoteSession,
  stopRemoteSession,
  stopRemoteSessionBeacon,
  type RemoteSession,
  type RemoteSessionView,
} from '@api/resources/remoteControl';
import { markErrorHandled } from '@api/errorDialog';
import { extractApiMessage } from '@api/resources/_types';
import {
  connectRelayViewer,
  createVideoFrameRenderer,
  isRemoteViewerSupported,
  remoteKeyForKeyboardEvent,
  type RelayViewerHandle,
  type RemoteKey,
} from '@api/relayClient';
import type { VideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs';
import { useDevice } from '@hooks';

/**
 * A device WS push reaches the box immediately; a heartbeat delivery waits for
 * its next beat. The backend's beat interval is 2 minutes, and that number is
 * the whole reason `waitingForDevice` is a first-class state instead of a
 * spinner: an operator staring at an unexplained spinner mashes Connect and
 * generates 409s.
 */
const HEARTBEAT_WINDOW_MS = 120_000;

/**
 * What the operator can do about the error on screen.
 *
 * - `connect` — transient; the Connect button comes back.
 * - `takeover` — a session is already open (409). Offer DELETE-then-POST.
 * - `none` — terminal for this device or browser (422, insecure context, no
 *   WebCodecs). Offering a retry here would be a lie.
 */
type Recovery = 'connect' | 'takeover' | 'none';

/**
 * The session as the *view* sees it — ticket removed.
 *
 * Component state is enumerable in React DevTools and is exactly what an error
 * boundary or a future session-replay integration snapshots, so the single-use
 * relay credential never goes in it. The full session (ticket included) lives
 * only in `sessionRef`, which nothing serialises.
 */
type ViewerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'waiting'; readonly session: RemoteSessionView; readonly since: number }
  | { readonly kind: 'live'; readonly session: RemoteSessionView }
  | { readonly kind: 'error'; readonly message: string; readonly recovery: Recovery };

/** Strip the ticket before a session is allowed anywhere near `setState`. */
const toView = (session: RemoteSession): RemoteSessionView => {
  const { viewerTicket: _ticket, ...view } = session;
  return view;
};

/** Human-readable cause for a relay socket that closed on us (§6). */
const closeCodeKey = (code: number): string => {
  switch (code) {
    case 1000:
      return 'deviceRemotePage.closeNormal';
    case 1008:
      return 'deviceRemotePage.closeRejected';
    default:
      // 1006 (abnormal) is by far the most common non-1008 code and reads the
      // same to an operator as any other unexpected drop.
      return 'deviceRemotePage.closeLost';
  }
};

/**
 * Reuses `deviceDetailPage`'s status copy rather than re-translating five
 * strings into a second namespace — the same device, the same five words.
 */
const STATUS_LABEL_KEY: Record<string, string> = {
  online: 'deviceDetailPage.statusOnline',
  offline: 'deviceDetailPage.statusOffline',
  'no-content': 'deviceDetailPage.statusNoContent',
  unregistered: 'deviceDetailPage.statusUnregistered',
  unknown: 'deviceDetailPage.statusUnknown',
};

const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
};

const DPAD_KEYS: readonly { readonly key: RemoteKey; readonly labelKey: string }[] = [
  { key: 'up', labelKey: 'deviceRemotePage.dpadUp' },
  { key: 'left', labelKey: 'deviceRemotePage.dpadLeft' },
  { key: 'ok', labelKey: 'deviceRemotePage.dpadOk' },
  { key: 'right', labelKey: 'deviceRemotePage.dpadRight' },
  { key: 'down', labelKey: 'deviceRemotePage.dpadDown' },
  { key: 'back', labelKey: 'deviceRemotePage.dpadBack' },
  { key: 'home', labelKey: 'deviceRemotePage.dpadHome' },
];

export const DeviceRemotePage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deviceId = Number.parseInt(id ?? '', 10);
  const deviceState = useDevice(id);

  const [state, setState] = useState<ViewerState>({ kind: 'idle' });
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const [deviceConnected, setDeviceConnected] = useState<boolean | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // One renderer per canvas, reused across sessions — building one per session
  // leaks a GL shader program each time (see RelayViewerOptions.renderer).
  const rendererRef = useRef<VideoFrameRenderer | null>(null);
  // Guards the window between `POST /remote` resolving and this component
  // still being on screen; without it an operator who navigates away mid-start
  // gets a session that is only cleaned up by an accident of ref lifecycle.
  const mountedRef = useRef(true);
  // The live session and viewer live in refs, not state: teardown runs from an
  // unmount cleanup and a `pagehide` listener, both of which see a stale
  // closure over state but always see the current ref.
  const sessionRef = useRef<RemoteSession | null>(null);
  const viewerRef = useRef<RelayViewerHandle | null>(null);

  /**
   * Close the relay socket and (optionally) tell the server.
   *
   * `notifyServer: false` is used on exactly one path — the countdown reaching
   * zero — and rests on two independent server/device-side backstops rather
   * than on this browser's clock being right:
   *   1. the device kills capture at `expiresAt` on its **own** clock, network
   *      state irrelevant (contract §7 rule 4, ANDROID_SPEC REQ-6.1), and
   *   2. the backend's `RemoteSessionExpirationJob` reaps the row.
   * A skewed workstation clock therefore costs at most a stale row until one of
   * those fires, never a box left streaming.
   *
   * Everything else — unmount, Disconnect, a socket that dropped — tells the
   * server, because a session left open keeps a box streaming over a metered
   * link. Idempotent; safe to call twice.
   */
  const teardown = useCallback((notifyServer: boolean): void => {
    viewerRef.current?.close();
    viewerRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session !== null && notifyServer) {
      void stopRemoteSession(session.deviceId, session.sessionId).catch(() => {
        // The device kills capture at `expiresAt` on its own clock regardless
        // (contract §7 rule 4) — a failed stop degrades to a shorter leak, not
        // an unbounded one, and there is nothing useful to show the operator.
      });
    }
  }, []);

  // Belt: React unmount (route change, back button, logout).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown(true);
    };
  }, [teardown]);

  // Braces: the tab closing, where no React cleanup and no awaited request
  // would ever complete. `pagehide` covers the bfcache path that `beforeunload`
  // misses on mobile Safari; both are idempotent.
  useEffect(() => {
    const onLeaving = (): void => {
      const session = sessionRef.current;
      if (session !== null) stopRemoteSessionBeacon(session.deviceId, session.sessionId);
    };
    window.addEventListener('beforeunload', onLeaving);
    window.addEventListener('pagehide', onLeaving);
    return () => {
      window.removeEventListener('beforeunload', onLeaving);
      window.removeEventListener('pagehide', onLeaving);
    };
  }, []);

  // Live socket liveness, resolved here rather than on the device list: it
  // decides whether Connect pairs in seconds or in two minutes, and
  // `device_status_view` lags up to 16 minutes (contract §3).
  useEffect(() => {
    if (!Number.isFinite(deviceId)) return;
    let cancelled = false;
    getDeviceConnection(deviceId)
      .then(({ connected }) => {
        if (!cancelled) setDeviceConnected(connected);
      })
      .catch(() => {
        if (!cancelled) setDeviceConnected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const fail = useCallback((message: string, recovery: Recovery): void => {
    teardown(recovery !== 'takeover');
    setRemainingMs(null);
    setFrame(null);
    setState({ kind: 'error', message, recovery });
  }, [teardown]);

  /**
   * Open the relay socket for a freshly minted session.
   *
   * Deliberately **no reconnect**: the ticket is single-issue and a retry is
   * rejected `1008`, so a dropped socket drops to the error state and the
   * operator presses Connect, which mints a fresh session with a fresh ticket.
   */
  const attachViewer = useCallback(
    (session: RemoteSession): void => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        fail(t('deviceRemotePage.errCanvas'), 'connect');
        return;
      }
      rendererRef.current ??= createVideoFrameRenderer(canvas);
      const view = toView(session);
      const viewOnly = session.viewOnly || session.capability?.input === 'NONE';
      let handle: RelayViewerHandle;
      try {
        handle = connectRelayViewer({
          relayUrl: session.relayUrl,
          viewerTicket: session.viewerTicket,
          renderer: rendererRef.current,
          viewOnly,
          onSize: (width, height) => {
            setFrame({ width, height });
          },
          onLive: () => {
            setState((prev) => (prev.kind === 'waiting' ? { kind: 'live', session: view } : prev));
          },
          onClose: (code) => {
            // `connectRelayViewer` flips its own `closed` flag before calling
            // `socket.close(1000)`, so this never fires for our own teardown.
            // Any close that reaches here is the relay dropping the pair —
            // including a clean 1000 at `exp` — and must tear down, or the
            // page sits on a frozen frame with the session still open server
            // side until it expires, 409ing every retry in between.
            fail(t(closeCodeKey(code)), 'connect');
          },
          onError: () => {
            fail(t('deviceRemotePage.errStream'), 'connect');
          },
        });
      } catch {
        // Never surface the raw throw: a WebSocket constructor DOMException
        // embeds the full URL, ticket and all, and this message is rendered.
        fail(t('deviceRemotePage.errRelayUntrusted'), 'none');
        return;
      }
      viewerRef.current = handle;
    },
    [fail, t],
  );

  const beginSession = useCallback(
    (session: RemoteSession): void => {
      if (!mountedRef.current) {
        // Navigated away while the POST was in flight. Stop the session we just
        // created rather than leaving a box streaming to nobody.
        void stopRemoteSession(session.deviceId, session.sessionId).catch(() => undefined);
        return;
      }
      sessionRef.current = session;
      setWaitedMs(0);
      setRemainingMs(Date.parse(session.expiresAt) - Date.now());
      setState({ kind: 'waiting', session: toView(session), since: Date.now() });
      attachViewer(session);
    },
    [attachViewer],
  );

  /**
   * Map a failed `POST /remote` onto the operator-facing states of §5.
   *
   * The backend's `message` is rendered **verbatim** for every status that
   * carries one — it is the only copy that explains *which* session is open or
   * *why* the box can't do this. The resource layer suppresses the global toast
   * and modal precisely because this function renders it here instead.
   */
  const renderStartFailure = useCallback(
    (err: unknown): void => {
      markErrorHandled(err); // claim first, before any await (see errorDialog.ts)
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message = extractApiMessage(err);
      switch (status) {
        case 409:
          fail(message ?? t('deviceRemotePage.errBusy'), 'takeover');
          return;
        case 422:
          // The device itself reported it cannot do this. A retry would fail
          // identically every time, so we do not offer one.
          fail(message ?? t('deviceRemotePage.errUnsupportedDevice'), 'none');
          return;
        case 403:
          fail(t('deviceRemotePage.errForbidden'), 'none');
          return;
        case 404:
          fail(t('deviceRemotePage.errNoDevice'), 'none');
          return;
        case 503:
          fail(t('deviceRemotePage.errDisabled'), 'connect');
          return;
        default:
          fail(message ?? t('deviceRemotePage.errStart'), 'connect');
      }
    },
    [fail, t],
  );

  const connect = useCallback((): void => {
    if (!Number.isFinite(deviceId)) {
      fail(t('deviceRemotePage.errNoDevice'), 'none');
      return;
    }
    // WSS and WebCodecs both require a secure context, and neither failure is
    // recoverable by retrying — say so instead of opening a socket that cannot
    // work (contract §7 rule 5).
    if (!window.isSecureContext) {
      fail(t('deviceRemotePage.errInsecure'), 'none');
      return;
    }
    if (!isRemoteViewerSupported()) {
      fail(t('deviceRemotePage.errNoWebCodecs'), 'none');
      return;
    }
    setState({ kind: 'starting' });
    startRemoteSession(deviceId).then(beginSession).catch(renderStartFailure);
  }, [beginSession, deviceId, fail, renderStartFailure, t]);

  /**
   * Take over a device whose session belongs to someone else: stop the live
   * one, then start ours. The live session's id comes from `GET /remote` —
   * never from parsing it out of the 409 message.
   */
  const takeOver = useCallback((): void => {
    setState({ kind: 'starting' });
    getRemoteSession(deviceId)
      .then(async (existing) => {
        if (existing !== null) await stopRemoteSession(deviceId, existing.sessionId);
        return startRemoteSession(deviceId);
      })
      .then(beginSession)
      .catch(renderStartFailure);
  }, [beginSession, deviceId, renderStartFailure]);

  const disconnect = useCallback((): void => {
    teardown(true);
    setRemainingMs(null);
    setFrame(null);
    setState({ kind: 'idle' });
  }, [teardown]);

  const active = state.kind === 'waiting' || state.kind === 'live';

  // One timer drives both the expiry countdown and the "how long have we been
  // waiting" readout, so they can never disagree by a tick.
  useEffect(() => {
    if (state.kind !== 'waiting' && state.kind !== 'live') return;
    const expiresAt = Date.parse(state.session.expiresAt);
    const tick = (): void => {
      const left = expiresAt - Date.now();
      setRemainingMs(left);
      if (state.kind === 'waiting') setWaitedMs(Date.now() - state.since);
      if (left <= 0) {
        // Tear down locally and do NOT call the server: the device already
        // killed capture on its own clock at this instant, so a DELETE would be
        // a round-trip that changes nothing.
        teardown(false);
        setFrame(null);
        setState({ kind: 'error', message: t('deviceRemotePage.errExpired'), recovery: 'connect' });
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [state, teardown, t]);

  const session = state.kind === 'waiting' || state.kind === 'live' ? state.session : null;
  const viewOnly = session !== null && (session.viewOnly || session.capability?.input === 'NONE');
  const inputEnabled = state.kind === 'live' && !viewOnly;

  const press = useCallback((key: RemoteKey): void => {
    viewerRef.current?.pressKey(key);
  }, []);

  const onStageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!inputEnabled) return;
    const key = remoteKeyForKeyboardEvent(event.key);
    if (key === null) return;
    event.preventDefault();
    press(key);
  };

  const onCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!inputEnabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    viewerRef.current?.tap(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  const device = deviceState.state === 'ready' ? deviceState.device : null;
  const aspectRatio = frame !== null ? `${String(frame.width)} / ${String(frame.height)}` : '16 / 9';

  return (
    <section className="oa-remote">
      <header className="oa-remote__header">
        <button
          type="button"
          className="oa-device-detail__back"
          onClick={() => {
            navigate(`/devices/${encodeURIComponent(id ?? '')}`);
          }}
        >
          ← {t('deviceRemotePage.backToDevice')}
        </button>

        <div className="oa-remote__identity">
          <h1 className="oa-mono">{device?.serialNumber ?? id}</h1>
          {device !== null && (
            <StatusDot
              status={device.status}
              label={t(STATUS_LABEL_KEY[device.status] ?? 'deviceDetailPage.statusUnknown')}
            />
          )}
          {state.kind === 'live' && <Badge variant="success">{t('deviceRemotePage.chipLive')}</Badge>}
          {state.kind === 'waiting' && (
            <Badge variant="warning">{t('deviceRemotePage.chipWaiting')}</Badge>
          )}
          {viewOnly && <Badge variant="info">{t('deviceRemotePage.viewOnly')}</Badge>}
        </div>

        <div className="oa-remote__actions">
          {remainingMs !== null && active && (
            <span className="oa-remote__countdown" aria-live="off">
              {t('deviceRemotePage.expiresIn', { time: formatCountdown(remainingMs) })}
            </span>
          )}
          {active && (
            <Button variant="danger" onClick={disconnect}>
              {t('deviceRemotePage.disconnect')}
            </Button>
          )}
        </div>
      </header>

      {/* The canvas is mounted from the first render, not gated behind the
          `live` state: `connectRelayViewer` needs a real element at the moment
          the operator clicks Connect, and a ref that only populates a render
          later would race it. Non-live states draw over it. */}
      <div
        className="oa-remote__stage"
        style={{ aspectRatio }}
        tabIndex={inputEnabled ? 0 : -1}
        role={inputEnabled ? 'application' : undefined}
        aria-label={inputEnabled ? t('deviceRemotePage.stageLabel') : undefined}
        onKeyDown={onStageKeyDown}
      >
        <canvas
          ref={canvasRef}
          className="oa-remote__canvas"
          onClick={onCanvasClick}
          aria-label={t('deviceRemotePage.canvasLabel')}
        />

        {state.kind !== 'live' && (
          <div className="oa-remote__overlay">
            {state.kind === 'idle' && (
              <div className="oa-remote__panel">
                <p className="oa-remote__lead">{t('deviceRemotePage.idleLead')}</p>
                {deviceConnected === false && (
                  <p className="oa-remote__hint">{t('deviceRemotePage.offlineHint')}</p>
                )}
                <p className="oa-remote__hint">{t('deviceRemotePage.capabilityUnknown')}</p>
                <Button variant="cta" onClick={connect}>
                  {t('deviceRemotePage.connect')}
                </Button>
              </div>
            )}

            {state.kind === 'starting' && (
              <div className="oa-remote__panel">
                <Spinner size="lg" label={t('deviceRemotePage.starting')} />
              </div>
            )}

            {state.kind === 'waiting' && (
              <div className="oa-remote__panel">
                {/* No spinner label here — the visible lead below carries the
                    same words, and duplicating it would read twice aloud. */}
                <Spinner size="lg" />
                <p className="oa-remote__lead">{t('deviceRemotePage.waitingTitle')}</p>
                {/* Explicit, not a bare spinner: a heartbeat delivery genuinely
                    takes up to two minutes and an unexplained wait reads as a
                    hang. */}
                <p className="oa-remote__hint">
                  {state.session.deliveredVia === 'HEARTBEAT'
                    ? t('deviceRemotePage.waitingHeartbeat', {
                        minutes: Math.ceil(HEARTBEAT_WINDOW_MS / 60_000),
                      })
                    : t('deviceRemotePage.waitingWs')}
                </p>
                <p className="oa-remote__elapsed">
                  {t('deviceRemotePage.waitingElapsed', {
                    seconds: Math.floor(waitedMs / 1000),
                  })}
                </p>
              </div>
            )}

            {state.kind === 'error' && (
              <div className="oa-remote__panel">
                {/* The backend's own message, verbatim. */}
                <p className="oa-remote__error" role="alert">
                  {state.message}
                </p>
                {state.recovery === 'takeover' && (
                  <Button variant="cta" onClick={takeOver}>
                    {t('deviceRemotePage.takeOver')}
                  </Button>
                )}
                {state.recovery === 'connect' && (
                  <Button variant="cta" onClick={connect}>
                    {t('deviceRemotePage.reconnect')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* D-pad, not a mouse: these are D-pad-first boxes and a cursor is the
          wrong mental model for the people driving them. Hidden entirely when
          the device reports it cannot accept input. */}
      {inputEnabled && (
        <footer className="oa-remote__dpad" aria-label={t('deviceRemotePage.dpadLabel')}>
          {DPAD_KEYS.map(({ key, labelKey }) => (
            <Button
              key={key}
              variant="secondary"
              size="sm"
              className={`oa-remote__dpad-btn oa-remote__dpad-btn--${key}`}
              onClick={() => {
                press(key);
              }}
            >
              {t(labelKey)}
            </Button>
          ))}
        </footer>
      )}

      {viewOnly && state.kind === 'live' && (
        <p className="oa-remote__hint oa-remote__hint--footer">
          {t('deviceRemotePage.viewOnlyExplain')}
        </p>
      )}
    </section>
  );
};
