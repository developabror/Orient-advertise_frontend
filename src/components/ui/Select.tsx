import { forwardRef, useId, type Ref, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: readonly SelectOption[];
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
}

export const Select = forwardRef(function Select(
  { label, options, error, hint, id, className, placeholder, ...rest }: SelectProps,
  ref: Ref<HTMLSelectElement>,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const hintId = `${selectId}-hint`;
  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((v): v is string => v !== null)
      .join(' ') || undefined;

  const wrapperClasses = ['oa-field', error !== undefined ? 'oa-field--error' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <label htmlFor={selectId} className="oa-field__label">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        className="oa-field__select"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
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
