import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner';
import { Button } from './Button';

export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  readonly meta?: string;
}

interface Props {
  label: string;
  options: readonly SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  error?: string | undefined;
  onRetry?: () => void;
  emptyText?: string;
  disabled?: boolean;
}

export const SearchableSelect = ({
  label,
  options,
  value,
  onChange,
  placeholder,
  isLoading = false,
  error,
  onRetry,
  emptyText,
  disabled = false,
}: Props) => {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t('uiSearchableSelect.searchPlaceholder');
  const emptyTextResolved = emptyText ?? t('uiSearchableSelect.noMatches');
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered =
    isLoading || error !== undefined
      ? []
      : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  // Reset cursor when filter changes — keeps Enter from selecting a stale row.
  useEffect(() => {
    setHighlightedIdx(0);
  }, [query, isOpen]);

  // Clear the query each time the dropdown closes so the next open starts
  // fresh and shows the selected label.
  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  // Keep highlighted option in view inside the scrollable list.
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${String(highlightedIdx)}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx, isOpen]);

  const inputDisplay = isOpen ? query : (selected?.label ?? '');

  const selectAt = (idx: number): void => {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.value);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (filtered.length > 0) {
        setHighlightedIdx((idx) => (idx + 1) % filtered.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        setHighlightedIdx((idx) => (idx - 1 + filtered.length) % filtered.length);
      }
    } else if (e.key === 'Home') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIdx(0);
      }
    } else if (e.key === 'End') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIdx(filtered.length - 1);
      }
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault();
        selectAt(highlightedIdx);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    } else if (e.key === 'Tab') {
      // Don't preventDefault — let focus move naturally; just close the panel.
      setIsOpen(false);
    }
  };

  const onChangeInput = (e: ChangeEvent<HTMLInputElement>): void => {
    setQuery(e.target.value);
    if (!isOpen) setIsOpen(true);
  };

  // setTimeout so click-on-option fires before blur closes the panel.
  const onBlurInput = (): void => {
    window.setTimeout(() => {
      setIsOpen(false);
    }, 120);
  };

  const onFocusInput = (): void => {
    if (disabled) return;
    setIsOpen(true);
  };

  const activeOptionId =
    isOpen && filtered[highlightedIdx] !== undefined
      ? `${listboxId}-${String(highlightedIdx)}`
      : undefined;

  return (
    <div className="oa-field oa-searchable">
      <label htmlFor={inputId} className="oa-field__label">
        {label}
      </label>
      <div className="oa-searchable__wrap">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          className="oa-field__input oa-searchable__input"
          value={inputDisplay}
          onChange={onChangeInput}
          onFocus={onFocusInput}
          onBlur={onBlurInput}
          onKeyDown={onKeyDown}
          placeholder={placeholderText}
          disabled={disabled}
        />
        {isOpen && (
          <div className="oa-searchable__panel">
            {isLoading ? (
              <div className="oa-searchable__state">
                <Spinner size="sm" label={t('uiSearchableSelect.loading')} />
                <span>{t('uiSearchableSelect.loadingEllipsis')}</span>
              </div>
            ) : error !== undefined ? (
              <div className="oa-searchable__state oa-searchable__state--error" role="alert">
                <p>{error}</p>
                {onRetry !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onMouseDown={(e) => {
                      // Keep focus on the input so the panel stays open during retry.
                      e.preventDefault();
                    }}
                    onClick={onRetry}
                  >
                    {t('uiSearchableSelect.retry')}
                  </Button>
                )}
              </div>
            ) : filtered.length === 0 ? (
              <div className="oa-searchable__state oa-searchable__state--empty">{emptyTextResolved}</div>
            ) : (
              <ul ref={listRef} id={listboxId} role="listbox" className="oa-searchable__list">
                {filtered.map((opt, i) => (
                  <li
                    key={opt.value}
                    id={`${listboxId}-${String(i)}`}
                    role="option"
                    aria-selected={opt.value === value}
                    data-idx={i}
                    className={`oa-searchable__option${
                      i === highlightedIdx ? ' oa-searchable__option--active' : ''
                    }`}
                    onMouseDown={(e) => {
                      // Prevent the input blur so click registers as a selection.
                      e.preventDefault();
                      selectAt(i);
                    }}
                    onMouseEnter={() => {
                      setHighlightedIdx(i);
                    }}
                  >
                    <span className="oa-searchable__option-label">{opt.label}</span>
                    {opt.meta !== undefined && (
                      <span className="oa-searchable__option-meta">{opt.meta}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
