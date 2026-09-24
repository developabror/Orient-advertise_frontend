// AuthProvider owns the live feed's lifecycle, and it must follow WHO is
// signed in — not the user object, which is replaced on every token rotation
// and when /api/me loads (FE-02). A different `sub` arriving without a logout
// (another tab signed in as someone else) has to drop the old user's socket
// before the new one opens: the socket authenticated at handshake and would
// otherwise keep streaming the previous user's events into this session.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../wsClient', () => ({
  wsClient: { connect: vi.fn(), disconnect: vi.fn() },
}));
vi.mock('../http', () => ({
  // Bootstrap goes through refreshOnce so tabs cannot spend the same refresh token twice (VG-14).
  refreshOnce: vi.fn(() => Promise.resolve('')),
  loginWithCredentials: vi.fn(),
  logoutServer: vi.fn(() => Promise.resolve()),
}));
vi.mock('../resources/me', () => ({
  getMe: vi.fn((): Promise<{ username: string }> => new Promise(() => undefined)),
}));
vi.mock('../authChannel', () => ({ onBroadcast: vi.fn(() => () => undefined) }));
vi.mock('../notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@components/BootstrapLoadingScreen', () => ({
  BootstrapLoadingScreen: () => <div>booting</div>,
}));

import { AuthProvider } from '../AuthProvider';
import { tokenStore } from '../tokenStore';
import { wsClient } from '../wsClient';

const base64Url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An unsigned JWT the client-side decoder accepts; `nonce` makes rotations distinct. */
const jwt = (sub: string, nonce = 0, role = 'ADMIN'): string =>
  [
    base64Url(JSON.stringify({ alg: 'none' })),
    base64Url(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600, nonce })),
    'sig',
  ].join('.');

const connect = vi.mocked(wsClient.connect);
const disconnect = vi.mocked(wsClient.disconnect);

const renderSignedOut = async (): Promise<ReturnType<typeof render>> => {
  const view = render(
    <AuthProvider>
      <div>app</div>
    </AuthProvider>,
  );
  await screen.findByText('app'); // bootstrap refresh settled
  return view;
};

beforeEach(() => {
  tokenStore.set(null);
  vi.clearAllMocks();
});

afterEach(() => {
  tokenStore.set(null);
});

describe('AuthProvider — live feed lifecycle', () => {
  it('connects once when a user signs in, and token rotations never touch the socket', async () => {
    await renderSignedOut();
    expect(connect).not.toHaveBeenCalled();

    act(() => {
      tokenStore.set(jwt('alice'));
    });
    act(() => {
      tokenStore.set(jwt('alice', 1)); // refresh: new token object, same user
    });
    act(() => {
      tokenStore.set(jwt('alice', 2));
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("drops the previous user's socket before connecting a different user", async () => {
    await renderSignedOut();
    act(() => {
      tokenStore.set(jwt('alice'));
    });

    act(() => {
      tokenStore.set(jwt('bob')); // another tab signed in as bob — no logout in between
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it('disconnects on logout', async () => {
    await renderSignedOut();
    act(() => {
      tokenStore.set(jwt('alice'));
    });

    act(() => {
      tokenStore.set(null);
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects when the provider unmounts while signed in', async () => {
    const view = await renderSignedOut();
    act(() => {
      tokenStore.set(jwt('alice'));
    });

    view.unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  // VG-05: the backend refuses the dashboard feed to these roles, so opening it
  // only ever produced a permanent "Live updates paused" badge.
  it.each(['VIEWER', 'ADVERTISER'])('never opens the live feed for a %s', async (role) => {
    await renderSignedOut();

    act(() => {
      tokenStore.set(jwt('carol', 0, role));
    });

    expect(connect).not.toHaveBeenCalled();
  });

  it('opens it for an operator', async () => {
    await renderSignedOut();

    act(() => {
      tokenStore.set(jwt('olga', 0, 'OPERATOR'));
    });

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
