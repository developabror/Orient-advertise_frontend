import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { requestPasswordReset } from '@api/resources/password';
import { Button, FormInput } from '@components/ui';
import { ThemeToggle } from '@components/ThemeToggle';
import { LanguageSwitcher } from '@components/LanguageSwitcher';

// Conservative email shape check — matches the rest of the app's client-side
// validation. The backend is the source of truth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `/forgot-password` (public). One email field. On submit we always switch to
 * the same neutral "if an account exists, we sent a link" confirmation — even on
 * a network error — so the page never reveals whether the email matched (no
 * account enumeration). A 429 is the only distinct case: it keeps the form up
 * with a "too many attempts" notice so the user can retry later.
 */
export const ForgotPasswordPage = () => {
  const { t } = useTranslation();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    const trimmed = email.trim();
    if (trimmed === '') {
      setError(t('forgotPasswordPage.errEmailRequired'));
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setError(t('forgotPasswordPage.errEmailInvalid'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(trimmed);
      setSent(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        setError(t('forgotPasswordPage.errRateLimited'));
      } else {
        // Any other outcome (network drop, 5xx, …) still shows the neutral
        // confirmation — never leak whether the address exists.
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
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
        <h1 className="oa-login__title">{t('forgotPasswordPage.title')}</h1>

        {sent ? (
          <>
            <p className="oa-auth__message" role="status">
              {t('forgotPasswordPage.sent')}
            </p>
            <div className="oa-login__actions">
              <Link to="/login" className="oa-auth__back">
                {t('forgotPasswordPage.backToLogin')}
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} aria-label={t('forgotPasswordPage.title')} noValidate>
            <p className="oa-auth__subtitle">{t('forgotPasswordPage.subtitle')}</p>

            <FormInput
              ref={emailRef}
              label={t('forgotPasswordPage.labelEmail')}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error !== null) setError(null);
              }}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              disabled={submitting}
            />

            {error !== null && (
              <p className="oa-login__error" role="alert">
                {error}
              </p>
            )}

            <div className="oa-login__actions">
              <Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>
                {t('forgotPasswordPage.submit')}
              </Button>
            </div>

            <Link to="/login" className="oa-auth__back">
              {t('forgotPasswordPage.backToLogin')}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};
