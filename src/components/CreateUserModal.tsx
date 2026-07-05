import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, FormInput, Modal, Select } from './ui';
import { CreateUserFailure, type CreateUserInput } from '@hooks/useUsers';
import type { Role } from '@api/auth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: CreateUserInput) => Promise<void>;
}

interface FieldErrors {
  name?: string;
  email?: string;
  role?: string;
  password?: string;
}

const ROLE_VALUES = ['admin', 'operator', 'advertiser'] as const;

// Conservative email shape check — server is the source of truth, this just
// catches obvious typos before submit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validate = (
  t: TFunction,
  name: string,
  email: string,
  role: string,
  password: string,
): FieldErrors => {
  const errors: FieldErrors = {};
  if (name.trim() === '') errors.name = t('createUserModal.errNameRequired');
  if (email === '') errors.email = t('createUserModal.errEmailRequired');
  else if (!EMAIL_RE.test(email)) errors.email = t('createUserModal.errEmailInvalid');
  if (role === '') errors.role = t('createUserModal.errRoleRequired');
  if (password.length < 8) errors.password = t('createUserModal.errPasswordLength');
  return errors;
};

export const CreateUserModal = ({ isOpen, onClose, onCreate }: Props) => {
  const { t } = useTranslation();
  const roleOptions = ROLE_VALUES.map((value) => ({
    value,
    label: t(`createUserModal.role_${value}`),
  }));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  // Reset form whenever the modal reopens — leftover state from a prior
  // (cancelled) submit shouldn't leak into the next session.
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setEmail('');
    setRole('');
    setPassword('');
    setFieldErrors({});
    setGeneralError(null);
    setSubmitting(false);
    // Wait one tick so the modal mounts before we focus.
    const id = window.setTimeout(() => {
      nameRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [isOpen]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (submitting) return;
    const errors = validate(t, name, email, role, password);
    setFieldErrors(errors);
    setGeneralError(null);
    if (Object.keys(errors).length > 0 || role === '') return;

    setSubmitting(true);
    void (async () => {
      try {
        await onCreate({ name: name.trim(), email: email.trim(), role, password });
        // Parent closes the modal on success.
      } catch (err: unknown) {
        if (err instanceof CreateUserFailure) {
          if (err.detail.code === 'EMAIL_TAKEN') {
            setFieldErrors({ email: err.detail.message });
            // Re-focus the offending field for fast correction.
            window.setTimeout(() => {
              emailRef.current?.focus();
              emailRef.current?.select();
            }, 0);
          } else {
            setGeneralError(err.detail.message);
          }
        } else {
          setGeneralError(t('createUserModal.errGeneric'));
        }
        setSubmitting(false);
      }
    })();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title={t('createUserModal.title')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('createUserModal.cancel')}
          </Button>
          <Button type="submit" form="oa-create-user-form" variant="primary" isLoading={submitting}>
            {t('createUserModal.submit')}
          </Button>
        </>
      }
    >
      <form id="oa-create-user-form" className="oa-create-user-form" onSubmit={onSubmit} noValidate>
        {generalError !== null && (
          <p className="oa-create-user-form__general-error" role="alert">
            {generalError}
          </p>
        )}

        <FormInput
          ref={nameRef}
          label={t('createUserModal.labelName')}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          error={fieldErrors.name}
          autoComplete="name"
          maxLength={120}
          required
        />

        <FormInput
          ref={emailRef}
          label={t('createUserModal.labelEmail')}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // Clear any prior server-side email error as the user re-types.
            if (fieldErrors.email !== undefined) {
              setFieldErrors((prev) => {
                const { email: _ignored, ...rest } = prev;
                return rest;
              });
            }
          }}
          error={fieldErrors.email}
          autoComplete="off"
          inputMode="email"
          maxLength={254}
          required
        />

        <Select
          label={t('createUserModal.labelRole')}
          options={roleOptions}
          value={role}
          onChange={(e) => {
            const next = e.target.value;
            if (next === '' || next === 'admin' || next === 'operator' || next === 'advertiser') {
              setRole(next);
            }
          }}
          error={fieldErrors.role}
          placeholder={t('createUserModal.placeholderRole')}
        />

        <FormInput
          label={t('createUserModal.labelPassword')}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          error={fieldErrors.password}
          hint={t('createUserModal.hintPassword')}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </form>
    </Modal>
  );
};
