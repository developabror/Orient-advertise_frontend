// Vitest unit tests for src/api/resources/schedules.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  type RepeatType,
  type ScheduleDetail,
  type ScheduleResponse,
  type ScheduleSummary,
} from '../schedules';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make400 = (message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 400',
  response: {
    status: 400,
    statusText: 'Bad Request',
    data: {
      status: 400,
      error: 'Bad Request',
      message,
      correlationId: 'corr-400',
      timestamp: '2026-05-08T10:00:00Z',
      fieldErrors: [{ field: 'endTimeUtc', message, rejectedValue: null }],
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const fixture = (over: Partial<ScheduleResponse> = {}): ScheduleResponse => ({
  id: 30,
  assignmentId: 50,
  startTimeUtc: '2026-05-08T10:00:00Z',
  endTimeUtc: '2026-05-08T18:00:00Z',
  repeatType: 'DAILY',
  repeatEndUtc: '2026-06-08T18:00:00Z',
  overlapWarnings: [],
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('createSchedule', () => {
  it('POSTs /api/schedules with the request body verbatim and returns the DTO', async () => {
    const result = fixture();
    mockPost.mockResolvedValueOnce({ data: result });

    const body = {
      assignmentId: 50,
      startTimeUtc: '2026-05-08T10:00:00Z',
      endTimeUtc: '2026-05-08T18:00:00Z',
      repeatType: 'DAILY' as RepeatType,
      repeatEndUtc: '2026-06-08T18:00:00Z',
    };
    const dto = await createSchedule(body);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/schedules', body);
    // url + body, no third per-request config arg.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
    expect(dto).toBe(result);
  });

  it('forwards the body without repeatEndUtc when caller omits it (NONE repeat)', async () => {
    mockPost.mockResolvedValueOnce({ data: fixture({ repeatType: 'NONE', repeatEndUtc: null }) });

    await createSchedule({
      assignmentId: 50,
      startTimeUtc: '2026-05-08T10:00:00Z',
      endTimeUtc: '2026-05-08T18:00:00Z',
      repeatType: 'NONE',
    });

    const sentBody = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect('repeatEndUtc' in sentBody).toBe(false);
  });

  it('passes every RepeatType value through verbatim', async () => {
    const types: readonly RepeatType[] = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'];
    for (const repeatType of types) {
      mockPost.mockResolvedValueOnce({ data: fixture({ repeatType }) });
      await createSchedule({
        assignmentId: 50,
        startTimeUtc: '2026-05-08T10:00:00Z',
        endTimeUtc: '2026-05-08T18:00:00Z',
        repeatType,
      });
      const sent = mockPost.mock.calls.at(-1)![1] as { repeatType: RepeatType };
      expect(sent.repeatType).toBe(repeatType);
    }
    expect(mockPost).toHaveBeenCalledTimes(types.length);
  });

  it('returns overlapWarnings verbatim — schedule is saved despite warnings', async () => {
    const withWarnings = fixture({
      overlapWarnings: [
        {
          existingScheduleId: 31,
          newStart: '2026-05-08T13:00:00Z',
          newEnd: '2026-05-08T20:00:00Z',
          existingStart: '2026-05-08T14:00:00Z',
          existingEnd: '2026-05-08T16:00:00Z',
        },
        {
          existingScheduleId: 32,
          newStart: '2026-05-08T13:00:00Z',
          newEnd: '2026-05-08T20:00:00Z',
          existingStart: '2026-05-08T17:00:00Z',
          existingEnd: '2026-05-08T19:00:00Z',
        },
      ],
    });
    mockPost.mockResolvedValueOnce({ data: withWarnings });

    const dto = await createSchedule({
      assignmentId: 50,
      startTimeUtc: '2026-05-08T13:00:00Z',
      endTimeUtc: '2026-05-08T20:00:00Z',
      repeatType: 'NONE',
    });

    // Critical: a non-empty overlapWarnings array does NOT mean the call
    // failed. The schedule has an `id` (it was saved); the warnings are
    // informational. UI surfaces them as info toasts, not errors.
    expect(dto).toBe(withWarnings);
    expect(dto.id).toBe(30);
    expect(dto.overlapWarnings).toHaveLength(2);
    expect(dto.overlapWarnings[0]!.existingScheduleId).toBe(31);
  });

  it('lets a 400 (end-in-the-past) axios error bubble unchanged for inline form rendering', async () => {
    const err = make400('endTimeUtc must be in the future');
    mockPost.mockRejectedValueOnce(err);

    await expect(
      createSchedule({
        assignmentId: 50,
        startTimeUtc: '2026-04-01T10:00:00Z',
        endTimeUtc: '2026-04-01T18:00:00Z',
        repeatType: 'NONE',
      }),
    ).rejects.toBe(err);

    // Surface the JSDoc'd narrowing pattern: status 400 + fieldErrors
    // that point at the offending input. Caller renders inline, NOT
    // as a toast (interceptor doesn't toast 4xx).
    const surface = err as {
      response?: {
        status?: number;
        data?: { fieldErrors?: { field: string; message: string }[] };
      };
    };
    expect(surface.response?.status).toBe(400);
    expect(surface.response?.data?.fieldErrors?.[0]?.field).toBe('endTimeUtc');
  });
});

describe('updateSchedule', () => {
  it('PUTs /api/schedules/{id} with the request body and returns the DTO', async () => {
    const updated = fixture({ startTimeUtc: '2026-05-08T11:00:00Z' });
    mockPut.mockResolvedValueOnce({ data: updated });

    const body = {
      startTimeUtc: '2026-05-08T11:00:00Z',
      endTimeUtc: '2026-05-08T19:00:00Z',
      repeatType: 'DAILY' as RepeatType,
      repeatEndUtc: '2026-06-08T19:00:00Z',
    };
    const dto = await updateSchedule(30, body);

    expect(mockPut).toHaveBeenCalledWith('/api/schedules/30', body);
    expect(dto).toBe(updated);
  });

  it('does NOT accept assignmentId in its request type (immutable post-create)', async () => {
    mockPut.mockResolvedValueOnce({ data: fixture() });

    // Type-level: UpdateScheduleRequest has no assignmentId. The next
    // line would be a TS error if attempted; this test asserts the
    // runtime path with a clean update body. (Compile-time enforcement
    // is the primary guarantee.)
    await updateSchedule(30, {
      startTimeUtc: '2026-05-08T10:00:00Z',
      endTimeUtc: '2026-05-08T18:00:00Z',
      repeatType: 'NONE',
    });

    const sentBody = mockPut.mock.calls[0]![1] as Record<string, unknown>;
    expect('assignmentId' in sentBody).toBe(false);
  });

  it('returns overlapWarnings verbatim on update too (non-blocking on update)', async () => {
    const withWarnings = fixture({
      overlapWarnings: [
        {
          existingScheduleId: 33,
          newStart: '2026-05-08T11:00:00Z',
          newEnd: '2026-05-08T19:00:00Z',
          existingStart: '2026-05-08T12:00:00Z',
          existingEnd: '2026-05-08T13:00:00Z',
        },
      ],
    });
    mockPut.mockResolvedValueOnce({ data: withWarnings });

    const dto = await updateSchedule(30, {
      startTimeUtc: '2026-05-08T11:00:00Z',
      endTimeUtc: '2026-05-08T19:00:00Z',
      repeatType: 'NONE',
    });

    expect(dto.overlapWarnings).toHaveLength(1);
    expect(dto.overlapWarnings[0]!.existingScheduleId).toBe(33);
  });

  it('lets a 400 (end-in-the-past) axios error bubble unchanged on update', async () => {
    const err = make400('endTimeUtc must be in the future');
    mockPut.mockRejectedValueOnce(err);

    await expect(
      updateSchedule(30, {
        startTimeUtc: '2026-04-01T10:00:00Z',
        endTimeUtc: '2026-04-01T18:00:00Z',
        repeatType: 'NONE',
      }),
    ).rejects.toBe(err);
  });
});

describe('deleteSchedule', () => {
  it('sends DELETE /api/schedules/{id} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await deleteSchedule(30);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/schedules/30');
    expect(result).toBeUndefined();
  });

  it('propagates a 404 axios error unchanged (e.g. already deleted)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 404',
      response: { status: 404, statusText: '', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    await expect(deleteSchedule(999)).rejects.toBe(err);
  });
});

const validSummary = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({
  id: 30,
  assignmentId: 50,
  playlistId: 70,
  startTimeUtc: '2026-05-08T10:00:00Z',
  endTimeUtc: '2026-05-08T18:00:00Z',
  repeatType: 'DAILY',
  repeatEndUtc: '2026-06-08T18:00:00Z',
  createdAt: '2026-05-08T09:59:00Z',
  ...over,
});

describe('listSchedules', () => {
  it('GETs /api/schedules with the assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listSchedules(
      {
        assignmentId: 50,
        repeatType: 'DAILY',
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-31T23:59:59Z',
      },
      { page: 0, size: 50, sort: 'startTimeUtc,asc' },
    );
    expect(mockGet).toHaveBeenCalledWith('/api/schedules', {
      params: {
        assignmentId: 50,
        repeatType: 'DAILY',
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-31T23:59:59Z',
        page: 0,
        size: 50,
        sort: 'startTimeUtc,asc',
      },
    });
  });

  it('omits undefined filter and pageable fields', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listSchedules({}, {});
    expect(mockGet).toHaveBeenCalledWith('/api/schedules', { params: {} });
  });

  it('parses rows through parsePage', async () => {
    mockGet.mockResolvedValueOnce({
      data: { content: [validSummary({ id: 1 }), validSummary({ id: 2, repeatType: 'NONE', repeatEndUtc: null })] },
    });
    const page = await listSchedules({}, {});
    expect(page.content).toHaveLength(2);
    expect(page.content[1]!.repeatEndUtc).toBeNull();
  });

  it('drops rows with an unknown repeatType', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validSummary({ id: 1 }), { ...validSummary({ id: 2 }), repeatType: 'YEARLY' }],
      },
    });
    const page = await listSchedules({}, {});
    expect(page.content).toHaveLength(1);
    expect(page.content[0]!.id).toBe(1);
  });

  it('lets a 400 (date-range > 90 days) axios error bubble unchanged', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: {
          status: 400,
          error: 'Bad Request',
          message: 'Date range must not exceed 90 days',
          correlationId: 'corr-400',
          timestamp: '2026-05-08T10:00:00Z',
        },
        headers: {},
        config: {},
      },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockGet.mockRejectedValueOnce(err);

    await expect(
      listSchedules({ from: '2026-01-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }, {}),
    ).rejects.toBe(err);
  });
});

describe('getSchedule', () => {
  it('GETs /api/schedules/{id} and returns ScheduleDetail verbatim', async () => {
    const detail: ScheduleDetail = {
      ...validSummary({ id: 30 }),
      nextOccurrenceUtc: '2026-05-09T10:00:00Z',
    };
    mockGet.mockResolvedValueOnce({ data: detail });

    const result = await getSchedule(30);

    expect(mockGet).toHaveBeenCalledWith('/api/schedules/30');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(detail);
    expect(result.nextOccurrenceUtc).toBe('2026-05-09T10:00:00Z');
  });

  it('returns null nextOccurrenceUtc verbatim (NONE repeat or past repeatEndUtc)', async () => {
    const detail: ScheduleDetail = {
      ...validSummary({ repeatType: 'NONE', repeatEndUtc: null }),
      nextOccurrenceUtc: null,
    };
    mockGet.mockResolvedValueOnce({ data: detail });
    const result = await getSchedule(30);
    expect(result.nextOccurrenceUtc).toBeNull();
  });
});
