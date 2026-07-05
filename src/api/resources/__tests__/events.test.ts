// Vitest unit tests for src/api/resources/events.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
  },
}));

import { http } from '../../http';
import { listEvents, type EventDto } from '../events';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

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
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const validRow = (over: Partial<EventDto> = {}): EventDto => ({
  id: 1,
  deviceId: 7,
  eventType: 'DEVICE_OFFLINE',
  priority: 'CRITICAL',
  payload: '{"reason":"timeout"}',
  occurredAt: '2026-05-08T10:00:00Z',
  createdAt: '2026-05-08T10:00:01Z',
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
});

describe('listEvents — filter assembly', () => {
  it('passes every filter and pageable field through verbatim', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listEvents(
      {
        deviceId: 7,
        facilityId: 100,
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
        priority: 'CRITICAL',
      },
      { page: 0, size: 50, sort: 'occurredAt,desc' },
    );

    expect(mockGet).toHaveBeenCalledWith('/api/events', {
      params: {
        deviceId: 7,
        facilityId: 100,
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
        priority: 'CRITICAL',
        page: 0,
        size: 50,
        sort: 'occurredAt,desc',
      },
    });
  });

  it('omits undefined filter and pageable fields from the params object', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listEvents({ deviceId: 7 }, { page: 0 });

    const calledParams = mockGet.mock.calls[0]![1] as { params: Record<string, unknown> };
    expect(calledParams.params).toEqual({ deviceId: 7, page: 0 });
    for (const key of [
      'facilityId',
      'from',
      'to',
      'priority',
      'size',
      'sort',
    ]) {
      expect(key in calledParams.params).toBe(false);
    }
  });

  it('preserves falsy-but-defined values (page: 0, size: 0, empty from string)', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    // page: 0 = first Spring page; size: 0 = "no rows, just count" idiom;
    // from: '' = "filter explicitly empty" (the backend distinguishes
    // empty-string from absent for some legacy behaviour).
    await listEvents({ deviceId: 7, from: '' }, { page: 0, size: 0 });

    expect(mockGet).toHaveBeenCalledWith('/api/events', {
      params: { deviceId: 7, from: '', page: 0, size: 0 },
    });
  });

  it('clamps a size > 100 to the backend max BEFORE sending', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    // 1000 is a programming mistake — the backend would 400. We catch
    // it here so the request goes through with a clean params object
    // that the server will accept.
    await listEvents({ deviceId: 7 }, { size: 1000 });

    expect(mockGet).toHaveBeenCalledWith('/api/events', {
      params: { deviceId: 7, size: 100 },
    });
  });

  it('floors a fractional size before clamping', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listEvents({ deviceId: 7 }, { size: 50.7 });

    expect(mockGet).toHaveBeenCalledWith('/api/events', {
      params: { deviceId: 7, size: 50 },
    });
  });

  it('clamps a negative size to 0 (the floor) so the backend sees a sane value', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listEvents({ deviceId: 7 }, { size: -5 });

    expect(mockGet).toHaveBeenCalledWith('/api/events', {
      params: { deviceId: 7, size: 0 },
    });
  });

  it('does not synthesise a size when caller omits it', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listEvents({ deviceId: 7 }, {});

    const params = (mockGet.mock.calls[0]![1] as { params: Record<string, unknown> }).params;
    expect('size' in params).toBe(false);
  });
});

describe('listEvents — page parsing', () => {
  it('routes the response through parsePage and returns a typed Page<EventDto>', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validRow({ id: 1 }), validRow({ id: 2, eventType: 'CONTENT_SYNC' })],
        number: 0,
        size: 50,
        numberOfElements: 2,
        totalElements: 2,
        totalPages: 1,
        first: true,
        last: true,
      },
    });

    const page = await listEvents({ deviceId: 7 }, {});

    expect(page.content).toHaveLength(2);
    expect(page.content[0]!.id).toBe(1);
    expect(page.content[1]!.eventType).toBe('CONTENT_SYNC');
    expect(page.totalElements).toBe(2);
    expect(page.first).toBe(true);
    expect(page.last).toBe(true);
  });

  it('skips malformed rows and keeps well-formed ones', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validRow({ id: 1 }),
          { id: 2 /* missing required fields */ },
          validRow({ id: 3 }),
        ],
        numberOfElements: 3,
        totalElements: 3,
      },
    });

    const page = await listEvents({ deviceId: 7 }, {});

    expect(page.content).toHaveLength(2);
    expect(page.content.map((r) => r.id)).toEqual([1, 3]);
    // Server count preserved; consumers can detect the drop.
    expect(page.numberOfElements).toBe(3);
  });

  it('returns an empty page when the response body is not an envelope', async () => {
    mockGet.mockResolvedValueOnce({ data: 'oops' });
    const page = await listEvents({ deviceId: 7 }, {});
    expect(page.content).toEqual([]);
    expect(page.first).toBe(true);
    expect(page.last).toBe(true);
  });
});

describe('listEvents — 400 surface', () => {
  it('lets the "deviceId/facilityId required" 400 bubble unchanged', async () => {
    const err = make400('At least one of deviceId or facilityId is required');
    mockGet.mockRejectedValueOnce(err);

    await expect(listEvents({}, {})).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(400);
    expect(surface.response?.data?.message).toContain('At least one of deviceId or facilityId');
  });

  it('lets the "date range > 90 days" 400 bubble unchanged', async () => {
    const err = make400('Date range must not exceed 90 days');
    mockGet.mockRejectedValueOnce(err);

    await expect(
      listEvents(
        { deviceId: 7, from: '2026-01-01T00:00:00Z', to: '2026-05-01T00:00:00Z' },
        {},
      ),
    ).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toContain('exceed 90 days');
  });

  it('lets the "from > to" 400 bubble unchanged', async () => {
    const err = make400('from must be on or before to');
    mockGet.mockRejectedValueOnce(err);

    await expect(
      listEvents(
        { deviceId: 7, from: '2026-05-01T00:00:00Z', to: '2026-04-01T00:00:00Z' },
        {},
      ),
    ).rejects.toBe(err);
    const surface = err as { response?: { status?: number } };
    expect(surface.response?.status).toBe(400);
  });
});
