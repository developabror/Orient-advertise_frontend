import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { useAuth } from '@hooks/useAuth';
import { markErrorHandled } from '@api/errorDialog';
import { Button, FormInput } from '@components/ui';
import { ThemeToggle } from '@components/ThemeToggle';
import { LanguageSwitcher } from '@components/LanguageSwitcher';

const sanitizeRedirect = (raw: string | null): string => {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
};

// Surface the backend's 401 envelope message verbatim — operators see things
// like "Account is locked" / "Account is disabled" instead of a misleading
// "Invalid username or password." A 429 (too many attempts) gets its own clear
// message rather than collapsing to the generic credential error. 5xx/network
// errors collapse to the generic message so internal detail never leaks. The
// generic/rate-limited strings are localized; the backend's verbatim message is
// passed through untranslated (it's server-controlled, not a fixed catalog).
const extractLoginError = (err: unknown, t: TFunction): string => {
  const generic = t('login.errorInvalid');
  if (!axios.isAxiosError(err)) return generic;
  const status = err.response?.status;
  if (status === 429) return t('login.errorRateLimited');
  if (status !== 401) return generic;
  const data: unknown = err.response?.data;
  if (typeof data !== 'object' || data === null) return generic;
  const msg = (data as Record<string, unknown>).message;
  return typeof msg === 'string' && msg.length > 0 ? msg : generic;
};

export const LoginPage = () => {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirect = sanitizeRedirect(params.get('redirect'));

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  if (user) {
    return <Navigate to={redirect} replace />;
  }

  const submit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate(redirect, { replace: true });
    } catch (err) {
      // Login errors belong on the form, never in the global modal — claim it
      // (a 401/429 is excluded already; this covers a stray 400/422).
      markErrorHandled(err);
      // Drop the password so a stale value isn't re-submitted.
      setError(extractLoginError(err, t));
      setPassword('');
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
      <form className="oa-login__card" onSubmit={onSubmit} aria-label={t('login.ariaLabel')}>
        <h1 className="oa-login__title">{t('login.title')}</h1>

        <FormInput
          ref={usernameRef}
          label={t('login.username')}
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={submitting}
        />

        <FormInput
          label={t('login.password')}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          autoComplete="current-password"
          required
          disabled={submitting}
        />

        <Link to="/forgot-password" className="oa-login__forgot">
          {t('login.forgotPassword')}
        </Link>

        {error !== null && (
          <p className="oa-login__error" role="alert">
            {error}
          </p>
        )}

        <div className="oa-login__actions">
          <Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>
            {submitting ? t('login.signingIn') : t('login.signIn')}
          </Button>
        </div>
      </form>
    </div>
  );
};
