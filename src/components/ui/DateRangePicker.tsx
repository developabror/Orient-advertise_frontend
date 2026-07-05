import { useId, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface DateRange {
  readonly start: string | null;
  readonly end: string | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (next: DateRange) => void;
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}

export const DateRangePicker = ({
  value,
  onChange,
  label,
  min,
  max,
  disabled = false,
}: DateRangePickerProps) => {
  const { t } = useTranslation();
  const baseId = useId();
  const startId = `${baseId}-start`;
  const endId = `${baseId}-end`;

  const onStart = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value || null;
    let nextEnd = value.end;
    if (next !== null && nextEnd !== null && nextEnd < next) nextEnd = next;
    onChange({ start: next, end: nextEnd });
  };

  const onEnd = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value || null;
    onChange({ start: value.start, end: next });
  };

  return (
    <div className="oa-date-range">
      {label !== undefined && <span className="oa-date-range__label">{label}</span>}
      <div className="oa-date-range__inputs">
        <input
          type="date"
          id={startId}
          className="oa-field__input"
          aria-label={t('uiDateRangePicker.startDate')}
          value={value.start ?? ''}
          min={min}
          max={value.end ?? max}
          onChange={onStart}
          disabled={disabled}
        />
        <span className="oa-date-range__sep" aria-hidden="true">
          –
        </span>
        <input
          type="date"
          id={endId}
          className="oa-field__input"
          aria-label={t('uiDateRangePicker.endDate')}
          value={value.end ?? ''}
          min={value.start ?? min}
          max={max}
          onChange={onEnd}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
