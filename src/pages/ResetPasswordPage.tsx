import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { extractApiMessage, extractFieldErrors } from '@api';
import { notify } from '@api/notify';
import { markErrorHandled } from '@api/errorDialog';
import { resetPassword, validateResetToken } from '@api/resources/password';
import { Button, FormInput, Spinner } from '@components/ui';
import { ThemeToggle } from '@components/ThemeToggle';
import { LanguageSwitcher } from '@components/LanguageSwitcher';

type Status = 'validating' | 'valid' | 'invalid';

interface ResetErrors {
  new?: string | undefined;
  confirm?: string | undefined;
}

/**
 * `/reset-password?token=…` (public), reached from the emailed link. We gate the
 * form behind a token check: no token or a `validateResetToken` miss (incl. a
 * 429) shows the "invalid or expired" state with a link to request a new one. A
 * valid token shows the new/confirm form; a 400 on submit that names an
 * expired/invalid token flips back to the invalid state, otherwise field/policy
 * errors land on the inputs.
 */
export const ResetPasswordPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = useState<Status>(token !== null && token !== '' ? 'validating' : 'invalid');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<ResetErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const newRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token === null || token === '') return;
    const controller = new AbortController();
    void (async () => {
      const ok = await validateResetToken(token);
      // Ignore a late resolve after the token changed / the page unmounted.
      if (!controller.signal.aborted) setStatus(ok ? 'valid' : 'invalid');
    })();
    return () => {
      controller.abort();
    };
  }, [token]);

  useEffect(() => {
    if (status === 'valid') newRef.current?.focus();
  }, [status]);

  const submit = async (): Promise<void> => {
    if (token === null || token === '') {
      setStatus('invalid');
      return;
    }
    const errs: ResetErrors = {};
    if (newPassword === '') errs.new = t('resetPasswordPage.errNewRequired');
    else if (newPassword.length < 8) errs.new = t('resetPasswordPage.errNewTooShort');
    if (confirm !== newPassword) errs.confirm = t('resetPasswordPage.errConfirmMismatch');
    setErrors(errs);
    setFormError(null);
    if (errs.new !== undefined || errs.confirm !== undefined) return;

    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword, confirmPassword: confirm });
    } catch (err) {
      markErrorHandled(err);
      setSubmitting(false);
      const isBadRequest = axios.isAxiosError(err) && err.response?.status === 400;
      const message = extractApiMessage(err);
      if (isBadRequest && message !== null && /(invalid|expired)/i.test(message)) {
        setStatus('invalid');
        return;
      }
      if (isBadRequest) {
        const fieldErrors = extractFieldErrors(err);
        const next: ResetErrors = {};
        if (fieldErrors.newPassword?.[0] !== undefined) next.new = fieldErrors.newPassword[0];
        if (fieldErrors.confirmPassword?.[0] !== undefined) next.confirm = fieldErrors.confirmPassword[0];
        if (next.new === undefined && next.confirm === undefined) {
          setFormError(message ?? t('resetPasswordPage.errGeneric'));
        }
        setErrors(next);
        return;
      }
      setFormError(t('resetPasswordPage.errGeneric'));
      return;
    }
    notify.success(t('resetPasswordPage.toastReset'));
    navigate('/login', { replace: true });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void submit();
  };

  return (
    <div className="oa-login">
      <div className="oa-login__theme">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="oa-login__card">
        {status === 'validating' && (
          <div className="oa-auth__pending">
            <Spinner label={t('resetPasswordPage.validating')} />
            <p className="oa-auth__subtitle">{t('resetPasswordPage.validating')}</p>
          </div>
        )}

        {status === 'invalid' && (
          <>
            <h1 className="oa-login__title">{t('resetPasswordPage.invalidTitle')}</h1>
            <p className="oa-auth__message" role="alert">
              {t('resetPasswordPage.invalid')}
            </p>
            <div className="oa-login__actions">
              <Link to="/forgot-password" className="oa-auth__back">
                {t('resetPasswordPage.requestNew')}
              </Link>
            </div>
          </>
        )}

        {status === 'valid' && (
          <form onSubmit={onSubmit} aria-label={t('resetPasswordPage.title')} noValidate>
            <h1 className="oa-login__title">{t('resetPasswordPage.title')}</h1>

            <FormInput
              ref={newRef}
              label={t('resetPasswordPage.labelNew')}
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (errors.new !== undefined) setErrors((p) => ({ ...p, new: undefined }));
              }}
              error={errors.new}
              hint={t('resetPasswordPage.hintPassword')}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={submitting}
            />

            <FormInput
              label={t('resetPasswordPage.labelConfirm')}
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (errors.confirm !== undefined) setErrors((p) => ({ ...p, confirm: undefined }));
              }}
              error={errors.confirm}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={submitting}
            />

            {formError !== null && (
              <p className="oa-login__error" role="alert">
                {formError}
              </p>
            )}

            <div className="oa-login__actions">
              <Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>
                {t('resetPasswordPage.submit')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
