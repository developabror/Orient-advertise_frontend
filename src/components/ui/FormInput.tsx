import { forwardRef, useId, type InputHTMLAttributes, type Ref } from 'react';

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  // Explicit `| undefined` so callers under exactOptionalPropertyTypes can
  // pass `error={maybeString}` without spreading guards everywhere.
  error?: string | undefined;
  hint?: string | undefined;
}

export const FormInput = forwardRef(function FormInput(
  { label, error, hint, id, className, ...rest }: FormInputProps,
  ref: Ref<HTMLInputElement>,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((v): v is string => v !== null)
      .join(' ') || undefined;

  const wrapperClasses = ['oa-field', error !== undefined ? 'oa-field--error' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <label htmlFor={inputId} className="oa-field__label">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className="oa-field__input"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint !== undefined && error === undefined && (
        <p id={hintId} className="oa-field__hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="oa-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
