// Render tests for LoginPage error surfacing. The page mines the 401 envelope
// message verbatim, gives a 429 its own "too many attempts" copy (AUTH-2), and
// collapses everything else to the generic credential error so internal detail
// never leaks.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));

import { useAuth } from '@hooks/useAuth';
import { LoginPage } from '../LoginPage';

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
