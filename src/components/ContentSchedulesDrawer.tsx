import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge, type BadgeVariant } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Spinner } from './ui/Spinner';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import {
  useContentSchedules,
  type ContentSchedule,
  type ScheduleInput,
} from '@hooks/useContentSchedules';
import { formatTashkent, tashkentLocalToUTC, utcToTashkentLocal } from '@/lib/timezone';

interface Props {
  isOpen: boolean;
  /**
   * Content row this drawer was opened from. Used only for the title /
   * empty-state copy — the schedule list is keyed off `assignmentId`,
   * not `contentId` (schedules attach to assignments, not directly to
   * content).
   */
  contentId: string | null;
  /**
   * Assignment whose schedules this drawer should list. When `null` the
   * list stays empty — the caller is responsible for resolving the
   * active assignment for `contentId` before opening the drawer.
   */
  assignmentId: number | null;
  contentFilename?: string | undefined;
  onClose: () => void;
}

// Tashkent ↔ UTC conversion + display formatting now live in @/lib/timezone,
// shared with AssignContentDrawer so the two never drift.

type ScheduleStatus = 'upcoming' | 'active' | 'expired' | 'open';

const computeStatus = (s: ContentSchedule, nowMs: number): ScheduleStatus => {
  const start = s.startAt !== null ? new Date(s.startAt).getTime() : null;
  const end = s.endAt !== null ? new Date(s.endAt).getTime() : null;
  if (end !== null && end <= nowMs) return 'expired';
  if (start !== null && start > nowMs) return 'upcoming';
  if (start === null && end === null) return 'open';
  return 'active';
};

const STATUS_BADGE: Record<ScheduleStatus, BadgeVariant> = {
  active: 'success',
  upcoming: 'info',
  open: 'info',
  expired: 'neutral',
};

const statusLabel = (t: TFunction, status: ScheduleStatus): string =>
  t(`contentSchedulesDrawer.status_${status}`);

interface RangeSpec {
  readonly startAt: string | null;
  readonly endAt: string | null;
}

const overlapsAny = (
  candidate: RangeSpec,
  others: readonly ContentSchedule[],
  excludeId?: string,
): boolean => {
  const cStart = candidate.startAt !== null ? new Date(candidate.startAt).getTime() : -Infinity;
  const cEnd = candidate.endAt !== null ? new Date(candidate.endAt).getTime() : Infinity;
  for (const s of others) {
    if (excludeId !== undefined && s.id === excludeId) continue;
    const sStart = s.startAt !== null ? new Date(s.startAt).getTime() : -Infinity;
    const sEnd = s.endAt !== null ? new Date(s.endAt).getTime() : Infinity;
    if (cStart < sEnd && sStart < cEnd) return true;
  }
  return false;
};

interface ScheduleFormProps {
  initial: ContentSchedule | null;
  others: readonly ContentSchedule[];
  onSubmit: (input: ScheduleInput) => Promise<void>;
  onCancel: () => void;
}

const ScheduleForm = ({ initial, others, onSubmit, onCancel }: ScheduleFormProps) => {
  const { t } = useTranslation();
  // Stored in Tashkent local format (what the input expects/emits).
  const [startAt, setStartAt] = useState(
    initial?.startAt !== null && initial?.startAt !== undefined
      ? utcToTashkentLocal(initial.startAt)
      : '',
  );
  const [endAt, setEndAt] = useState(
    initial?.endAt !== null && initial?.endAt !== undefined
      ? utcToTashkentLocal(initial.endAt)
      : '',
  );
  const [submitting, setSubmitting] = useState(false);

  // Disable past dates in the calendar — fresh on each render so it tracks
  // wall-clock time without drifting.
  const minDateLocal = utcToTashkentLocal(new Date().toISOString());

  const orderError = useMemo((): string | null => {
    if (startAt === '' || endAt === '') return null;
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return t('contentSchedulesDrawer.endAfterStart');
    }
    return null;
  }, [startAt, endAt, t]);

  const candidate: RangeSpec = useMemo(
    () => ({
      startAt: startAt !== '' ? tashkentLocalToUTC(startAt) : null,
      endAt: endAt !== '' ? tashkentLocalToUTC(endAt) : null,
    }),
    [startAt, endAt],
  );

  const overlapWarning = useMemo(
    () => overlapsAny(candidate, others, initial?.id),
    [candidate, others, initial],
  );

  const canSave = orderError === null && !submitting;

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    void (async () => {
      try {
        // Spec ScheduleInput requires { assignmentId, startTimeUtc, endTimeUtc,
        // repeatType, repeatEndUtc? }. The drawer has no assignment context
        // yet — assignmentId=0 is a placeholder; the backend will reject if
        // it's invalid. RepeatType defaults to NONE (single-shot range).
        await onSubmit({
          assignmentId: 0,
          startTimeUtc: candidate.startAt ?? new Date().toISOString(),
          endTimeUtc: candidate.endAt ?? new Date().toISOString(),
          repeatType: 'NONE',
        });
        // Parent dismisses the form on success.
      } catch (err: unknown) {
        // Prefer the backend's specific reason (overlap, invalid window, …) and
        // claim the error so the global modal doesn't double up. When there's no
        // envelope message (network/5xx), let the interceptor's generic toast
        // handle it rather than masking it with a vague string.
        const msg = extractApiMessage(err);
        if (msg !== null) {
          markErrorHandled(err);
          notify.error(msg);
        }
        setSubmitting(false);
      }
    })();
  };

  return (
    <form className="oa-schedules__form" onSubmit={handleSubmit}>
      <p className="oa-schedules__form-hint">{t('contentSchedulesDrawer.allTimesTashkent')}</p>
      <div className="oa-schedules__form-fields">
        <div className="oa-field">
          <label htmlFor="oa-sched-start" className="oa-field__label">
            {t('contentSchedulesDrawer.start')}
          </label>
          <input
            id="oa-sched-start"
            type="datetime-local"
            className="oa-field__input"
            value={startAt}
            min={minDateLocal}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setStartAt(e.target.value);
            }}
            disabled={submitting}
          />
        </div>
        <div className="oa-field">
          <label htmlFor="oa-sched-end" className="oa-field__label">
            {t('contentSchedulesDrawer.end')}
          </label>
          <input
            id="oa-sched-end"
            type="datetime-local"
            className="oa-field__input"
            value={endAt}
            min={startAt !== '' ? startAt : minDateLocal}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setEndAt(e.target.value);
            }}
            disabled={submitting}
          />
        </div>
      </div>

      {orderError !== null && (
        <p className="oa-schedules__form-error" role="alert">
          {orderError}
        </p>
      )}

      {orderError === null && overlapWarning && (
        <p className="oa-schedules__form-warning" role="status">
          {t('contentSchedulesDrawer.overlapWarning')}
        </p>
      )}

      <div className="oa-schedules__form-actions">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={submitting}>
          {t('contentSchedulesDrawer.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!canSave} isLoading={submitting}>
          {initial !== null
            ? t('contentSchedulesDrawer.saveChanges')
            : t('contentSchedulesDrawer.createSchedule')}
        </Button>
      </div>
    </form>
  );
};

export const ContentSchedulesDrawer = ({
  isOpen,
  contentId,
  assignmentId,
  contentFilename,
  onClose,
}: Props) => {
  // Mark contentId as intentionally unused at the data-fetch level — it's
  // here for the title and to keep the open/close gate keyed to a content
  // row. The fetch is keyed off assignmentId.
  void contentId;
  const { t } = useTranslation();
  const { schedules, isLoading, error, retry, create, update, remove } = useContentSchedules(
    isOpen ? assignmentId : null,
  );

  type FormMode =
    | { kind: 'closed' }
    | { kind: 'new' }
    | { kind: 'edit'; schedule: ContentSchedule };
  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Reset transient state on close so the next open is clean.
  useEffect(() => {
    if (!isOpen) {
      setFormMode({ kind: 'closed' });
      setConfirmDeleteId(null);
    }
  }, [isOpen]);

  // Pinned to render time — render is cheap, and this keeps schedule status
  // labels honest as time advances rather than going stale until the next fetch.
  const nowMs = Date.now();

  const sorted = useMemo(() => {
    return [...schedules].sort((a, b) => {
      const aS = a.startAt !== null ? new Date(a.startAt).getTime() : -Infinity;
      const bS = b.startAt !== null ? new Date(b.startAt).getTime() : -Infinity;
      return aS - bS;
    });
  }, [schedules]);

  const handleCreate = async (input: ScheduleInput): Promise<void> => {
    await create(input);
    notify.success(t('contentSchedulesDrawer.toastCreated'));
    setFormMode({ kind: 'closed' });
  };

  const handleUpdate = async (id: string, input: ScheduleInput): Promise<void> => {
    await update(id, input);
    notify.success(t('contentSchedulesDrawer.toastUpdated'));
    setFormMode({ kind: 'closed' });
  };

  const handleDelete = async (): Promise<void> => {
    if (confirmDeleteId === null) return;
    try {
      await remove(confirmDeleteId);
      notify.success(t('contentSchedulesDrawer.toastDeleted'));
    } catch (err: unknown) {
      // Show the backend's reason and claim; fall through to the interceptor's
      // generic toast when there's no envelope message.
      const msg = extractApiMessage(err);
      if (msg !== null) {
        markErrorHandled(err);
        notify.error(msg);
      }
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={
          contentFilename !== undefined
            ? t('contentSchedulesDrawer.titleWithFile', { filename: contentFilename })
            : t('contentSchedulesDrawer.title')
        }
        side="right"
        size="lg"
      >
        <div className="oa-schedules">
          <p className="oa-schedules__zone-note">
            {t('contentSchedulesDrawer.allTimesShownTashkent')}
          </p>

          {formMode.kind === 'closed' && (
            <div className="oa-schedules__top">
              <Button
                variant="primary"
                onClick={() => {
                  setFormMode({ kind: 'new' });
                }}
              >
                {t('contentSchedulesDrawer.newSchedule')}
              </Button>
            </div>
          )}

          {formMode.kind !== 'closed' && (
            <ScheduleForm
              initial={formMode.kind === 'edit' ? formMode.schedule : null}
              others={schedules}
              onSubmit={(input) => {
                if (formMode.kind === 'edit') return handleUpdate(formMode.schedule.id, input);
                return handleCreate(input);
              }}
              onCancel={() => {
                setFormMode({ kind: 'closed' });
              }}
            />
          )}

          {isLoading ? (
            <div className="oa-schedules__state">
              <Spinner size="md" label={t('contentSchedulesDrawer.loading')} />
            </div>
          ) : error !== null ? (
            <div className="oa-schedules__error" role="alert">
              <p>{error}</p>
              <Button variant="primary" size="sm" onClick={retry}>
                {t('contentSchedulesDrawer.retry')}
              </Button>
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              title={t('contentSchedulesDrawer.emptyTitle')}
              description={t('contentSchedulesDrawer.emptyDescription')}
            />
          ) : (
            <ul className="oa-schedules__list">
              {sorted.map((s) => {
                const status = computeStatus(s, nowMs);
                const isExpired = status === 'expired';
                return (
                  <li
                    key={s.id}
                    className={`oa-schedules__row${isExpired ? ' oa-schedules__row--expired' : ''}`}
                    data-status={status}
                  >
                    <div className="oa-schedules__row-head">
                      <Badge variant={STATUS_BADGE[status]}>{statusLabel(t, status)}</Badge>
                      <span className="oa-schedules__row-target">{s.targetSummary}</span>
                    </div>
                    <div className="oa-schedules__row-times">
                      <span>
                        <span className="oa-schedules__row-label">
                          {t('contentSchedulesDrawer.start')}
                        </span>
                        <strong>{formatTashkent(s.startAt)}</strong>
                      </span>
                      <span aria-hidden="true" className="oa-schedules__row-arrow">
                        →
                      </span>
                      <span>
                        <span className="oa-schedules__row-label">
                          {t('contentSchedulesDrawer.end')}
                        </span>
                        <strong>{formatTashkent(s.endAt)}</strong>
                      </span>
                      <span className="oa-schedules__row-tz">Tashkent</span>
                    </div>
                    {!isExpired && (
                      <div className="oa-schedules__row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFormMode({ kind: 'edit', schedule: s });
                          }}
                        >
                          {t('contentSchedulesDrawer.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setConfirmDeleteId(s.id);
                          }}
                        >
                          {t('contentSchedulesDrawer.delete')}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        title={t('contentSchedulesDrawer.confirmDeleteTitle')}
        message={t('contentSchedulesDrawer.confirmDeleteMessage')}
        confirmLabel={t('contentSchedulesDrawer.delete')}
        cancelLabel={t('contentSchedulesDrawer.keep')}
        variant="danger"
        onCancel={() => {
          setConfirmDeleteId(null);
        }}
        onConfirm={handleDelete}
      />
    </>
  );
};
