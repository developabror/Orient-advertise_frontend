// Relay viewer client — the browser half of the scrcpy pipe.
//
// ── This is NOT `wsClient.ts` and must never be routed through it ──────────
// `wsClient.ts` is the dashboard's JSON event stream: one shared socket, an
// auth-aware reconnect policy, and an `isWsEvent()` guard that silently drops
// frames whose `type` it doesn't recognise. Every one of those behaviours is
// wrong here. This socket is binary, per-session, single-use, and must fail
// loudly rather than reconnect. Two sockets, two policies, zero shared state.
//
// Data path: the backend never sees a video byte (contract §1). It hands the
// operator a `relayUrl` + `viewerTicket`; we dial the relay directly and it
// pipes the device's scrcpy sockets through verbatim:
//
//     device scrcpy video   ──► relay ──► this socket  (H.264, binary down)
//     device scrcpy control ◄── relay ◄── this socket  (input, binary up)
//
// Both directions share one duplex WebSocket. There is no framing ambiguity
// because they never travel the same way.

import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  ScrcpyControlMessageSerializer,
  // Pinned to an explicit protocol version, NOT `ScrcpyOptionsLatest`: this
  // parser reads untrusted binary from a field device, and `Latest` re-points
  // itself on a dependency bump (it is 3.3.3 in the tree today, not 3.3.1).
  // A silent protocol change here is parser confusion, not a clean failure.
  ScrcpyOptions3_3_1,
  ScrcpyPointerId,
} from '@yume-chan/scrcpy';
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  type VideoFrameRenderer,
} from '@yume-chan/scrcpy-decoder-webcodecs';
// `TransformStream` comes from stream-extra rather than the DOM lib on
// purpose: the library augments the stream types with `values` /
// `Symbol.asyncIterator`, and mixing the two shapes makes `pipeThrough` fail
// to typecheck against `parseVideoStreamMetadata`.
import {
  PushReadableStream,
  TransformStream,
  type PushReadableStreamController,
} from '@yume-chan/stream-extra';

/**
 * ⚠️ **These three constants must match the `scrcpy-server.jar` the Android
 * team pins** (`REMOTE_CONTROL_ANDROID_SPEC.md` REQ-5.2, and its open question
 * #2 — the version is not confirmed yet). scrcpy's stream header has changed
 * shape across releases; a mismatch does not fail cleanly, it produces a
 * plausible-looking stream that never decodes.
 *
 * The values below mirror the launch line in that spec:
 *
 *     com.genymobile.scrcpy.Server <version> \
 *       tunnel_forward=true audio=false control=true \
 *       max_size=… max_fps=… video_bit_rate=…
 *
 * Everything else stays at the server's defaults, which is why `sendDeviceMeta`,
 * `sendCodecMeta` and `sendDummyByte` are spelled out here rather than omitted:
 * they are the fields that decide how many bytes precede the first frame, so
 * they belong in the record even though they are defaults today.
 */
export const SCRCPY_SERVER_VERSION = '3.3.1';

/** Options class matching {@link SCRCPY_SERVER_VERSION}. Change both together. */
const ScrcpyOptions = ScrcpyOptions3_3_1;

const SCRCPY_INIT = {
  video: true,
  audio: false,
  control: true,
  tunnelForward: true,
  // Header layout — see the warning above. `sendDummyByte` is consumed by the
  // `skipDummyByte()` stage in `connectRelayViewer`; the two move together.
  sendDeviceMeta: true,
  sendCodecMeta: true,
  sendDummyByte: true,
} as const;

/**
 * Ceiling on undrained inbound video held in memory. Matches the device-side
 * threshold in `REMOTE_CONTROL_ANDROID_SPEC.md` REQ-5.6 so both ends of the
 * pipe fail the same way — by dropping frames — rather than one of them
 * quietly growing a queue.
 */
const MAX_QUEUED_BYTES = 2 * 1024 * 1024;

/**
 * Whether this browser can decode H.264 in hardware. WebCodecs is a hard
 * requirement, not a preference: the first cut deliberately ships no WASM
 * software decoder, so an unsupported browser gets an explicit state instead
 * of a slideshow.
 */
export const isRemoteViewerSupported = (): boolean => {
  try {
    return WebCodecsVideoDecoder.isSupported;
  } catch {
    return false;
  }
};

/**
 * The `relayUrl` came off the wire and we are about to hand it a live bearer
 * ticket and a device's screen. It is a credential destination, not data.
 */
export class UntrustedRelayUrlError extends Error {
  constructor(reason: string) {
    // Deliberately excludes the URL: a message that quotes it would carry the
    // ticket, and this message can reach an error renderer.
    super(`Refusing to dial relay: ${reason}`);
    this.name = 'UntrustedRelayUrlError';
  }
}

/**
 * Validate the relay URL and attach the ticket.
 *
 * The `window.isSecureContext` check on the page is **not** a substitute for
 * the scheme check here: `http://localhost` is a "potentially trustworthy"
 * origin, so `isSecureContext` is true there while mixed-content blocking does
 * not apply — a `ws://` relay would connect happily and stream the screen in
 * clear. Contract §7 rule 5 says WSS everywhere; this is where that is enforced.
 *
 * `URL`/`searchParams` rather than string concatenation also keeps a relayUrl
 * that already carries a query or fragment from producing a malformed ticket.
 */
const buildRelaySocketUrl = (relayUrl: string, ticket: string): URL => {
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    throw new UntrustedRelayUrlError('not a valid URL');
  }
  if (url.protocol !== 'wss:') {
    throw new UntrustedRelayUrlError('relay must be wss://');
  }
  url.searchParams.set('ticket', ticket);
  return url;
};

/** The D-pad surface a TV box actually responds to. */
export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home';

const KEY_CODES: Record<RemoteKey, AndroidKeyCode> = {
  up: AndroidKeyCode.ArrowUp,
  down: AndroidKeyCode.ArrowDown,
  left: AndroidKeyCode.ArrowLeft,
  right: AndroidKeyCode.ArrowRight,
  ok: AndroidKeyCode.AndroidDPadCenter,
  back: AndroidKeyCode.AndroidBack,
  home: AndroidKeyCode.AndroidHome,
};

/** Keyboard keys worth forwarding, mapped to their D-pad equivalent. */
export const remoteKeyForKeyboardEvent = (key: string): RemoteKey | null => {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
      return 'ok';
    case 'Backspace':
    case 'Escape':
      return 'back';
    default:
      return null;
  }
};

export interface RelayViewerHandle {
  /** Press-and-release one D-pad key. No-op on a view-only session. */
  readonly pressKey: (key: RemoteKey) => void;
  /**
   * Tap at a point given in **normalised** coordinates (0–1 of the rendered
   * frame), so the caller never has to know the device's pixel geometry.
   * No-op on a view-only session or before the first frame sets the size.
   */
  readonly tap: (xRatio: number, yRatio: number) => void;
  /** Idempotent teardown: closes the socket and disposes the decoder. */
  readonly close: () => void;
}

export interface RelayViewerOptions {
  readonly relayUrl: string;
  /**
   * Single-use relay credential. It rides in the WebSocket query string
   * because that is the relay's contract (§6) — it is never written to the
   * browser URL bar, storage, or a log line, here or anywhere else.
   */
  readonly viewerTicket: string;
  /**
   * Renderer bound to the page's canvas. Owned by the **caller**, not by this
   * function, and deliberately outlives a session: `WebCodecsVideoDecoder.dispose()`
   * closes the decoder but never touches its renderer, and
   * `WebGLVideoFrameRenderer` exposes no disposal — so building one per session
   * would compile a fresh shader program on the same GL context on every
   * connect/disconnect cycle and never free the last. One renderer per canvas,
   * reused, has no such drift. Build it with {@link createVideoFrameRenderer}.
   */
  readonly renderer: VideoFrameRenderer;
  /** True when the session was minted `viewOnly`, or capability input is NONE. */
  readonly viewOnly: boolean;
  /** Fires once the device's frame geometry is known. */
  readonly onSize: (width: number, height: number) => void;
  /** Fires on the first successfully decoded frame — the true "live" signal. */
  readonly onLive: () => void;
  /** Socket closed. `code` is the raw WebSocket close code. */
  readonly onClose: (code: number) => void;
  /** Anything that went wrong before or during the pipe. */
  readonly onError: (error: unknown) => void;
}

/**
 * Build the renderer for a canvas. Call once per canvas element and reuse it
 * for every session on that canvas — see {@link RelayViewerOptions.renderer}.
 */
export const createVideoFrameRenderer = (canvas: HTMLCanvasElement): VideoFrameRenderer =>
  WebGLVideoFrameRenderer.isSupported
    ? new WebGLVideoFrameRenderer(canvas)
    : new BitmapVideoFrameRenderer(canvas);

/**
 * Drop the leading byte scrcpy emits under `tunnel_forward` before the stream
 * header. ya-webadb normally swallows it inside its ADB tunnel setup; our
 * device agent forwards the socket verbatim (ANDROID_SPEC REQ-5.5), so it
 * arrives here and must come off before `parseVideoStreamMetadata` reads the
 * 64-byte device name.
 */
const skipDummyByte = (): TransformStream<Uint8Array, Uint8Array> => {
  let dropped = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (dropped) {
        controller.enqueue(chunk);
        return;
      }
      dropped = true;
      if (chunk.length > 1) controller.enqueue(chunk.subarray(1));
    },
  });
};

/**
 * Open the relay socket and start decoding into `canvas`.
 *
 * **No auto-reconnect, by design.** The ticket is single-issue; a reconnect is
 * rejected `1008` and would spin. On close we surface the code and let the
 * operator press Connect again, which correctly mints a fresh session.
 */
export const connectRelayViewer = (options: RelayViewerOptions): RelayViewerHandle => {
  // Validate first: a rejected URL must leave no socket, no decoder and no
  // half-built handle behind, and must throw before the ticket is used.
  const socketUrl = buildRelaySocketUrl(options.relayUrl, options.viewerTicket);

  const scrcpy = new ScrcpyOptions(SCRCPY_INIT);
  const serializer = new ScrcpyControlMessageSerializer(scrcpy);

  const socket = new WebSocket(socketUrl);
  socket.binaryType = 'arraybuffer';

  let decoder: WebCodecsVideoDecoder | null = null;
  let removeSizeListener: (() => void) | null = null;
  let videoWidth = 0;
  let videoHeight = 0;
  let live = false;
  let closed = false;

  let controller: PushReadableStreamController<Uint8Array> | null = null;
  let endSource: (() => void) | null = null;
  // Bytes handed to the stream that the decoder has not drained yet. See
  // MAX_QUEUED_BYTES.
  let queuedBytes = 0;

  const source = new PushReadableStream<Uint8Array>((c) => {
    controller = c;
    return new Promise<void>((resolve) => {
      endSource = resolve;
    });
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    removeSizeListener?.();
    removeSizeListener = null;
    endSource?.();
    endSource = null;
    try {
      decoder?.dispose();
    } catch {
      /* disposing a decoder that never started is not an error worth raising */
    }
    decoder = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000);
    }
  };

  const send = (bytes: Uint8Array): void => {
    if (options.viewOnly || closed || socket.readyState !== WebSocket.OPEN) return;
    // A fresh ArrayBuffer slice: `bytes` may be a view onto a pooled buffer,
    // and `send` would otherwise ship the whole pool.
    socket.send(bytes.slice().buffer);
  };

  socket.onmessage = (event: MessageEvent<unknown>) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const chunk = new Uint8Array(event.data);
    // Drop rather than buffer. `enqueue` is async and the socket's event loop
    // can't await it, so an unawaited enqueue on a decoder that has fallen
    // behind (a slow machine, a backgrounded tab) would grow the queue without
    // bound for the length of the session. Dropping mirrors what the device
    // already does on its own send queue (ANDROID_SPEC REQ-5.6): the picture
    // tears until the next keyframe, which is strictly better than the tab
    // consuming memory until it dies.
    if (queuedBytes + chunk.byteLength > MAX_QUEUED_BYTES) return;
    queuedBytes += chunk.byteLength;
    void controller?.enqueue(chunk).finally(() => {
      queuedBytes -= chunk.byteLength;
    });
  };

  socket.onerror = () => {
    // The `error` event carries nothing useful in browsers; `onclose` follows
    // immediately with the code that actually tells the operator what happened.
  };

  socket.onclose = (event: CloseEvent) => {
    endSource?.();
    endSource = null;
    if (!closed) options.onClose(event.code);
  };

  socket.onopen = () => {
    void (async () => {
      try {
        // Paired with `SCRCPY_INIT.sendDummyByte`: if that ever goes false,
        // this stage must come out with it or the first header byte is eaten.
        const framed = source.pipeThrough(skipDummyByte());
        const { stream, metadata } = await scrcpy.parseVideoStreamMetadata(framed);
        if (closed) return;

        const videoDecoder = new WebCodecsVideoDecoder({
          codec: metadata.codec,
          renderer: options.renderer,
        });
        decoder = videoDecoder;

        removeSizeListener = videoDecoder.sizeChanged(({ width, height }) => {
          videoWidth = width;
          videoHeight = height;
          options.onSize(width, height);
          if (!live) {
            live = true;
            options.onLive();
          }
        });

        if (metadata.width !== undefined && metadata.height !== undefined) {
          videoWidth = metadata.width;
          videoHeight = metadata.height;
          options.onSize(metadata.width, metadata.height);
        }

        await stream
          .pipeThrough(scrcpy.createMediaStreamTransformer())
          .pipeTo(videoDecoder.writable);
      } catch (error: unknown) {
        if (!closed) options.onError(error);
      }
    })();
  };

  return {
    pressKey: (key: RemoteKey): void => {
      const keyCode = KEY_CODES[key];
      const base = { keyCode, repeat: 0, metaState: AndroidKeyEventMeta.None };
      send(serializer.injectKeyCode({ ...base, action: AndroidKeyEventAction.Down }));
      send(serializer.injectKeyCode({ ...base, action: AndroidKeyEventAction.Up }));
    },
    tap: (xRatio: number, yRatio: number): void => {
      if (videoWidth === 0 || videoHeight === 0) return;
      const pointerX = Math.round(Math.min(Math.max(xRatio, 0), 1) * videoWidth);
      const pointerY = Math.round(Math.min(Math.max(yRatio, 0), 1) * videoHeight);
      const base = {
        pointerId: ScrcpyPointerId.Finger,
        pointerX,
        pointerY,
        videoWidth,
        videoHeight,
        actionButton: AndroidMotionEventButton.Primary,
        buttons: AndroidMotionEventButton.Primary,
      };
      send(
        serializer.injectTouch({ ...base, action: AndroidMotionEventAction.Down, pressure: 1 }),
      );
      send(
        serializer.injectTouch({
          ...base,
          action: AndroidMotionEventAction.Up,
          pressure: 0,
          buttons: AndroidMotionEventButton.None,
        }),
      );
    },
    close,
  };
};
