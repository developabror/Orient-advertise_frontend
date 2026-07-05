// Tests for ForgotPasswordPage. The page must always show the same neutral
// "sent" confirmation (no account enumeration) — even on a network error — and
// only a 429 gets the distinct rate-limited copy with the form left up.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@api/resources/password', () => ({ requestPasswordReset: vi.fn() }));

import { requestPasswordReset } from '@api/resources/password';
import { ForgotPasswordPage } from '../ForgotPasswordPage';

const mockRequest = vi.mocked(requestPasswordReset);

const axiosError = (status: number): unknown =>
  Object.assign(new Error(`Request failed with status code ${String(status)}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });

const submitEmail = (value: string): void => {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('shows the neutral confirmation on success and never echoes the email', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    submitEmail('person@example.com');

    expect(await screen.findByText(/we've sent a reset link/i)).toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith('person@example.com');
    // The matched address must never be revealed, and the input is gone.
    expect(screen.queryByText('person@example.com')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });

  it('still shows the neutral confirmation on a network error (no enumeration)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Network Error'));
    submitEmail('person@example.com');

    expect(await screen.findByText(/we've sent a reset link/i)).toBeInTheDocument();
  });

  it('shows the rate-limited copy on a 429 and keeps the form up', async () => {
    mockRequest.mockRejectedValueOnce(axiosError(429));
    submitEmail('person@example.com');

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.queryByText(/we've sent a reset link/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('validates the email shape before calling the API', () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
