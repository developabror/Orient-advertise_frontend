// Vitest unit tests for src/api/resources/playback.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    post: vi.fn(),
  },
}));

import { http } from '../../http';
import { reportPlayback, type BatchResponse, type PlaybackEntry } from '../playback';

const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;

const fixtureResponse = (over: Partial<BatchResponse> = {}): BatchResponse => ({
  total: 1,
  created: 1,
  duplicate: 0,
  rejected: 0,
  rejections: [],
  ...over,
});

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(() => {
  mockPost.mockReset();
});

describe('reportPlayback — single entry', () => {
  it('POSTs /api/devices/{id}/playback with the single entry as the body verbatim', async () => {
    const entry: PlaybackEntry = {
      contentFileId: 10,
      playedAt: '2026-05-08T10:00:00Z',
      durationSeconds: 30,
    };
    mockPost.mockResolvedValueOnce({ data: fixtureResponse() });

    await reportPlayback(7, entry);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playback', entry);
    // Two positional args (URL + body); no third per-request config arg.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
    // Pass-through reference: not coerced into a one-element array.
    expect(mockPost.mock.calls[0]![1]).toBe(entry);
  });

  it('omits `durationSeconds` from the body when caller omits it', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureResponse() });

    const entry: PlaybackEntry = {
      contentFileId: 10,
      playedAt: '2026-05-08T10:00:00Z',
    };
    await reportPlayback(7, entry);

    const sentBody = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect('durationSeconds' in sentBody).toBe(false);
  });
});

describe('reportPlayback — batch (array)', () => {
  it('POSTs the array as the body verbatim', async () => {
    const entries: PlaybackEntry[] = [
      { contentFileId: 10, playedAt: '2026-05-08T10:00:00Z', durationSeconds: 30 },
      { contentFileId: 11, playedAt: '2026-05-08T10:00:30Z', durationSeconds: 30 },
      { contentFileId: 10, playedAt: '2026-05-08T10:01:00Z' },
    ];
    mockPost.mockResolvedValueOnce({
      data: fixtureResponse({ total: 3, created: 3 }),
    });

    await reportPlayback(7, entries);

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playback', entries);
    // Same reference — no array copy, no shape munging.
    expect(mockPost.mock.calls[0]![1]).toBe(entries);
  });

  it('accepts a readonly array (typed as ReadonlyArray<PlaybackEntry>)', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureResponse() });

    const entries: readonly PlaybackEntry[] = Object.freeze([
      { contentFileId: 10, playedAt: '2026-05-08T10:00:00Z' } as const,
    ]);

    await reportPlayback(7, entries);
    expect(mockPost.mock.calls[0]![1]).toBe(entries);
  });

  it('passes an empty array through without short-circuiting (lets the server decide)', async () => {
    mockPost.mockResolvedValueOnce({
      data: fixtureResponse({ total: 0, created: 0 }),
    });

    const result = await reportPlayback(7, []);

    expect(mockPost).toHaveBeenCalledWith('/api/devices/7/playback', []);
    // The resource doesn't pre-validate empty input — backend decides
    // whether [] is acceptable (it currently is, returning total: 0).
    expect(result.total).toBe(0);
  });
});

describe('reportPlayback — response shape', () => {
  it('returns the BatchResponse verbatim', async () => {
    const fixture = fixtureResponse({ total: 5, created: 4, duplicate: 1 });
    mockPost.mockResolvedValueOnce({ data: fixture });

    const result = await reportPlayback(7, []);
    expect(result).toBe(fixture);
  });

  it('preserves rejections[] with index + reason on partial failure', async () => {
    const fixture = fixtureResponse({
      total: 3,
      created: 1,
      duplicate: 1,
      rejected: 1,
      rejections: [
        { index: 2, reason: 'unknown contentFileId 999' },
      ],
    });
    mockPost.mockResolvedValueOnce({ data: fixture });

    const result = await reportPlayback(7, []);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]!.index).toBe(2);
    expect(result.rejections[0]!.reason).toContain('unknown contentFileId');
    // Sanity invariant: counters sum to total.
    expect(result.created + result.duplicate + result.rejected).toBe(result.total);
  });

  it('treats `duplicate` as silent success (counter populated, no rejection row)', async () => {
    const fixture = fixtureResponse({
      total: 2,
      created: 0,
      duplicate: 2,
      rejected: 0,
      rejections: [],
    });
    mockPost.mockResolvedValueOnce({ data: fixture });

    const result = await reportPlayback(7, []);
    // The JSDoc explicitly notes duplicates aren't surfaced as
    // rejections — the server idempotently dedupes on
    // (deviceId, contentFileId, playedAt). Verify that contract.
    expect(result.duplicate).toBe(2);
    expect(result.rejections).toHaveLength(0);
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockPost.mockRejectedValueOnce(err);

    await expect(reportPlayback(7, [])).rejects.toBe(err);
  });
});
