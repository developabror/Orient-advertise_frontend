import { forwardRef, useId, type InputHTMLAttributes, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  isSearching?: boolean;
  onClear?: () => void;
  hint?: string;
}

export const SearchInput = forwardRef(function SearchInput(
  { label, isSearching = false, onClear, hint, id, value, className, ...rest }: SearchInputProps,
  ref: Ref<HTMLInputElement>,
) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const hasValue = typeof value === 'string' && value !== '';
  const showSpinner = isSearching && hasValue;
  const showClear = !showSpinner && hasValue && onClear !== undefined;

  return (
    <div className={`oa-field oa-search${className !== undefined ? ' ' + className : ''}`}>
      <label htmlFor={inputId} className="oa-field__label">
        {label}
      </label>
      <div className="oa-search__wrap">
        <input
          ref={ref}
          id={inputId}
          type="search"
          value={value}
          aria-describedby={hint !== undefined ? hintId : undefined}
          className="oa-field__input oa-search__input"
          {...rest}
        />
        {showSpinner && (
          <span className="oa-search__indicator" aria-hidden="true">
            <Spinner size="sm" label={t('uiSearchInput.searching')} />
          </span>
        )}
        {showClear && (
          <button
            type="button"
            className="oa-search__clear"
            aria-label={t('uiSearchInput.clearSearch')}
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="oa-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
});
