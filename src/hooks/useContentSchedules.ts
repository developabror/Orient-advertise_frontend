import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  type ScheduleSummary,
} from '@api/resources/schedules';

export interface ContentSchedule {
  readonly id: string;
  readonly targetSummary: string;
  readonly startAt: string | null;
  readonly endAt: string | null;
}

// Schedules attach to ASSIGNMENTS, not directly to content. Body shape
// mirrors `CreateScheduleRequest` / `UpdateScheduleRequest`.
export type RepeatType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ScheduleInput {
  readonly assignmentId: number;
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc?: string | null;
}

export interface UpdateScheduleInput {
  readonly startTimeUtc: string;
  readonly endTimeUtc: string;
  readonly repeatType: RepeatType;
  readonly repeatEndUtc?: string | null;
}

export interface ContentSchedulesState {
  readonly schedules: readonly ContentSchedule[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly create: (input: ScheduleInput) => Promise<void>;
  readonly update: (id: string, input: UpdateScheduleInput) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

const REPEAT_LABEL: Record<RepeatType, string> = {
  NONE: 'One-off',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

const formatRepeatEnd = (iso: string | null): string => {
  if (iso === null) return '';
  // Render the date portion only — operators care about "when does the
  // recurrence stop", not the wall-clock minute.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return ` until ${date.toISOString().slice(0, 10)}`;
};

const toContentSchedule = (s: ScheduleSummary): ContentSchedule => ({
  id: String(s.id),
  targetSummary:
    s.repeatType === 'NONE'
      ? REPEAT_LABEL.NONE
      : `${REPEAT_LABEL[s.repeatType]}${formatRepeatEnd(s.repeatEndUtc)}`,
  startAt: s.startTimeUtc,
  endAt: s.endTimeUtc,
});

const PAGE = { page: 0, size: 100 };

export const useContentSchedules = (
  assignmentId: number | null,
): ContentSchedulesState => {
  const [schedules, setSchedules] = useState<readonly ContentSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (assignmentId === null) {
      setSchedules([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listSchedules({ assignmentId }, PAGE)
      .then((page) => {
        if (cancelled) return;
        setSchedules(page.content.map(toContentSchedule));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        setError('Could not load schedules.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assignmentId, refreshKey]);

  const refetch = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  const create = useCallback(
    async (input: ScheduleInput): Promise<void> => {
      await createSchedule({
        assignmentId: input.assignmentId,
        startTimeUtc: input.startTimeUtc,
        endTimeUtc: input.endTimeUtc,
        repeatType: input.repeatType,
        ...(input.repeatEndUtc !== null && input.repeatEndUtc !== undefined
          ? { repeatEndUtc: input.repeatEndUtc }
          : {}),
      });
      refetch();
    },
    [refetch],
  );

  const update = useCallback(
    async (id: string, input: UpdateScheduleInput): Promise<void> => {
      const numId = Number.parseInt(id, 10);
      if (!Number.isFinite(numId)) throw new Error(`invalid schedule id: ${id}`);
      await updateSchedule(numId, {
        startTimeUtc: input.startTimeUtc,
        endTimeUtc: input.endTimeUtc,
        repeatType: input.repeatType,
        ...(input.repeatEndUtc !== null && input.repeatEndUtc !== undefined
          ? { repeatEndUtc: input.repeatEndUtc }
          : {}),
      });
      refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const numId = Number.parseInt(id, 10);
      if (!Number.isFinite(numId)) throw new Error(`invalid schedule id: ${id}`);
      await deleteSchedule(numId);
      refetch();
    },
    [refetch],
  );

  return { schedules, isLoading, error, retry: refetch, create, update, remove };
};
