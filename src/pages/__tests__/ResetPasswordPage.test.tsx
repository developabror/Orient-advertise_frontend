// Tests for ResetPasswordPage. The form is gated behind a token check: a
// missing/invalid token shows the "expired" state with a request-new link; a
// valid token + matching passwords calls resetPassword and lands on /login; a
// client-side mismatch surfaces inline without hitting the API.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@api/resources/password', () => ({
  validateResetToken: vi.fn(),
  resetPassword: vi.fn(),
}));

import { resetPassword, validateResetToken } from '@api/resources/password';
import { ResetPasswordPage } from '../ResetPasswordPage';

const mockValidate = vi.mocked(validateResetToken);
const mockReset = vi.mocked(resetPassword);

const renderAt = (search: string): void => {
  render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResetPasswordPage', () => {
  it('shows the invalid state with a request-new link when no token is present', async () => {
    renderAt('');

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toBeInTheDocument();
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('shows the invalid state when the token fails validation', async () => {
    mockValidate.mockResolvedValueOnce(false);
    renderAt('?token=bad');

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('resets and navigates to /login when the token is valid and passwords match', async () => {
    mockValidate.mockResolvedValueOnce(true);
    mockReset.mockResolvedValueOnce(undefined);
    renderAt('?token=good');

    const newPw = await screen.findByLabelText('New password');
    fireEvent.change(newPw, { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith({
        token: 'good',
        newPassword: 'newpass12',
        confirmPassword: 'newpass12',
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('shows the mismatch error without calling the API', async () => {
    mockValidate.mockResolvedValueOnce(true);
    renderAt('?token=good');

    await screen.findByLabelText('New password');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass12' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mockReset).not.toHaveBeenCalled();
  });
});
