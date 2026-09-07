// Relay client — the URL guard in front of the socket.
//
// `connectRelayViewer` is handed a `relayUrl` that came off the wire and a
// single-use bearer ticket for it. These cases pin the check that decides
// whether that URL is allowed to receive the ticket and the device's screen,
// because the failure is silent: a `ws://` relay connects perfectly well and
// streams a customer's screen in clear.
//
// The decode pipeline itself is not exercised here — jsdom has no WebCodecs.
// It is covered where it belongs, at the page boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectRelayViewer,
  isRemoteViewerSupported,
  remoteKeyForKeyboardEvent,
  UntrustedRelayUrlError,
} from '../relayClient';

const TICKET = 'vt_single_use_secret';

let constructedUrls: string[] = [];

class FakeSocket {
  static readonly CONNECTING = 0;
  binaryType = '';
  readyState = 0;
  onmessage: unknown = null;
  onerror: unknown = null;
  onclose: unknown = null;
  onopen: unknown = null;
  constructor(url: string | URL) {
    constructedUrls.push(String(url));
  }
  close(): void {
    this.readyState = 3;
  }
  send(): void {
    /* not exercised here */
  }
}

const options = (relayUrl: string) => ({
  relayUrl,
  viewerTicket: TICKET,
  renderer: { setSize: vi.fn(), draw: vi.fn() },
  viewOnly: false,
  onSize: vi.fn(),
  onLive: vi.fn(),
  onClose: vi.fn(),
  onError: vi.fn(),
});

beforeEach(() => {
  constructedUrls = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('relay URL guard', () => {
  it('refuses a cleartext ws:// relay — contract §7 rule 5 is WSS everywhere', () => {
    expect(() => connectRelayViewer(options('ws://relay.example.uz/viewer') as never)).toThrow(
      UntrustedRelayUrlError,
    );
    // Nothing was dialled, so the ticket never left the tab.
    expect(constructedUrls).toHaveLength(0);
  });

  it('refuses an http(s):// relay', () => {
    expect(() => connectRelayViewer(options('https://relay.example.uz/viewer') as never)).toThrow(
      UntrustedRelayUrlError,
    );
    expect(constructedUrls).toHaveLength(0);
  });

  it('refuses a malformed URL', () => {
    expect(() => connectRelayViewer(options('not-a-url') as never)).toThrow(UntrustedRelayUrlError);
    expect(constructedUrls).toHaveLength(0);
  });

  it('never puts the ticket in the thrown message — that message gets rendered', () => {
    try {
      connectRelayViewer(options('ws://relay.example.uz/viewer') as never);
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      expect(String((err as Error).message)).not.toContain(TICKET);
    }
  });

  it('dials a wss:// relay with the ticket attached', () => {
    connectRelayViewer(options('wss://relay.example.uz/viewer') as never);

    expect(constructedUrls).toHaveLength(1);
    const url = new URL(constructedUrls[0] as string);
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('ticket')).toBe(TICKET);
  });

  it('preserves a relayUrl that already carries a query string', () => {
    connectRelayViewer(options('wss://relay.example.uz/viewer?region=uz') as never);

    const url = new URL(constructedUrls[0] as string);
    expect(url.searchParams.get('region')).toBe('uz');
    expect(url.searchParams.get('ticket')).toBe(TICKET);
  });
});

describe('remoteKeyForKeyboardEvent', () => {
  it('maps the keys a D-pad box understands and ignores the rest', () => {
    expect(remoteKeyForKeyboardEvent('ArrowUp')).toBe('up');
    expect(remoteKeyForKeyboardEvent('ArrowDown')).toBe('down');
    expect(remoteKeyForKeyboardEvent('ArrowLeft')).toBe('left');
    expect(remoteKeyForKeyboardEvent('ArrowRight')).toBe('right');
    expect(remoteKeyForKeyboardEvent('Enter')).toBe('ok');
    expect(remoteKeyForKeyboardEvent('Backspace')).toBe('back');
    expect(remoteKeyForKeyboardEvent('Escape')).toBe('back');
    expect(remoteKeyForKeyboardEvent('a')).toBeNull();
    expect(remoteKeyForKeyboardEvent('F5')).toBeNull();
  });
});

describe('isRemoteViewerSupported', () => {
  it('answers without throwing where WebCodecs is absent', () => {
    // jsdom has no VideoDecoder; the guard must degrade to a clean `false`
    // rather than exploding on the page's pre-flight check.
    expect(typeof isRemoteViewerSupported()).toBe('boolean');
  });
});
