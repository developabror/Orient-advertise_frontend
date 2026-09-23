// VG-12 / FE-06: an operator page cannot scope itself without `/api/me`, so a failed profile fetch
// used to leave it on a spinner forever — no retry, no error, nothing to click.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../wsClient', () => ({
  wsClient: { connect: vi.fn(), disconnect: vi.fn() },
}));
vi.mock('../http', () => ({
  refreshAccessToken: vi.fn(() => Promise.resolve()),
  loginWithCredentials: vi.fn(),
  logoutServer: vi.fn(() => Promise.resolve()),
}));
vi.mock('../resources/me', () => ({ getMe: vi.fn() }));
vi.mock('../authChannel', () => ({ onBroadcast: vi.fn(() => () => undefined) }));
vi.mock('../notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@components/BootstrapLoadingScreen', () => ({
  BootstrapLoadingScreen: () => <div>booting</div>,
}));

import { AuthProvider } from '../AuthProvider';
import { getMe } from '../resources/me';
import { tokenStore } from '../tokenStore';
import { useAssignedProjects } from '@hooks/useAssignedProjects';

const mockGetMe = vi.mocked(getMe);

const base64Url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const operatorJwt = (): string =>
  [
    base64Url(JSON.stringify({ alg: 'none' })),
    base64Url(
      JSON.stringify({ sub: 'olga', role: 'OPERATOR', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ),
    'sig',
  ].join('.');

/** Renders what a scoped page reads, plus the retry button those pages now offer. */
const Probe = () => {
  const { scopeResolved, scopeFailed, retryScope, projectIds } = useAssignedProjects();
  return (
    <div>
      <span data-testid="state">
        {scopeFailed ? 'failed' : scopeResolved ? `resolved:${projectIds.join(',')}` : 'waiting'}
      </span>
      <button type="button" onClick={retryScope}>
        retry
      </button>
    </div>
  );
};

const renderAsOperator = async (): Promise<void> => {
  tokenStore.set(operatorJwt());
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await screen.findByTestId('state'); // bootstrap settled
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  tokenStore.set(null);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  tokenStore.set(null);
});

describe('AuthProvider — /api/me failure (VG-12)', () => {
  it('retries a failed profile fetch before giving up', async () => {
    mockGetMe.mockRejectedValue(new Error('network'));

    await renderAsOperator();

    // First attempt failed; the page is still waiting, not yet showing an error.
    await vi.waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('state')).toHaveTextContent('waiting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(mockGetMe).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(mockGetMe).toHaveBeenCalledTimes(3);
  });

  it('reports the failure once the retries are exhausted, instead of spinning forever', async () => {
    mockGetMe.mockRejectedValue(new Error('network'));

    await renderAsOperator();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // This is the bug: before, the page sat on `waiting` for the rest of the session.
    expect(screen.getByTestId('state')).toHaveTextContent('failed');
  });

  it('recovers when the operator retries', async () => {
    mockGetMe.mockRejectedValue(new Error('network'));

    await renderAsOperator();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId('state')).toHaveTextContent('failed');

    mockGetMe.mockResolvedValue({
      username: 'olga',
      role: 'OPERATOR',
      assignedProjectIds: [4],
    } as never);
    await act(async () => {
      screen.getByRole('button', { name: 'retry' }).click();
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.getByTestId('state')).toHaveTextContent('resolved:4');
  });

  it('a transient failure heals on its own, without troubling the operator', async () => {
    mockGetMe
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ username: 'olga', role: 'OPERATOR', assignedProjectIds: [7] } as never);

    await renderAsOperator();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(screen.getByTestId('state')).toHaveTextContent('resolved:7');
  });
});
