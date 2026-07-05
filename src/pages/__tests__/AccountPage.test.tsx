// Tests for AccountPage. A successful password change logs the user out and
// bounces to /login with a toast; a wrong current password renders inline on
// the current field; a recovery-email 409 renders inline on the email field.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@api/resources/password', () => ({
  changePassword: vi.fn(),
  setRecoveryEmail: vi.fn(),
}));

import { useAuth } from '@hooks/useAuth';
import { notify } from '@api/notify';
import { changePassword, setRecoveryEmail } from '@api/resources/password';
import { AccountPage } from '../AccountPage';

const mockChange = vi.mocked(changePassword);
const mockSetEmail = vi.mocked(setRecoveryEmail);
const logout = vi.fn();
let notifySuccess: ReturnType<typeof vi.spyOn>;

const envelopeError = (
  status: number,
  message: string,
  fieldErrors?: { field: string; message: string; rejectedValue: unknown }[],
): unknown =>
  Object.assign(new Error(`Request failed with status code ${String(status)}`), {
    isAxiosError: true,
    response: {
      status,
      data: {
        status,
        error: 'Error',
        message,
        correlationId: 'corr',
        timestamp: '2026-06-24T00:00:00Z',
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
  });

const renderAccount = (email: string | null = null): void => {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      sub: 'op',
      role: 'operator',
      profile: {
        id: 1,
        username: 'op',
        role: 'OPERATOR',
        active: true,
        createdAt: '2026-01-01T00:00:00Z',
        email,
        assignedProjectIds: [],
      },
    },
    logout,
  } as never);
  render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  logout.mockResolvedValue(undefined);
  notifySuccess = vi.spyOn(notify, 'success').mockImplementation(() => undefined);
});

afterEach(() => {
  notifySuccess.mockRestore();
});

describe('AccountPage — change password', () => {
  it('calls changePassword, toasts, logs out, and navigates to /login on success', async () => {
    mockChange.mockResolvedValueOnce(undefined);
    renderAccount();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass12' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
      expect(mockChange).toHaveBeenCalledWith({
        currentPassword: 'oldpass12',
        newPassword: 'newpass12',
        confirmPassword: 'newpass12',
      }),
    );
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(notifySuccess).toHaveBeenCalledWith('Password changed. Please sign in again.');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('still navigates to /login when logout() rejects after a successful change', async () => {
    mockChange.mockResolvedValueOnce(undefined);
    logout.mockRejectedValueOnce(new Error('logout network drop'));
    renderAccount();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass12' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('renders "Current password is incorrect" inline on the current field for a 400', async () => {
    mockChange.mockRejectedValueOnce(envelopeError(400, 'Current password is incorrect'));
    renderAccount();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrongpass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(logout).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the confirm mismatch error without calling the API', () => {
    renderAccount();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass12' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'mismatch12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockChange).not.toHaveBeenCalled();
  });
});

describe('AccountPage — recovery email', () => {
  it('renders the 409 "already in use" error inline on the email field', async () => {
    mockSetEmail.mockRejectedValueOnce(envelopeError(409, 'Email already in use'));
    renderAccount('taken@example.com');

    fireEvent.click(screen.getByRole('button', { name: /save email/i }));

    expect(await screen.findByText('That email is already in use.')).toBeInTheDocument();
  });

  it('saves the email and toasts on success', async () => {
    mockSetEmail.mockResolvedValueOnce(undefined);
    renderAccount('me@example.com');

    fireEvent.click(screen.getByRole('button', { name: /save email/i }));

    await waitFor(() => expect(mockSetEmail).toHaveBeenCalledWith('me@example.com'));
    expect(notifySuccess).toHaveBeenCalledWith('Recovery email saved.');
  });
});
