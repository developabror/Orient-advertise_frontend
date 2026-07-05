import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useAuth } from '@hooks/useAuth';
import { extractApiMessage, extractFieldErrors } from '@api';
import { notify } from '@api/notify';
import { markErrorHandled } from '@api/errorDialog';
import { changePassword, setRecoveryEmail } from '@api/resources/password';
import { Button, FormInput } from '@components/ui';

// Conservative email shape check — the server is the source of truth, this just
// catches obvious typos before submit. Mirrors CreateUserModal's EMAIL_RE.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PwErrors {
  current?: string | undefined;
  new?: string | undefined;
  confirm?: string | undefined;
}

/**
 * `/account` — authenticated self-service for password + recovery email. Lives
 * directly under the `<AppLayout />` layout route (not under `/settings`) so any
 * authenticated role (incl. viewer/advertiser) can change their own password.
 *
 * Changing the password revokes every backend session, so on success we log the
 * user out and bounce to `/login` with a toast. The recovery-email section is
 * independent and stays on the page.
 */
export const AccountPage = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const currentRef = useRef<HTMLInputElement>(null);

  // --- Change password ---
  const [current, setCurrent] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErrors, setPwErrors] = useState<PwErrors>({});
  const [pwFormError, setPwFormError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // --- Recovery email --- prefilled from /api/me; resync if the profile loads
  // late, but never clobber a value the user has started editing.
  const [email, setEmail] = useState(user?.profile?.email ?? '');
  const [emailDirty, setEmailDirty] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!emailDirty) setEmail(user?.profile?.email ?? '');
  }, [user?.profile?.email, emailDirty]);

  // Map a rejected change-password call onto the inputs. `fieldErrors` (mismatch
  // / policy) land on the matching input; a message-only 400 is either the
  // "must differ" case (new field) or a wrong current password (current field,
  // backend message verbatim). A 5xx/network error with no usable message falls
  // back to a localized form-level line.
  const applyPasswordErrors = (err: unknown): void => {
    const fieldErrors = extractFieldErrors(err);
    const next: PwErrors = {};
    if (fieldErrors.currentPassword?.[0] !== undefined) next.current = fieldErrors.currentPassword[0];
    if (fieldErrors.newPassword?.[0] !== undefined) next.new = fieldErrors.newPassword[0];
    if (fieldErrors.confirmPassword?.[0] !== undefined) next.confirm = fieldErrors.confirmPassword[0];

    const mappedField = next.current ?? next.new ?? next.confirm;
    if (mappedField === undefined) {
      const message = extractApiMessage(err);
      if (message !== null && /differ/i.test(message)) {
        next.new = t('accountPage.errMustDiffer');
      } else if (message !== null) {
        next.current = message;
      } else {
        setPwFormError(t('accountPage.errGeneric'));
      }
    }
    setPwErrors(next);
  };

  const submitPassword = async (): Promise<void> => {
    const errs: PwErrors = {};
    if (current === '') errs.current = t('accountPage.errCurrentRequired');
    if (newPassword === '') errs.new = t('accountPage.errNewRequired');
    else if (newPassword.length < 8) errs.new = t('accountPage.errNewTooShort');
    if (confirm === '') errs.confirm = t('accountPage.errConfirmRequired');
    else if (confirm !== newPassword) errs.confirm = t('accountPage.errConfirmMismatch');
    setPwErrors(errs);
    setPwFormError(null);
    if (errs.current !== undefined || errs.new !== undefined || errs.confirm !== undefined) return;

    setPwSubmitting(true);
    try {
      await changePassword({
        currentPassword: current,
        newPassword,
        confirmPassword: confirm,
      });
    } catch (err) {
      // Keep it off the global modal — this page renders the error inline.
      markErrorHandled(err);
      applyPasswordErrors(err);
      setPwSubmitting(false);
      return;
    }
    // Backend revoked every session; mirror that on the client and re-auth.
    notify.success(t('accountPage.toastChanged'));
    // `logout()` -> `logoutServer()` clears the token in a `finally` but can
    // still reject on a network/5xx; swallow that so we always land on /login
    // (the local session is gone either way) rather than stranding the user.
    try {
      await logout();
    } catch {
      // token already cleared in logoutServer's finally — nothing else to do
    }
    navigate('/login', { replace: true });
  };

  const applyEmailError = (err: unknown): void => {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      setEmailError(t('accountPage.errEmailInUse'));
      return;
    }
    const fieldErrors = extractFieldErrors(err);
    if (fieldErrors.email?.[0] !== undefined) {
      setEmailError(fieldErrors.email[0]);
      return;
    }
    setEmailError(extractApiMessage(err) ?? t('accountPage.errGeneric'));
  };

  const submitEmail = async (): Promise<void> => {
    const trimmed = email.trim();
    // Blank clears the recovery email; a non-blank value must look like an email.
    if (trimmed !== '' && !EMAIL_RE.test(trimmed)) {
      setEmailError(t('accountPage.errEmailInvalid'));
      return;
    }
    setEmailError(null);
    setEmailSubmitting(true);
    try {
      await setRecoveryEmail(trimmed);
      notify.success(t('accountPage.toastEmailSaved'));
      setEmailDirty(false);
    } catch (err) {
      markErrorHandled(err);
      applyEmailError(err);
    } finally {
      setEmailSubmitting(false);
    }
  };

  const onPasswordSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void submitPassword();
  };

  const onEmailSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void submitEmail();
  };

  return (
    <div className="oa-account">
      <header className="oa-account__header">
        <h2>{t('accountPage.title')}</h2>
      </header>

      <section className="oa-card oa-account__section">
        <h3 className="oa-account__section-title">{t('accountPage.sectionPassword')}</h3>
        <form className="oa-settings-form" onSubmit={onPasswordSubmit} noValidate>
          {pwFormError !== null && (
            <p className="oa-account__error" role="alert">
              {pwFormError}
            </p>
          )}

          <FormInput
            ref={currentRef}
            label={t('accountPage.labelCurrent')}
            type="password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              if (pwErrors.current !== undefined) setPwErrors((p) => ({ ...p, current: undefined }));
            }}
            error={pwErrors.current}
            autoComplete="current-password"
            required
            disabled={pwSubmitting}
          />

          <FormInput
            label={t('accountPage.labelNew')}
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (pwErrors.new !== undefined) setPwErrors((p) => ({ ...p, new: undefined }));
            }}
            error={pwErrors.new}
            hint={t('accountPage.hintPassword')}
            autoComplete="new-password"
            minLength={8}
            required
            disabled={pwSubmitting}
          />

          <FormInput
            label={t('accountPage.labelConfirm')}
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (pwErrors.confirm !== undefined) setPwErrors((p) => ({ ...p, confirm: undefined }));
            }}
            error={pwErrors.confirm}
            autoComplete="new-password"
            minLength={8}
            required
            disabled={pwSubmitting}
          />

          <div className="oa-account__actions">
            <Button type="submit" variant="primary" isLoading={pwSubmitting} disabled={pwSubmitting}>
              {t('accountPage.submitPassword')}
            </Button>
          </div>
        </form>
      </section>

      <section className="oa-card oa-account__section">
        <h3 className="oa-account__section-title">{t('accountPage.sectionEmail')}</h3>
        <form className="oa-settings-form" onSubmit={onEmailSubmit} noValidate>
          <FormInput
            label={t('accountPage.labelEmail')}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailDirty(true);
              if (emailError !== null) setEmailError(null);
            }}
            error={emailError ?? undefined}
            hint={t('accountPage.hintEmail')}
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            disabled={emailSubmitting}
          />

          <div className="oa-account__actions">
            <Button
              type="submit"
              variant="primary"
              isLoading={emailSubmitting}
              disabled={emailSubmitting}
            >
              {t('accountPage.submitEmail')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
};
