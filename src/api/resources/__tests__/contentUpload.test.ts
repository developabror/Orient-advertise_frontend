// Vitest unit tests for src/api/resources/contentUpload.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    post: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  InvalidVideoFileError,
  isWebSocketPushResult,
  uploadContent,
  type UploadResponse,
} from '../contentUpload';

const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;

const validResponse = (over: Partial<UploadResponse> = {}): UploadResponse => ({
  fileId: 42,
  status: 'UPLOADED',
  storageKey: 'raw/abcd-promo.mp4',
  urgent: false,
  projectId: 7,
  webSocketPush: null,
  message: 'Upload accepted; transcoding in progress.',
  ...over,
});

const validFile = (
  name = 'promo.mp4',
  type = 'video/mp4',
  body: BlobPart[] = ['x'.repeat(100)],
): File => new File(body, name, { type });

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(() => {
  mockPost.mockReset();
});

describe('uploadContent — multipart shape', () => {
  it('POSTs /api/content/upload with file in body and projectId in query params', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });

    await uploadContent({ projectId: 7, file: validFile() });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPost.mock.calls[0]!;
    expect(url).toBe('/api/content/upload');
    expect(body).toBeInstanceOf(FormData);
    const sent = body as FormData;
    // Spec: projectId/urgent travel as query params, NOT form fields.
    expect(sent.has('projectId')).toBe(false);
    expect(sent.get('file')).toBeInstanceOf(File);
    expect((sent.get('file') as File).name).toBe('promo.mp4');
    const cfg = config as { params?: Record<string, string>; headers?: unknown };
    expect(cfg.params).toEqual({ projectId: '7' });
    // No manual Content-Type — axios infers multipart from FormData.
    expect(cfg.headers).toBeUndefined();
  });

  it('attaches `urgent=true` as a query param when req.urgent is true', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });

    await uploadContent({ projectId: 7, file: validFile(), urgent: true });

    const cfg = mockPost.mock.calls[0]![2] as { params?: Record<string, string> };
    expect(cfg.params).toEqual({ projectId: '7', urgent: 'true' });
    // urgent must NEVER be on the multipart form (it's a query param per spec).
    expect((mockPost.mock.calls[0]![1] as FormData).has('urgent')).toBe(false);
  });

  it('OMITS the `urgent` query param entirely when not true (false / undefined)', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });
    await uploadContent({ projectId: 7, file: validFile() });
    let cfg = mockPost.mock.calls[0]![2] as { params?: Record<string, string> };
    expect('urgent' in (cfg.params ?? {})).toBe(false);

    mockPost.mockReset();

    mockPost.mockResolvedValueOnce({ data: validResponse() });
    await uploadContent({ projectId: 7, file: validFile(), urgent: false });
    cfg = mockPost.mock.calls[0]![2] as { params?: Record<string, string> };
    expect('urgent' in (cfg.params ?? {})).toBe(false);
  });

  it('OMITS the `projectId` query param entirely when not provided (orphan upload)', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });

    await uploadContent({ file: validFile() });

    const cfg = mockPost.mock.calls[0]![2] as { params?: Record<string, string> };
    expect('projectId' in (cfg.params ?? {})).toBe(false);
  });

  it('OMITS the `projectId` query param when projectId is NaN or non-finite', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });

    await uploadContent({ projectId: Number.NaN, file: validFile() });

    const cfg = mockPost.mock.calls[0]![2] as { params?: Record<string, string> };
    expect('projectId' in (cfg.params ?? {})).toBe(false);
  });

  it('returns the UploadResponse verbatim', async () => {
    const fixture = validResponse();
    mockPost.mockResolvedValueOnce({ data: fixture });

    const result = await uploadContent({ projectId: 7, file: validFile() });

    expect(result).toBe(fixture);
    expect(result.fileId).toBe(42);
    expect(result.status).toBe('UPLOADED');
    expect(result.storageKey).toBe('raw/abcd-promo.mp4');
  });

  it('invokes onProgress(loaded, total) with the axios progress event', async () => {
    const progress = vi.fn<(loaded: number, total: number) => void>();
    mockPost.mockImplementationOnce(
      (
        _url: string,
        _body: unknown,
        config?: { onUploadProgress?: (e: { loaded: number; total?: number }) => void },
      ) => {
        config?.onUploadProgress?.({ loaded: 50, total: 100 });
        config?.onUploadProgress?.({ loaded: 100, total: 100 });
        return Promise.resolve({ data: validResponse() });
      },
    );

    await uploadContent({ projectId: 7, file: validFile() }, progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, 50, 100);
    expect(progress).toHaveBeenNthCalledWith(2, 100, 100);
  });

  it('falls back to file.size when the progress event reports total as undefined', async () => {
    const file = validFile('clip.mp4', 'video/mp4', ['x'.repeat(50)]);
    const progress = vi.fn<(loaded: number, total: number) => void>();
    mockPost.mockImplementationOnce(
      (
        _url: string,
        _body: unknown,
        config?: { onUploadProgress?: (e: { loaded: number; total?: number }) => void },
      ) => {
        config?.onUploadProgress?.({ loaded: 25 });
        return Promise.resolve({ data: validResponse() });
      },
    );

    await uploadContent({ projectId: 7, file }, progress);
    // file.size = 50 → callback total falls back to 50.
    expect(progress).toHaveBeenCalledWith(25, 50);
  });
});

describe('uploadContent — local validation', () => {
  it('rejects an empty file with InvalidVideoFileError reason=EMPTY and does NOT call http.post', async () => {
    const empty = new File([], 'promo.mp4', { type: 'video/mp4' });
    expect(empty.size).toBe(0);

    await expect(uploadContent({ projectId: 7, file: empty })).rejects.toBeInstanceOf(
      InvalidVideoFileError,
    );

    let caught: unknown;
    try {
      await uploadContent({ projectId: 7, file: empty });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVideoFileError);
    expect((caught as InvalidVideoFileError).reason).toBe('EMPTY');
    expect((caught as InvalidVideoFileError).code).toBe('INVALID_VIDEO_FILE');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects a file with an extension outside the allow-list (reason=EXTENSION)', async () => {
    // .exe is decisively not video — extension fails first even though
    // we set the MIME to video/mp4 to isolate the failure to extension.
    const bad = validFile('payload.exe', 'video/mp4');

    let caught: unknown;
    try {
      await uploadContent({ projectId: 7, file: bad });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVideoFileError);
    expect((caught as InvalidVideoFileError).reason).toBe('EXTENSION');
    expect((caught as InvalidVideoFileError).message).toContain('extension');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects a file with no extension at all (reason=EXTENSION)', async () => {
    const bad = validFile('promo', 'video/mp4');

    await expect(uploadContent({ projectId: 7, file: bad })).rejects.toBeInstanceOf(
      InvalidVideoFileError,
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('accepts an uppercase extension (case-insensitive match)', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });
    const ok = validFile('PROMO.MP4', 'video/mp4');

    await uploadContent({ projectId: 7, file: ok });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('accepts an mkv with the matroska MIME variant (any video/* prefix passes)', async () => {
    mockPost.mockResolvedValueOnce({ data: validResponse() });
    const ok = validFile('clip.mkv', 'video/x-matroska');

    await uploadContent({ projectId: 7, file: ok });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('rejects a video-extension file with a non-video MIME (reason=MIME)', async () => {
    // Right extension, wrong MIME — could be a renamed binary. Backend
    // would reject; we reject here too.
    const bad = validFile('payload.mp4', 'application/octet-stream');

    let caught: unknown;
    try {
      await uploadContent({ projectId: 7, file: bad });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVideoFileError);
    expect((caught as InvalidVideoFileError).reason).toBe('MIME');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects a file with empty string MIME (some browsers/drag-drop omit it)', async () => {
    const bad = validFile('clip.mp4', '');

    let caught: unknown;
    try {
      await uploadContent({ projectId: 7, file: bad });
    } catch (err) {
      caught = err;
    }
    expect((caught as InvalidVideoFileError).reason).toBe('MIME');
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('isWebSocketPushResult', () => {
  it('accepts a fully-formed counter triple', () => {
    expect(isWebSocketPushResult({ sent: 3, skipped: 1, failed: 0 })).toBe(true);
  });

  it('accepts zero counts (no eligible devices reachable)', () => {
    expect(isWebSocketPushResult({ sent: 0, skipped: 0, failed: 0 })).toBe(true);
  });

  it('rejects null / non-objects', () => {
    expect(isWebSocketPushResult(null)).toBe(false);
    expect(isWebSocketPushResult(undefined)).toBe(false);
    expect(isWebSocketPushResult(7)).toBe(false);
    expect(isWebSocketPushResult('3')).toBe(false);
  });

  it('rejects payloads missing any of the three counters', () => {
    expect(isWebSocketPushResult({ skipped: 1, failed: 0 })).toBe(false);
    expect(isWebSocketPushResult({ sent: 3, failed: 0 })).toBe(false);
    expect(isWebSocketPushResult({ sent: 3, skipped: 1 })).toBe(false);
  });

  it('rejects non-finite counters', () => {
    expect(isWebSocketPushResult({ sent: '3', skipped: 1, failed: 0 })).toBe(false);
    expect(isWebSocketPushResult({ sent: Number.NaN, skipped: 1, failed: 0 })).toBe(false);
    expect(
      isWebSocketPushResult({ sent: Number.POSITIVE_INFINITY, skipped: 1, failed: 0 }),
    ).toBe(false);
  });
});
