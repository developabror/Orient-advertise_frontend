// Vitest unit tests for src/api/resources/content.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  getContent,
  getContentSummary,
  listContent,
  retranscodeContent,
  softDeleteContent,
  type ContentFileDetail,
  type ContentFileSummary,
} from '../content';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make = (status: number, message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    statusText: '',
    data: {
      status,
      error: '',
      message,
      correlationId: `corr-${String(status)}`,
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const validRow = (over: Partial<ContentFileSummary> = {}): ContentFileSummary => ({
  id: 1,
  projectId: 0,
  name: 'spring-promo.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1_048_576,
  durationSeconds: 30,
  status: 'READY',
  invalidReason: null,
  createdAt: '2026-05-01T09:00:00Z',
  updatedAt: '2026-05-01T09:00:30Z',
  thumbnailUrl: null,
  thumbnailExpiresAt: null,
  uploadedByUsername: null,
  canManage: false,
  transcodeStartedAt: null,
  transcodeAttempts: null,
  transcodeLastError: null,
  stalled: null,
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('listContent', () => {
  it('GETs /api/content with the assembled params', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listContent({ projectId: 1, status: 'READY', name: 'promo' }, { page: 0, size: 50 });
    expect(mockGet).toHaveBeenCalledWith('/api/content', {
      params: { projectId: 1, status: 'READY', name: 'promo', page: 0, size: 50 },
    });
  });

  it('omits undefined filter fields', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });
    await listContent({}, { page: 0 });
    const params = (mockGet.mock.calls[0]![1] as { params: Record<string, unknown> }).params;
    for (const key of ['projectId', 'status', 'name', 'size', 'sort']) {
      expect(key in params).toBe(false);
    }
  });

  it('parses content rows through parsePage', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validRow({ id: 1 }), validRow({ id: 2, status: 'TRANSCODING', durationSeconds: null })],
      },
    });
    const page = await listContent({}, {});
    expect(page.content).toHaveLength(2);
    expect(page.content[0]!.status).toBe('READY');
    expect(page.content[1]!.durationSeconds).toBeNull();
  });

  it('drops a row with an unknown status enum value', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validRow({ id: 1 }), { ...validRow({ id: 2 }), status: 'PROCESSING' }],
        numberOfElements: 2,
      },
    });
    const page = await listContent({}, {});
    expect(page.content).toHaveLength(1);
    expect(page.content[0]!.id).toBe(1);
  });

  it('preserves invalidReason for INVALID rows', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validRow({ status: 'INVALID', invalidReason: 'unsupported codec' })],
      },
    });
    const page = await listContent({}, {});
    expect(page.content[0]!.invalidReason).toBe('unsupported codec');
  });

  it('parses uploadedByUsername (string and null) from the uploadedByUsername wire key', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          { ...validRow({ id: 1 }), uploadedByUsername: 'operator' },
          { ...validRow({ id: 2 }), uploadedByUsername: null },
        ],
      },
    });
    const page = await listContent({}, {});
    expect(page.content[0]!.uploadedByUsername).toBe('operator');
    expect(page.content[1]!.uploadedByUsername).toBeNull();
  });

  it('wire-name regression: a row carrying only `uploadedBy` parses uploadedByUsername as null', async () => {
    const row = validRow({ id: 1 });
    const wire = { ...row, uploadedBy: 'operator' } as Record<string, unknown>;
    delete wire.uploadedByUsername;
    mockGet.mockResolvedValueOnce({ data: { content: [wire] } });
    const page = await listContent({}, {});
    // Proves we read the correct wire key, not the BE getter name.
    expect(page.content[0]!.uploadedByUsername).toBeNull();
  });

  it('parses canManage boolean and defaults to false when absent', async () => {
    const present = validRow({ id: 1 });
    const absent = validRow({ id: 2 }) as Record<string, unknown>;
    delete absent.canManage;
    mockGet.mockResolvedValueOnce({
      data: { content: [{ ...present, canManage: true }, absent] },
    });
    const page = await listContent({}, {});
    expect(page.content[0]!.canManage).toBe(true);
    expect(page.content[1]!.canManage).toBe(false);
  });
});

describe('getContent', () => {
  it('GETs /api/content/{id} and returns the detail verbatim', async () => {
    const detail: ContentFileDetail = {
      ...validRow({ id: 7 }),
      storageKey: 'media/2026/05/spring-promo.mp4',
      processedStorageKey: 'media/2026/05/spring-promo-h264.mp4',
      checksum: 'sha256:abc',
      deletedAt: null,
    };
    mockGet.mockResolvedValueOnce({ data: detail });

    const result = await getContent(7);

    expect(mockGet).toHaveBeenCalledWith('/api/content/7');
    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(result).toBe(detail);
  });

  it('returns soft-deleted records verbatim (deletedAt populated)', async () => {
    const detail: ContentFileDetail = {
      ...validRow({ id: 7 }),
      storageKey: 'media/...',
      processedStorageKey: null,
      checksum: null,
      deletedAt: '2026-05-08T10:00:00Z',
    };
    mockGet.mockResolvedValueOnce({ data: detail });
    const result = await getContent(7);
    expect(result.deletedAt).toBe('2026-05-08T10:00:00Z');
  });

  it('propagates 403 unchanged (ADVERTISER without grant)', async () => {
    const err = make(403, 'Access denied');
    mockGet.mockRejectedValueOnce(err);
    await expect(getContent(7)).rejects.toBe(err);
  });
});

describe('softDeleteContent', () => {
  it('sends DELETE /api/content/{id} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    const result = await softDeleteContent(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/content/7');
    expect(result).toBeUndefined();
  });

  it('lets a 409 axios error bubble unchanged so callers can show the message verbatim', async () => {
    const err = make(409, 'In use by 3 playlists: Spring Promo, Summer Push, Holiday');
    mockDelete.mockRejectedValueOnce(err);

    await expect(softDeleteContent(7)).rejects.toBe(err);

    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    // The verbatim-message contract: the resource doesn't reshape; the
    // caller surfaces err.response.data.message directly to the user.
    expect(surface.response?.data?.message).toBe(
      'In use by 3 playlists: Spring Promo, Summer Push, Holiday',
    );
  });
});

// Transcode-lease fields are liberal-on-read: a backend deployed before the
// V44 migration simply omits them, and the FE has to degrade to its own age
// heuristic rather than failing the whole listing.
describe('parseContentFileSummary — transcode lease fields', () => {
  it('parses the lease fields when the backend sends them', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validRow({
            status: 'TRANSCODING',
            transcodeStartedAt: '2026-09-06T11:30:00Z',
            transcodeAttempts: 2,
            transcodeLastError: 'ffmpeg exited 1',
            stalled: true,
          }),
        ],
      },
    });

    const page = await listContent({}, { page: 0, size: 50 });

    expect(page.content[0]).toMatchObject({
      transcodeStartedAt: '2026-09-06T11:30:00Z',
      transcodeAttempts: 2,
      transcodeLastError: 'ffmpeg exited 1',
      stalled: true,
    });
  });

  it('defaults them to null on a pre-migration backend instead of throwing', async () => {
    const { transcodeStartedAt: _a, transcodeAttempts: _b, transcodeLastError: _c, stalled: _d, ...legacy } =
      validRow();
    mockGet.mockResolvedValueOnce({ data: { content: [legacy] } });

    const page = await listContent({}, { page: 0, size: 50 });

    expect(page.content[0]).toMatchObject({
      transcodeStartedAt: null,
      transcodeAttempts: null,
      transcodeLastError: null,
      stalled: null,
    });
  });

  it('treats a malformed lease value as "not told" rather than failing the row', async () => {
    mockGet.mockResolvedValueOnce({
      data: { content: [validRow({ stalled: 'yes', transcodeAttempts: 'many' } as never)] },
    });

    const page = await listContent({}, { page: 0, size: 50 });

    expect(page.content).toHaveLength(1);
    expect(page.content[0]).toMatchObject({ stalled: null, transcodeAttempts: null });
  });
});

describe('retranscodeContent', () => {
  it('POSTs to /api/content/{id}/retranscode and returns the committed status', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 7, status: 'TRANSCODING' } });

    await expect(retranscodeContent(7)).resolves.toEqual({ status: 'TRANSCODING' });
    expect(mockPost).toHaveBeenCalledWith('/api/content/7/retranscode');
  });

  it('reports status: null when the body carries nothing recognisable', async () => {
    // The caller then falls back to an optimistic TRANSCODING rather than
    // inventing a status the server never sent.
    for (const data of [undefined, null, '', {}, { status: 'PENDING' }]) {
      mockPost.mockResolvedValueOnce({ data });
      await expect(retranscodeContent(7)).resolves.toEqual({ status: null });
    }
  });

  it('does not suppress anything — the 409 bubbles with its message intact', async () => {
    // The resource stays neutral so the caller can render the message inline
    // AND claim the error; suppressing here without rendering would turn
    // Retry into a silent no-op.
    const err = make(409, 'Content is not in a retryable status (READY).');
    mockPost.mockRejectedValueOnce(err);

    await expect(retranscodeContent(7)).rejects.toBe(err);
    const surface = err as { response?: { data?: { message?: string } } };
    expect(surface.response?.data?.message).toBe('Content is not in a retryable status (READY).');
  });
});

describe('listContent — the optional request options', () => {
  it('forwards a signal and toast suppression from the third argument', async () => {
    const controller = new AbortController();
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listContent({}, { page: 0, size: 24, sort: 'createdAt,desc' }, {
      signal: controller.signal,
      suppressErrorToast: true,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/content', {
      params: { page: 0, size: 24, sort: 'createdAt,desc' },
      signal: controller.signal,
      _suppressErrorToast: true,
    });
  });

  it('is additive — a two-argument call still sends exactly what it always did', async () => {
    // Five call sites pass two arguments. A background poll that quietly
    // started suppressing everyone else's error toasts would be a regression
    // dressed up as a feature.
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listContent({ status: 'READY' }, { page: 1 });

    expect(mockGet).toHaveBeenCalledWith('/api/content', {
      params: { status: 'READY', page: 1 },
    });
  });
});

describe('getContentSummary', () => {
  it('GETs the row by id and never lets the interceptor toast a miss', async () => {
    // A miss is the EXPECTED answer here: content frames fan out unscoped, so
    // every operator hears about files they have no grant for. A toast per
    // foreign frame would be a wall of errors on an idle dashboard.
    mockGet.mockResolvedValueOnce({ data: validRow({ id: 9 }) });

    await getContentSummary(9);

    expect(mockGet).toHaveBeenCalledWith('/api/content/9', { _suppressErrorToast: true });
  });

  it('forwards an abort signal so an unmount cancels the hydrate', async () => {
    const controller = new AbortController();
    mockGet.mockResolvedValueOnce({ data: validRow({ id: 9 }) });

    await getContentSummary(9, { signal: controller.signal });

    expect(mockGet).toHaveBeenCalledWith('/api/content/9', {
      _suppressErrorToast: true,
      signal: controller.signal,
    });
  });

  it('parses a detail-shaped response into a listing row', async () => {
    // GET /api/content/{id} returns ContentFileDetail — a superset carrying
    // storageKey/checksum/deletedAt on top of the summary, and a thumbnailUrl
    // presigned by the same decorator the listing uses. It has to drop
    // straight into the grid beside rows that came from listContent.
    mockGet.mockResolvedValueOnce({
      data: {
        ...validRow({ id: 9, status: 'READY', durationSeconds: 12 }),
        thumbnailUrl: 'https://x/t.jpg',
        storageKey: 'raw/9.mp4',
        processedStorageKey: 'hls/9.m3u8',
        checksum: 'sha256:abc',
        deletedAt: null,
      },
    });

    const row = await getContentSummary(9);

    expect(row.id).toBe(9);
    expect(row.status).toBe('READY');
    expect(row.durationSeconds).toBe(12);
    expect(row.thumbnailUrl).toBe('https://x/t.jpg');
    // The four transcode-lease fields are absent from the detail record and
    // degrade to null by design, rather than failing the parse.
    expect(row.transcodeStartedAt).toBeNull();
    expect(row.stalled).toBeNull();
  });

  it('rejects a payload with an unknown status rather than passing it through', async () => {
    // Unlike `getContent`, this one validates: the row it returns is written
    // straight into the grid, so a bad status must not reach a card.
    mockGet.mockResolvedValueOnce({ data: { ...validRow({ id: 9 }), status: 'PROCESSING' } });

    await expect(getContentSummary(9)).rejects.toThrow('status');
  });
});
