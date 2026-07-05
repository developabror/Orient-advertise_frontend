// Vitest unit tests for src/api/resources/content.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: { get: vi.fn(), delete: vi.fn() },
}));

import { http } from '../../http';
import {
  getContent,
  listContent,
  softDeleteContent,
  type ContentFileDetail,
  type ContentFileSummary,
} from '../content';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
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
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
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
