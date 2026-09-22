// Tests for the query params useEvents/useEventCount put on the wire.
//
// The backend binds `from`/`to` as java.time.Instant (@DateTimeFormat
// ISO.DATE_TIME). These hooks used to forward the raw 'YYYY-MM-DD' from the
// date picker, which cannot parse to an Instant — so /api/events answered 400
// whenever a date filter was set and the Events page silently showed nothing.
// Neither hook had any test at all, which is why that survived.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/http', () => ({ http: { get: vi.fn() } }));

import { http } from '@api/http';
import { useEvents, type EventFilter } from '../useEvents';
import { useEventCount } from '../useEventCount';

const mockGet = vi.mocked(http.get);

const FILTER: EventFilter = {
  deviceId: '',
  facility: '',
  dateFrom: '2026-09-18',
  dateTo: '2026-09-18',
  priorities: [],
};

const paramsOf = (callIndex = 0): Record<string, string> => {
  const cfg = mockGet.mock.calls[callIndex]?.[1] as { params: Record<string, string> };
  return cfg.params;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: { content: [], totalElements: 0, totalPages: 0 } });
});

describe('useEvents query params', () => {
  it('sends the Tashkent day as real UTC instants, not a bare calendar date', async () => {
    renderHook(() => useEvents(FILTER, 1, 20));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // 18 Sep in Tashkent (UTC+5) runs 17 Sep 19:00Z → 18 Sep 18:59:59.999999Z.
    // The backend's `to` bound is inclusive (`occurredAt <= :to`).
    expect(paramsOf()).toMatchObject({
      from: '2026-09-17T19:00:00.000Z',
      to: '2026-09-18T18:59:59.999999Z',
    });
  });

  it('omits the bounds entirely when no dates are set', async () => {
    renderHook(() => useEvents({ ...FILTER, dateFrom: '', dateTo: '' }, 1, 20));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    expect(paramsOf()).not.toHaveProperty('from');
    expect(paramsOf()).not.toHaveProperty('to');
  });

  it('drops an unparseable date from the URL rather than sending an empty param', async () => {
    renderHook(() => useEvents({ ...FILTER, dateFrom: 'garbage' }, 1, 20));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    expect(paramsOf()).not.toHaveProperty('from');
    expect(paramsOf()).toHaveProperty('to', '2026-09-18T18:59:59.999999Z');
  });
});

describe('useEventCount query params', () => {
  it('mirrors useEvents exactly, so the count matches the listed rows', async () => {
    // The two buildParams are copy-pasted across two files with nothing tying
    // them together, so assert the WHOLE param object rather than just the
    // dates: if either hook drifts on facilityId or priority, the badge starts
    // counting a different row set than the table shows.
    const RICH: EventFilter = {
      deviceId: '12',
      facility: '7',
      dateFrom: '2026-09-18',
      dateTo: '2026-09-20',
      priorities: ['CRITICAL'],
    };

    mockGet.mockResolvedValue({ data: { content: [], totalElements: 0, totalPages: 0 } });
    renderHook(() => useEvents(RICH, 1, 20));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    const listParams = paramsOf();

    mockGet.mockClear();
    mockGet.mockResolvedValue({ data: 7 });
    renderHook(() => useEventCount(RICH));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    // Pagination legitimately differs — the count call asks for one row — but
    // every key that selects WHICH rows must be identical.
    const selection = (p: Record<string, unknown>): Record<string, unknown> => {
      const { page, size, sort, ...rest } = p;
      void page;
      void size;
      void sort;
      return rest;
    };
    expect(selection(paramsOf())).toEqual(selection(listParams));
    expect(listParams).toMatchObject({
      from: '2026-09-17T19:00:00.000Z',
      to: '2026-09-20T18:59:59.999999Z',
    });
  });
});
