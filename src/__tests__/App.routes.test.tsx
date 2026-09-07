// Route-guard tests for the remote viewer.
//
// `/devices/:id` deliberately admits `advertiser`, and the remote viewer sits
// one path segment deeper — so the obvious mistake is to nest the new route in
// that same block and hand an advertiser a live screen of a customer's box
// (contract §7 rule 6). That mistake is invisible in review and silent at
// runtime, which is why it gets its own test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@api/wsClient', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn(() => 'open'),
    onStatus: vi.fn(() => () => undefined),
    onEvent: vi.fn(() => () => undefined),
  },
}));
vi.mock('@api/criticalAlerts', () => ({
  criticalAlerts: {
    getAll: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
    add: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
  handleIncidentUpdated: vi.fn(),
  handleSnapshot: vi.fn(),
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// Only the two pages these routes resolve to are stubbed; ForbiddenPage and
// the layout stay real, because where the redirect actually lands is the
// assertion.
vi.mock('@pages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pages')>();
  return { ...actual, DeviceDetailPage: () => <div>device detail</div> };
});
// Mocked at its own module path, not through `@pages`: the remote viewer is
// code-split in App.tsx via a direct dynamic import (see the comment there),
// so the barrel never sees it.
vi.mock('../pages/DeviceRemotePage', () => ({
  DeviceRemotePage: () => <div>remote viewer</div>,
}));

import { useAuth } from '@hooks/useAuth';
import type { Role } from '@api/auth';
import { App } from '../App';

const renderAs = (role: Role, path: string): void => {
  vi.mocked(useAuth).mockReturnValue({
    user: { sub: 'u', role, profile: null },
    logout: vi.fn(),
  } as never);
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/devices/:id/remote', () => {
  it('redirects an advertiser to /forbidden', async () => {
    renderAs('advertiser', '/devices/12/remote');

    await waitFor(() => {
      expect(screen.getByText('403 — Forbidden')).toBeInTheDocument();
    });
    expect(screen.queryByText('remote viewer')).not.toBeInTheDocument();
  });

  it('redirects a viewer to /forbidden', async () => {
    renderAs('viewer', '/devices/12/remote');

    await waitFor(() => {
      expect(screen.getByText('403 — Forbidden')).toBeInTheDocument();
    });
    expect(screen.queryByText('remote viewer')).not.toBeInTheDocument();
  });

  it('admits an operator', async () => {
    renderAs('operator', '/devices/12/remote');

    expect(await screen.findByText('remote viewer')).toBeInTheDocument();
  });

  it('admits an admin', async () => {
    renderAs('admin', '/devices/12/remote');

    expect(await screen.findByText('remote viewer')).toBeInTheDocument();
  });
});

describe('/devices/:id', () => {
  it('still admits an advertiser — the new guard must not narrow the existing route', async () => {
    renderAs('advertiser', '/devices/12');

    expect(await screen.findByText('device detail')).toBeInTheDocument();
  });
});
