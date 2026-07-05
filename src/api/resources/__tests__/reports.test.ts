// Vitest unit tests for src/api/resources/reports.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  exportExcel,
  getEventReport,
  pollReportJob,
  RateLimitedError,
  type EventReport,
  type EventReportResponse,
  type JobResponse,
} from '../reports';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

const make429 = (): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 429',
  response: {
    status: 429,
    statusText: 'Too Many Requests',
    data: {
      status: 429,
      error: 'Too Many Requests',
      message: 'Concurrent export limit reached',
      correlationId: 'corr-429',
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const completedReport = (): EventReport & { readonly status: 'COMPLETED' } => ({
  status: 'COMPLETED',
  facilityId: 100,
  from: '2026-04-01T00:00:00Z',
  to: '2026-05-01T00:00:00Z',
  incidentCount: 12,
  avgResolutionSeconds: 300,
  topAffectedDevices: [{ deviceId: 7, deviceName: 'Atrium screen', eventCount: 9 }],
});

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
});

describe('getEventReport — union response', () => {
  it('returns the COMPLETED variant verbatim when the body discriminator is COMPLETED', async () => {
    const fixture = completedReport();
    mockGet.mockResolvedValueOnce({ data: fixture, status: 200 });

    const result = await getEventReport({
      facilityId: 100,
      from: '2026-04-01T00:00:00Z',
      to: '2026-05-01T00:00:00Z',
    });

    expect(mockGet).toHaveBeenCalledWith('/api/reports/events', {
      params: {
        facilityId: 100,
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
      },
    });
    // Verbatim pass-through — caller narrows on `result.status` directly.
    expect(result).toBe(fixture);
    if (result.status === 'COMPLETED') {
      expect(result.incidentCount).toBe(12);
      expect(result.topAffectedDevices).toHaveLength(1);
    } else {
      expect.fail('expected COMPLETED variant');
    }
  });

  it('returns the PENDING variant verbatim on a 202 (async path)', async () => {
    const fixture: EventReportResponse = {
      status: 'PENDING',
      jobId: 'job-abc-123',
    };
    // axios default validateStatus considers 202 a success; the resource
    // must NOT raise from the success path.
    mockGet.mockResolvedValueOnce({ data: fixture, status: 202 });

    const result = await getEventReport({});

    expect(result).toBe(fixture);
    if (result.status === 'PENDING') {
      expect(result.jobId).toBe('job-abc-123');
    } else {
      expect.fail('expected PENDING variant');
    }
  });

  it('omits undefined filter fields from the params object', async () => {
    mockGet.mockResolvedValueOnce({ data: completedReport(), status: 200 });

    await getEventReport({ from: '2026-04-01T00:00:00Z' });

    const params = (mockGet.mock.calls[0]![1] as { params: Record<string, unknown> }).params;
    expect(params).toEqual({ from: '2026-04-01T00:00:00Z' });
    expect('facilityId' in params).toBe(false);
    expect('to' in params).toBe(false);
  });
});

describe('pollReportJob', () => {
  it('GETs /api/reports/events/jobs/{jobId} and returns the envelope verbatim', async () => {
    const fixture: JobResponse = {
      jobId: 'job-abc-123',
      status: 'COMPLETED',
      result: {
        facilityId: null,
        from: null,
        to: null,
        incidentCount: 0,
        avgResolutionSeconds: null,
        topAffectedDevices: [],
      },
      expiresAt: '2026-05-08T11:00:00Z',
    };
    mockGet.mockResolvedValueOnce({ data: fixture });

    const result = await pollReportJob('job-abc-123');

    expect(mockGet).toHaveBeenCalledWith('/api/reports/events/jobs/job-abc-123');
    expect(result).toBe(fixture);
  });

  it('URL-encodes the jobId so unusual characters do not break the path', async () => {
    mockGet.mockResolvedValueOnce({ data: { jobId: 'a/b', status: 'PENDING', expiresAt: '' } });

    await pollReportJob('a/b');

    expect(mockGet).toHaveBeenCalledWith('/api/reports/events/jobs/a%2Fb');
  });
});

describe('exportExcel — blob download path', () => {
  it('GETs /api/reports/export with responseType blob, timeout 0, and the assembled params', async () => {
    const blob = new Blob(['hello'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    mockGet.mockResolvedValueOnce({
      data: blob,
      headers: { 'content-disposition': 'attachment; filename="orient-events-2026-05.xlsx"' },
    });

    const result = await exportExcel('EVENTS', {
      facilityId: 100,
      from: '2026-04-01T00:00:00Z',
      to: '2026-05-01T00:00:00Z',
    });

    expect(mockGet).toHaveBeenCalledWith('/api/reports/export', {
      params: {
        type: 'EVENTS',
        facilityId: 100,
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
      },
      responseType: 'blob',
      timeout: 0,
    });
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe('orient-events-2026-05.xlsx');
  });

  it('passes every export type verbatim', async () => {
    for (const type of ['EVENTS', 'DEVICES', 'STATS'] as const) {
      mockGet.mockResolvedValueOnce({ data: new Blob([]), headers: {} });
      await exportExcel(type, {});
      const params = (mockGet.mock.calls.at(-1)![1] as { params: Record<string, unknown> }).params;
      expect(params.type).toBe(type);
    }
  });

  it('falls back to "export.xlsx" when Content-Disposition is missing', async () => {
    mockGet.mockResolvedValueOnce({ data: new Blob([]), headers: {} });

    const result = await exportExcel('EVENTS', {});

    expect(result.filename).toBe('export.xlsx');
  });

  it('falls back to "export.xlsx" when Content-Disposition is malformed (no filename=)', async () => {
    mockGet.mockResolvedValueOnce({
      data: new Blob([]),
      headers: { 'content-disposition': 'attachment' },
    });

    const result = await exportExcel('EVENTS', {});

    expect(result.filename).toBe('export.xlsx');
  });

  it('reads filename from an AxiosHeaders-like .get() accessor', async () => {
    // Newer axios versions ship an AxiosHeaders class with a .get()
    // method instead of a plain object. The parser must handle both.
    const headers = {
      get: (key: string): string | null =>
        key.toLowerCase() === 'content-disposition'
          ? 'attachment; filename="custom.xlsx"'
          : null,
    };
    mockGet.mockResolvedValueOnce({ data: new Blob([]), headers });

    const result = await exportExcel('STATS', {});

    expect(result.filename).toBe('custom.xlsx');
  });

  it('omits undefined filter fields from the params (only `type` is mandatory)', async () => {
    mockGet.mockResolvedValueOnce({ data: new Blob([]), headers: {} });

    await exportExcel('DEVICES', {});

    const params = (mockGet.mock.calls[0]![1] as { params: Record<string, unknown> }).params;
    expect(params).toEqual({ type: 'DEVICES' });
    for (const key of ['facilityId', 'deviceId', 'from', 'to']) {
      expect(key in params).toBe(false);
    }
  });
});

describe('exportExcel — 429 path', () => {
  it('rethrows a 429 axios error as a RateLimitedError with code RATE_LIMITED', async () => {
    mockGet.mockRejectedValueOnce(make429());

    await expect(exportExcel('EVENTS', {})).rejects.toBeInstanceOf(RateLimitedError);
    // Re-mock and re-throw so we can catch the actual instance for
    // surface assertions without relying on rejects + chained matchers.
    mockGet.mockRejectedValueOnce(make429());
    let caught: unknown;
    try {
      await exportExcel('EVENTS', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RateLimitedError);
    const e = caught as RateLimitedError;
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toContain('please wait');
    expect(e.name).toBe('RateLimitedError');
  });

  it('passes non-429 errors through unchanged (no RateLimitedError wrap)', async () => {
    const err500 = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 500',
      response: { status: 500, statusText: 'Internal Server Error', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;

    mockGet.mockRejectedValueOnce(err500);

    await expect(exportExcel('EVENTS', {})).rejects.toBe(err500);
  });

  it('passes non-axios errors through unchanged (network drop with no response)', async () => {
    const networkErr = new Error('Network Error');
    mockGet.mockRejectedValueOnce(networkErr);

    await expect(exportExcel('EVENTS', {})).rejects.toBe(networkErr);
  });
});
