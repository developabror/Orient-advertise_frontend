// DeviceRemotePage — the state machine is the feature, so that is what these
// pin: every transition an operator can actually reach, plus the two teardown
// paths that stop a box streaming over a metered link.
//
// The relay socket is mocked at `@api/relayClient` rather than by stubbing
// global WebSocket. That module *is* the socket boundary — it owns the
// WebSocket, the scrcpy parser and the WebCodecs decoder, none of which exist
// in jsdom — so mocking it tests the page's contract with the socket instead
// of a reimplementation of scrcpy's framing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@api/resources/remoteControl', () => ({
  startRemoteSession: vi.fn(),
  stopRemoteSession: vi.fn(),
  stopRemoteSessionBeacon: vi.fn(),
  getRemoteSession: vi.fn(),
  getDeviceConnection: vi.fn(),
}));

vi.mock('@api/relayClient', () => ({
  connectRelayViewer: vi.fn(),
  createVideoFrameRenderer: vi.fn(() => ({ setSize: vi.fn(), draw: vi.fn() })),
  isRemoteViewerSupported: vi.fn(() => true),
  remoteKeyForKeyboardEvent: (key: string) => (key === 'ArrowUp' ? 'up' : null),
}));

vi.mock('@hooks', () => ({ useDevice: vi.fn() }));

import {
  getDeviceConnection,
  getRemoteSession,
  startRemoteSession,
  stopRemoteSession,
  stopRemoteSessionBeacon,
} from '@api/resources/remoteControl';
import {
  connectRelayViewer,
  createVideoFrameRenderer,
  isRemoteViewerSupported,
} from '@api/relayClient';
import { useDevice } from '@hooks';
import { DeviceRemotePage } from '../DeviceRemotePage';

type ViewerOptions = Parameters<typeof connectRelayViewer>[0];

const viewerHandle = { pressKey: vi.fn(), tap: vi.fn(), close: vi.fn() };
let lastViewerOptions: ViewerOptions | null = null;

const HOUR_FROM_NOW = (): string => new Date(Date.now() + 3_600_000).toISOString();

const session = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionId: 'rs_1',
  deviceId: 12,
  status: 'PENDING',
  relayUrl: 'wss://relay.example.uz/viewer',
  viewerTicket: 'vt_secret',
  expiresAt: HOUR_FROM_NOW(),
  viewOnly: false,
  deliveredVia: 'WS',
  capability: {
    supported: true,
    input: 'ROOT',
    transport: 'SCRCPY_WS',
    maxWidth: 1280,
    maxHeight: 720,
    reportedAt: '2026-08-27T10:12:00Z',
  },
  ...over,
});

const apiError = (status: number, message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    statusText: '',
    data: { status, error: '', message, correlationId: 'corr', timestamp: '' },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/devices/12/remote']}>
      <Routes>
        <Route path="/devices/:id/remote" element={<DeviceRemotePage />} />
        <Route path="/devices/:id" element={<div>device detail</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** Click Connect and settle the POST. */
const connect = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => {
    expect(startRemoteSession).toHaveBeenCalled();
  });
};

/** Drive the mocked socket to its first decoded frame. */
const goLive = async (): Promise<void> => {
  await waitFor(() => {
    expect(lastViewerOptions).not.toBeNull();
  });
  act(() => {
    lastViewerOptions?.onSize(1280, 720);
    lastViewerOptions?.onLive();
  });
};

beforeEach(() => {
  vi.mocked(useDevice).mockReturnValue({
    state: 'ready',
    device: {
      id: '12',
      serialNumber: 'SN-12',
      facility: '1',
      region: '1',
      group: '1',
      syncGroupId: null,
      syncGroupName: null,
      ipAddress: '—',
      contentVersion: 'v1',
      reportedVolume: null,
      effectiveVolume: 100,
      volumeOverride: null,
      lastSeen: null,
      status: 'online',
      remoteCapability: null,
    },
  } as never);
  vi.mocked(getDeviceConnection).mockResolvedValue({ connected: true });
  vi.mocked(stopRemoteSession).mockResolvedValue(undefined);
  vi.mocked(isRemoteViewerSupported).mockReturnValue(true);
  lastViewerOptions = null;
  vi.mocked(connectRelayViewer).mockImplementation((options) => {
    lastViewerOptions = options;
    return viewerHandle;
  });
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('waiting for device', () => {
  it('renders the 2-minute hint when the session was delivered by heartbeat', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(
      session({ deliveredVia: 'HEARTBEAT' }) as never,
    );

    renderPage();
    await connect();

    expect(await screen.findByText('Waiting for device…')).toBeInTheDocument();
    expect(
      screen.getByText(
        'It may take up to 2 minutes — the device is not connected and will pick this up on its next check-in.',
      ),
    ).toBeInTheDocument();
  });

  it('does not claim a 2-minute wait when the device got the push over its socket', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session({ deliveredVia: 'WS' }) as never);

    renderPage();
    await connect();

    expect(await screen.findByText('Waiting for device…')).toBeInTheDocument();
    expect(screen.queryByText(/It may take up to 2 minutes/)).not.toBeInTheDocument();
  });

  it('shows elapsed time so the wait never reads as a hang', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(
      session({ deliveredVia: 'HEARTBEAT' }) as never,
    );

    renderPage();
    await connect();

    expect(await screen.findByText(/Waiting \d+s/)).toBeInTheDocument();
  });
});

describe('start failures', () => {
  it('renders the backend 409 message verbatim and offers Take over', async () => {
    const message = 'Device 12 already has an active remote session started by operator-7.';
    vi.mocked(startRemoteSession).mockRejectedValue(apiError(409, message));

    renderPage();
    await connect();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument();
  });

  it('takes over by stopping the live session then starting a fresh one', async () => {
    const message = 'A remote session is already open for this device.';
    vi.mocked(startRemoteSession).mockRejectedValueOnce(apiError(409, message));
    vi.mocked(getRemoteSession).mockResolvedValue({ sessionId: 'rs_old' } as never);
    vi.mocked(startRemoteSession).mockResolvedValueOnce(session() as never);

    renderPage();
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: 'Take over' }));

    await waitFor(() => {
      expect(stopRemoteSession).toHaveBeenCalledWith(12, 'rs_old');
    });
    expect(startRemoteSession).toHaveBeenCalledTimes(2);
  });

  it('renders the 422 reason with no retry — the device itself said no', async () => {
    const message = 'Device 12 reported that remote control is not supported.';
    vi.mocked(startRemoteSession).mockRejectedValue(apiError(422, message));

    renderPage();
    await connect();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument();
  });

  it('refuses to open a socket outside a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/secure \(HTTPS\) connection/);
    expect(startRemoteSession).not.toHaveBeenCalled();
  });

  it('refuses to open a socket without WebCodecs, and offers no retry', async () => {
    vi.mocked(isRemoteViewerSupported).mockReturnValue(false);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot decode the video/);
    expect(startRemoteSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('capability-driven degradation', () => {
  it('renders View only and mounts no input handlers when the device reports input NONE', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(
      session({
        capability: {
          supported: true,
          input: 'NONE',
          transport: 'SCRCPY_WS',
          maxWidth: 1280,
          maxHeight: 720,
          reportedAt: null,
        },
      }) as never,
    );

    const { container } = renderPage();
    await connect();
    await goLive();

    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    // Pointer and keyboard both stay inert — not merely hidden.
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    fireEvent.click(canvas as HTMLCanvasElement);
    expect(viewerHandle.tap).not.toHaveBeenCalled();

    const stage = container.querySelector('.oa-remote__stage');
    fireEvent.keyDown(stage as HTMLElement, { key: 'ArrowUp' });
    expect(viewerHandle.pressKey).not.toHaveBeenCalled();
  });

  it('renders the D-pad and forwards keys when the device accepts input', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    const { container } = renderPage();
    await connect();
    await goLive();

    expect(screen.queryByText('View only')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(viewerHandle.pressKey).toHaveBeenCalledWith('ok');

    const stage = container.querySelector('.oa-remote__stage');
    fireEvent.keyDown(stage as HTMLElement, { key: 'ArrowUp' });
    expect(viewerHandle.pressKey).toHaveBeenCalledWith('up');
  });
});

describe('credential hygiene', () => {
  it('creates one renderer per canvas, not one per session', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await connect();

    expect(createVideoFrameRenderer).toHaveBeenCalledTimes(1);
  });

  it('never renders the viewer ticket into the DOM', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    const { container } = renderPage();
    await connect();
    await goLive();

    expect(container.innerHTML).not.toContain('vt_secret');
  });
});

describe('teardown', () => {
  it('closes the socket AND stops the session on unmount', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    const { unmount } = renderPage();
    await connect();
    await goLive();

    unmount();

    expect(viewerHandle.close).toHaveBeenCalled();
    expect(stopRemoteSession).toHaveBeenCalledWith(12, 'rs_1');
  });

  it('stops the session when the operator disconnects', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(viewerHandle.close).toHaveBeenCalled();
    expect(stopRemoteSession).toHaveBeenCalledWith(12, 'rs_1');
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('fires the keepalive stop when the tab goes away', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();

    // Neither React cleanup nor an awaited DELETE would survive this.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(stopRemoteSessionBeacon).toHaveBeenCalledWith(12, 'rs_1');

    vi.mocked(stopRemoteSessionBeacon).mockClear();
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(stopRemoteSessionBeacon).toHaveBeenCalledWith(12, 'rs_1');
  });

  it('does not fire the keepalive stop when there is no session to stop', () => {
    renderPage();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(stopRemoteSessionBeacon).not.toHaveBeenCalled();
  });

  it('tears down locally when the countdown hits zero — no server round-trip', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(startRemoteSession).mockResolvedValue(
      // Already expiring: the device killed capture on its own clock at this
      // instant, so a DELETE would change nothing.
      session({ expiresAt: new Date(Date.now() + 1_000).toISOString() }) as never,
    );

    renderPage();
    await connect();
    await goLive();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/time limit/);
    expect(viewerHandle.close).toHaveBeenCalled();
    expect(stopRemoteSession).not.toHaveBeenCalled();
  });
});

describe('relay socket close', () => {
  it('renders the rejected/expired reason on 1008 and does NOT reconnect', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();

    act(() => {
      lastViewerOptions?.onClose(1008);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Session rejected or expired.');
    // The ticket is single-issue: a reconnect would be rejected 1008 again.
    // Recovery is a fresh Connect, which mints a new session.
    expect(connectRelayViewer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports a dropped connection on 1006', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();

    act(() => {
      lastViewerOptions?.onClose(1006);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost.');
  });

  it('tears down on a clean 1000 too — the relay closed the pair, not us', async () => {
    // `connectRelayViewer` never invokes onClose for its own `socket.close(1000)`
    // (it sets `closed` first), so a 1000 arriving here is the relay hanging up
    // at `exp` or because the device went away. Ignoring it would leave a frozen
    // frame on screen and the session open server-side until it expires.
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);

    renderPage();
    await connect();
    await goLive();

    act(() => {
      lastViewerOptions?.onClose(1000);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('The session was closed.');
    expect(stopRemoteSession).toHaveBeenCalledWith(12, 'rs_1');
  });

  it('refuses a relay URL the client will not dial, with no retry offered', async () => {
    vi.mocked(startRemoteSession).mockResolvedValue(session() as never);
    vi.mocked(connectRelayViewer).mockImplementation(() => {
      throw new Error('wss://relay/viewer?ticket=vt_secret is not allowed');
    });

    renderPage();
    await connect();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unusable relay address/);
    // The raw throw can embed the full socket URL — ticket included. It must
    // never reach the DOM.
    expect(alert.textContent).not.toContain('vt_secret');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
