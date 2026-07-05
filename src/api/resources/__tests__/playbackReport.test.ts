// Vitest unit tests for src/api/resources/playbackReport.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({ http: { get: vi.fn() } }));

import { http } from '../../http';
import { getDevicePlaybackReport } from '../playbackReport';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
});
afterEach(() => {
  mockGet.mockReset();
});

const wireResponse = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  scope: { type: 'DEVICE', id: 42, name: 'Lobby TV-1' },
  from: '2026-06-17T00:00:00Z',
  to: '2026-06-24T23:59:59Z',
  totalPlayCount: 720,
  totalDurationSeconds: 25200,
  durationComplete: true,
  perContent: [
    {
      contentFileId: 7,
      contentFileName: 'Summer Promo 30s',
      playCount: 420,
      totalDurationSeconds: 12600,
      durationComplete: true,
    },
    {
      contentFileId: 9,
      contentFileName: 'Store Hours',
      playCount: 300,
      totalDurationSeconds: 0,
      durationComplete: false,
    },
  ],
  ...over,
});

describe('getDevicePlaybackReport', () => {
  it('GETs /api/stats/device/{id} with ISO from/to and _suppressErrorToast (no auth header)', async () => {
    mockGet.mockResolvedValueOnce({ data: wireResponse() });

    await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });

    expect(mockGet).toHaveBeenCalledWith('/api/stats/device/42', {
      params: { from: '2026-06-17T00:00:00Z', to: '2026-06-24T23:59:59Z' },
      _suppressErrorToast: true,
    });
    // No Authorization header and NOT _suppressErrorModal (a GET never triggers it).
    const cfg = mockGet.mock.calls[0]![1] as Record<string, unknown>;
    expect('headers' in cfg).toBe(false);
    expect('_suppressErrorModal' in cfg).toBe(false);
  });

  it('attaches the abort signal only when provided', async () => {
    mockGet.mockResolvedValueOnce({ data: wireResponse() });
    const controller = new AbortController();
    await getDevicePlaybackReport(1, { from: '2026-06-01', to: '2026-06-02' }, controller.signal);
    const cfg = mockGet.mock.calls[0]![1] as { signal?: unknown };
    expect(cfg.signal).toBe(controller.signal);
  });

  it('maps a valid response: scope.id is a number, perContent a bare array', async () => {
    mockGet.mockResolvedValueOnce({ data: wireResponse() });

    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });

    expect(res.scope).toEqual({ type: 'DEVICE', id: 42, name: 'Lobby TV-1' });
    expect(typeof res.scope.id).toBe('number');
    expect(res.totalPlayCount).toBe(720);
    expect(res.totalDurationSeconds).toBe(25200);
    expect(res.durationComplete).toBe(true);
    expect(Array.isArray(res.perContent)).toBe(true);
    expect(res.perContent[0]).toEqual({
      contentFileId: 7,
      contentFileName: 'Summer Promo 30s',
      playCount: 420,
      totalDurationSeconds: 12600,
      durationComplete: true,
    });
  });

  it('coerces a string scope.id to a number', async () => {
    mockGet.mockResolvedValueOnce({
      data: wireResponse({ scope: { type: 'DEVICE', id: '42', name: 'X' } }),
    });
    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });
    expect(res.scope.id).toBe(42);
    expect(typeof res.scope.id).toBe('number');
  });

  it('re-sorts perContent by playCount DESC then contentFileName ASC', async () => {
    mockGet.mockResolvedValueOnce({
      data: wireResponse({
        perContent: [
          { contentFileId: 1, contentFileName: 'Bravo', playCount: 10, totalDurationSeconds: 0, durationComplete: true },
          { contentFileId: 2, contentFileName: 'Alpha', playCount: 50, totalDurationSeconds: 0, durationComplete: true },
          { contentFileId: 3, contentFileName: 'Zeta', playCount: 50, totalDurationSeconds: 0, durationComplete: true },
        ],
      }),
    });
    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });
    expect(res.perContent.map((r) => r.contentFileName)).toEqual(['Alpha', 'Zeta', 'Bravo']);
  });

  it('falls back to summing perContent when top-level totals are absent', async () => {
    const data = wireResponse();
    delete (data as Record<string, unknown>).totalPlayCount;
    delete (data as Record<string, unknown>).totalDurationSeconds;
    mockGet.mockResolvedValueOnce({ data });

    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });
    expect(res.totalPlayCount).toBe(720); // 420 + 300
    expect(res.totalDurationSeconds).toBe(12600); // 12600 + 0
  });

  it('drops malformed rows (missing contentFileId / non-object) without throwing', async () => {
    mockGet.mockResolvedValueOnce({
      data: wireResponse({
        perContent: [
          { contentFileName: 'No id', playCount: 5, totalDurationSeconds: 0, durationComplete: true },
          null,
          'nope',
          { contentFileId: 7, contentFileName: 'Good', playCount: 5, totalDurationSeconds: 10, durationComplete: true },
        ],
      }),
    });
    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });
    expect(res.perContent).toHaveLength(1);
    expect(res.perContent[0]!.contentFileId).toBe(7);
  });

  it('returns a bare empty array when perContent is not an array', async () => {
    mockGet.mockResolvedValueOnce({
      data: wireResponse({ perContent: { content: [] }, totalPlayCount: 0, totalDurationSeconds: 0 }),
    });
    const res = await getDevicePlaybackReport(42, { from: '2026-06-17', to: '2026-06-24' });
    expect(res.perContent).toEqual([]);
  });
});
