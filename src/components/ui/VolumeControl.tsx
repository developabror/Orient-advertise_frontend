import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

interface VolumeControlProps {
  /** Current/seed volume (0–100). Re-seeds the draft when it changes. */
  value: number;
  /** Invoked with the clamped draft when the operator hits Apply. */
  onApply: (v: number) => Promise<void> | void;
  disabled?: boolean;
  /** Externally-driven busy state (e.g. parent is awaiting a refetch). */
  busy?: boolean;
}

// Volume is always an integer 0–100. Clamp every edit before it can be applied
// so an out-of-range typed value (e.g. 150) is corrected, never sent raw.
const clamp = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

export const VolumeControl = ({
  value,
  onApply,
  disabled = false,
  busy = false,
}: VolumeControlProps) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<number>(clamp(value));
  const [pending, setPending] = useState(false);

  // Re-seed when the upstream value changes (e.g. after Apply refetches).
  useEffect(() => {
    setDraft(clamp(value));
  }, [value]);

  const isBusy = busy || pending;
  const changed = draft !== clamp(value);
  const locked = disabled || isBusy;

  const handleApply = (): void => {
    const result = onApply(draft);
    if (result instanceof Promise) {
      setPending(true);
      void result.finally(() => {
        setPending(false);
      });
    }
  };

  return (
    <div className="oa-volume">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft}
        disabled={locked}
        onChange={(e) => {
          setDraft(clamp(Number(e.target.value)));
        }}
        className="oa-volume__range"
        aria-label={t('uiVolumeControl.label')}
      />
      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        disabled={locked}
        onChange={(e) => {
          setDraft(clamp(Number(e.target.value)));
        }}
        className="oa-volume__number"
        aria-label={t('uiVolumeControl.label')}
      />
      <span className="oa-volume__unit">%</span>
      <Button
        variant="cta"
        size="sm"
        onClick={handleApply}
        disabled={locked || !changed}
        isLoading={isBusy}
      >
        {t('uiVolumeControl.apply')}
      </Button>
    </div>
  );
};
