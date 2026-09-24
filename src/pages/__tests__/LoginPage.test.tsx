// Render tests for LoginPage error surfacing. The page mines the 401 envelope
// message verbatim, gives a 429 its own "too many attempts" copy (AUTH-2), and
// collapses everything else to the generic credential error so internal detail
// never leaks.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useAuth } from '@hooks/useAuth';
import { notify } from '@api/notify';
import { recordServerTime, resetClockSkew } from '@api/clockSkew';
import { tokenStore } from '@api/tokenStore';
import { LoginPage } from '../LoginPage';

const base64Url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A token the server would consider valid for the next fifteen minutes. */
const freshToken = (): string =>
  [
    base64Url(JSON.stringify({ alg: 'none' })),
    base64Url(
      JSON.stringify({
        sub: 'operator',
        role: 'OPERATOR',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ),
    'sig',
  ].join('.');

const axiosError = (status: number, message?: string): unknown =>
  Object.assign(new Error(`Request failed with status code ${String(status)}`), {
    isAxiosError: true,
    response: { status, data: message === undefined ? {} : { message } },
  });

const renderLogin = (login: () => Promise<void>): void => {
  vi.mocked(useAuth).mockReturnValue({ user: null, login } as never);
  const { container } = render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  const username = container.querySelector('input[type="text"]');
  const password = container.querySelector('input[type="password"]');
  if (username === null || password === null) throw new Error('login inputs not found');
  fireEvent.change(username, { target: { value: 'operator' } });
  fireEvent.change(password, { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetClockSkew();
  tokenStore.set(null);
});

describe('LoginPage — error surfacing', () => {
  it('shows a clear rate-limit message on 429 (not the generic credential error)', async () => {
    renderLogin(() => Promise.reject(axiosError(429)));
    expect(await screen.findByText(/too many sign-in attempts/i)).toBeInTheDocument();
    expect(screen.queryByText('Invalid username or password.')).not.toBeInTheDocument();
  });

  it('surfaces the 401 envelope message verbatim (e.g. account locked)', async () => {
    renderLogin(() => Promise.reject(axiosError(401, 'Account is locked')));
    expect(await screen.findByText('Account is locked')).toBeInTheDocument();
  });

  it('collapses a 500 to the generic credential error (no internal detail leak)', async () => {
    renderLogin(() => Promise.reject(axiosError(500, 'NullPointerException at line 42')));
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
    expect(screen.queryByText(/NullPointerException/)).not.toBeInTheDocument();
  });
});

describe('LoginPage — a session the browser would not accept (VG-11)', () => {
  it('says what is wrong instead of leaving the form doing nothing', async () => {
    // The lockout: the POST succeeds, the server issues a good token, and a browser whose clock is
    // far ahead treats it as already expired. `user` stays null, so the redirect never fires —
    // before this the form simply sat there, with no error and nothing to try.
    renderLogin(() => Promise.resolve());

    expect(await screen.findByText(/date, time and time zone/i)).toBeInTheDocument();
  });

  it('warns when the clock is far off but the session works', async () => {
    tokenStore.set(freshToken());
    recordServerTime(new Date(Date.now() - 12 * 60_000).toUTCString());

    renderLogin(() => Promise.resolve());

    await vi.waitFor(() => {
      expect(vi.mocked(notify.warning)).toHaveBeenCalledWith(
        expect.stringContaining('12 minutes'),
      );
    });
    // Not an error — the operator is signed in, they just cannot trust on-screen timestamps.
    expect(screen.queryByText(/date, time and time zone/i)).toBeNull();
  });
});
