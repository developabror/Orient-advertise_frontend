// Vitest unit tests for src/api/resources/password.ts. Asserts each call hits
// the right method/URL/body and sets the documented suppression flags so the
// global toast/modal stay out of these self-rendering surfaces.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  changePassword,
  setRecoveryEmail,
  requestPasswordReset,
  resetPassword,
  validateResetToken,
} from '../password';

const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockPost.mockReset();
  mockPut.mockReset();
  mockGet.mockReset();
});

afterEach(() => {
  mockPost.mockReset();
  mockPut.mockReset();
  mockGet.mockReset();
});

describe('changePassword', () => {
  it('POSTs /api/me/password with the body and suppresses the modal', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });
    const body = { currentPassword: 'old', newPassword: 'newpass12', confirmPassword: 'newpass12' };

    await changePassword(body);

    expect(mockPost).toHaveBeenCalledWith('/api/me/password', body, { _suppressErrorModal: true });
  });
});

describe('setRecoveryEmail', () => {
  it('PUTs /api/me/email wrapping the address and suppresses the modal', async () => {
    mockPut.mockResolvedValueOnce({ data: undefined });

    await setRecoveryEmail('recover@example.com');

    expect(mockPut).toHaveBeenCalledWith(
      '/api/me/email',
      { email: 'recover@example.com' },
      { _suppressErrorModal: true },
    );
  });

  it('passes an empty string verbatim to clear the recovery email', async () => {
    mockPut.mockResolvedValueOnce({ data: undefined });

    await setRecoveryEmail('');

    expect(mockPut).toHaveBeenCalledWith('/api/me/email', { email: '' }, { _suppressErrorModal: true });
  });
});

describe('requestPasswordReset', () => {
  it('POSTs /api/auth/forgot-password and suppresses both toast and modal', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });

    await requestPasswordReset('user@example.com');

    expect(mockPost).toHaveBeenCalledWith(
      '/api/auth/forgot-password',
      { email: 'user@example.com' },
      { _suppressErrorToast: true, _suppressErrorModal: true },
    );
  });
});

describe('resetPassword', () => {
  it('POSTs /api/auth/reset-password with the body and suppresses toast + modal', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });
    const body = { token: 'tok', newPassword: 'newpass12', confirmPassword: 'newpass12' };

    await resetPassword(body);

    expect(mockPost).toHaveBeenCalledWith('/api/auth/reset-password', body, {
      _suppressErrorToast: true,
      _suppressErrorModal: true,
    });
  });
});

describe('validateResetToken', () => {
  it('GETs /api/auth/reset-password with the token param + suppression flags', async () => {
    mockGet.mockResolvedValueOnce({ data: { valid: true } });

    const ok = await validateResetToken('tok');

    expect(ok).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/api/auth/reset-password', {
      params: { token: 'tok' },
      _suppressErrorToast: true,
      _suppressErrorModal: true,
    });
  });

  it('resolves false when the body is not {valid:true}', async () => {
    mockGet.mockResolvedValueOnce({ data: { valid: false } });
    expect(await validateResetToken('tok')).toBe(false);

    mockGet.mockResolvedValueOnce({ data: 'nope' });
    expect(await validateResetToken('tok')).toBe(false);

    mockGet.mockResolvedValueOnce({ data: null });
    expect(await validateResetToken('tok')).toBe(false);
  });

  it('resolves false (never throws) when the request rejects, e.g. a 429', async () => {
    mockGet.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), {
        isAxiosError: true,
        response: { status: 429, data: {} },
      }),
    );
    expect(await validateResetToken('tok')).toBe(false);
  });
});
