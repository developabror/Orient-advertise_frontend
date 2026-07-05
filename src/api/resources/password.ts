// Password-management resource — typed wrappers around the change-password,
// recovery-email, and forgot/reset-password endpoints. Mirrors the style of
// `users.ts`/`me.ts` (JSDoc + typed bodies).
//
// Authorization is handled by the global request interceptor in `../http.ts`;
// resource layers MUST NOT set the Authorization header themselves. The two
// authenticated calls (`changePassword`, `setRecoveryEmail`) ride the normal
// Bearer + refresh-retry path. The two public calls (`requestPasswordReset`,
// `resetPassword`) and the token-validation GET are reachable signed-out: the
// interceptor still attaches a Bearer if one happens to exist, which the
// backend ignores for these public endpoints. They return 202/204/400/429 (not
// 401), so the interceptor's refresh-and-retry path is never triggered.
//
// Every call here renders its own errors inline, so each passes
// `_suppressErrorModal: true` to keep the global business-error modal out of
// the way; the public calls add `_suppressErrorToast: true` so a 5xx/network
// hiccup doesn't double-message on top of the page's own neutral copy.

import { http } from '../http';

/** Body for `POST /api/me/password`. The backend compares + rehashes server-side. */
export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
}

/** Body for `POST /api/auth/reset-password`. `token` comes from the emailed link. */
export interface ResetPasswordRequest {
  readonly token: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
}

/**
 * POST /api/me/password — 204 on success.
 *
 * The backend revokes every session on success, so the caller must log the
 * user out and bounce to `/login`. A 400 surfaces inline: wrong current
 * password (`message`), `fieldErrors` (policy/mismatch), or a "must differ"
 * message. Pass `_suppressErrorModal` so the page renders the 400 itself.
 */
export const changePassword = async (req: ChangePasswordRequest): Promise<void> => {
  await http.post('/api/me/password', req, { _suppressErrorModal: true });
};

/**
 * PUT /api/me/email — 204 on success. Pass `''` to clear the recovery email.
 *
 * **409** means the address is already in use by another account — surface it
 * inline on the email field. `_suppressErrorModal` keeps the global modal away
 * so the page owns the message.
 */
export const setRecoveryEmail = async (email: string): Promise<void> => {
  await http.put('/api/me/email', { email }, { _suppressErrorModal: true });
};

/**
 * POST /api/auth/forgot-password — **always 202**; never reveals whether the
 * email matched an account (no enumeration). The caller flips to a neutral
 * "if an account exists, we sent a link" state regardless of outcome, with a
 * 429 the only distinct case (rate-limited). Suppresses both the toast and the
 * modal so nothing leaks beyond the page's own copy.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  await http.post(
    '/api/auth/forgot-password',
    { email },
    { _suppressErrorToast: true, _suppressErrorModal: true },
  );
};

/**
 * POST /api/auth/reset-password — 204 on success. A 400 means an
 * invalid/expired token or a policy/mismatch failure; the caller flips to the
 * invalid state for the former and maps field errors for the latter.
 */
export const resetPassword = async (req: ResetPasswordRequest): Promise<void> => {
  await http.post('/api/auth/reset-password', req, {
    _suppressErrorToast: true,
    _suppressErrorModal: true,
  });
};

/**
 * GET /api/auth/reset-password?token=… — gate the reset form before showing it.
 *
 * Resolves `false` on ANY non-`{valid:true}` outcome (a malformed body, a 4xx,
 * or a 429 rate-limit), so the page falls back to the "invalid/expired —
 * request a new link" state instead of throwing. Suppresses toast + modal so a
 * rate-limit doesn't surface a generic error on top of the page's own state.
 */
export const validateResetToken = async (token: string): Promise<boolean> => {
  try {
    const { data } = await http.get<unknown>('/api/auth/reset-password', {
      params: { token },
      _suppressErrorToast: true,
      _suppressErrorModal: true,
    });
    return typeof data === 'object' && data !== null && (data as { valid?: unknown }).valid === true;
  } catch {
    return false;
  }
};
