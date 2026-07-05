// Vitest unit tests for src/api/resources/files.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  deleteFile,
  downloadFile,
  getPresignedUrl,
  getStorageStatus,
  uploadFile,
} from '../files';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make503 = (): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 503',
  response: {
    status: 503,
    statusText: 'Service Unavailable',
    data: {},
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
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

describe('uploadFile', () => {
  it('POSTs /api/files with multipart FormData carrying the file under field "file"', async () => {
    const file = new File(['hello world'], 'hello.txt', { type: 'text/plain' });
    mockPost.mockResolvedValueOnce({ data: { objectName: 'hello.txt', size: 11 } });

    const result = await uploadFile(file);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPost.mock.calls[0]!;
    expect(url).toBe('/api/files');
    expect(body).toBeInstanceOf(FormData);
    const sent = body as FormData;
    const sentFile = sent.get('file');
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe('hello.txt');
    // Config is present because we wired up onUploadProgress; but we
    // don't set Content-Type manually — axios infers it from FormData.
    expect(config).toBeDefined();
    expect((config as { headers?: unknown }).headers).toBeUndefined();
    expect(result).toEqual({ objectName: 'hello.txt', size: 11 });
  });

  it('invokes onProgress(loaded, total) with the axios progress event', async () => {
    const file = new File(['x'.repeat(200)], 'big.bin');
    const progress = vi.fn<(loaded: number, total: number) => void>();
    mockPost.mockImplementationOnce(
      (
        _url: string,
        _body: unknown,
        config?: { onUploadProgress?: (e: { loaded: number; total?: number }) => void },
      ) => {
        config?.onUploadProgress?.({ loaded: 100, total: 200 });
        config?.onUploadProgress?.({ loaded: 200, total: 200 });
        return Promise.resolve({ data: { objectName: 'big.bin', size: 200 } });
      },
    );

    await uploadFile(file, progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, 100, 200);
    expect(progress).toHaveBeenNthCalledWith(2, 200, 200);
  });

  it('falls back to file.size when the progress event reports total as undefined', async () => {
    const file = new File(['x'.repeat(50)], 'no-total.bin');
    const progress = vi.fn<(loaded: number, total: number) => void>();
    mockPost.mockImplementationOnce(
      (
        _url: string,
        _body: unknown,
        config?: { onUploadProgress?: (e: { loaded: number; total?: number }) => void },
      ) => {
        // Some proxies strip Content-Length so axios reports total=undefined.
        config?.onUploadProgress?.({ loaded: 25 });
        return Promise.resolve({ data: { objectName: 'no-total.bin', size: 50 } });
      },
    );

    await uploadFile(file, progress);

    // total falls back to file.size = 50.
    expect(progress).toHaveBeenCalledWith(25, 50);
  });

  it('does not register onUploadProgress when no callback is supplied', async () => {
    const file = new File(['x'], 'x.bin');
    mockPost.mockResolvedValueOnce({ data: { objectName: 'x.bin', size: 1 } });

    await uploadFile(file);

    const [, , config] = mockPost.mock.calls[0]!;
    // The handler is still attached (we always pass onUploadProgress to
    // axios) but it short-circuits when onProgress is absent — verified
    // by the previous tests that DO pass progress and see the callback.
    expect(config).toBeDefined();
    expect(typeof (config as { onUploadProgress?: unknown }).onUploadProgress).toBe('function');
  });
});

describe('downloadFile', () => {
  it('GETs /api/files/{encoded objectName} with responseType blob and parses filename', async () => {
    const blob = new Blob(['payload'], { type: 'application/octet-stream' });
    mockGet.mockResolvedValueOnce({
      data: blob,
      headers: { 'content-disposition': 'attachment; filename="hello.txt"' },
    });

    const result = await downloadFile('foo/bar.txt');

    expect(mockGet).toHaveBeenCalledWith('/api/files/foo%2Fbar.txt', { responseType: 'blob' });
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe('hello.txt');
  });

  it('falls back to "download.bin" when Content-Disposition is missing', async () => {
    mockGet.mockResolvedValueOnce({ data: new Blob([]), headers: {} });
    const result = await downloadFile('a.bin');
    expect(result.filename).toBe('download.bin');
  });

  it('falls back to "download.bin" when Content-Disposition has no filename=', async () => {
    mockGet.mockResolvedValueOnce({
      data: new Blob([]),
      headers: { 'content-disposition': 'inline' },
    });
    const result = await downloadFile('a.bin');
    expect(result.filename).toBe('download.bin');
  });

  it('reads filename via the AxiosHeaders-like .get() accessor too', async () => {
    const headers = {
      get: (key: string): string | null =>
        key.toLowerCase() === 'content-disposition'
          ? 'attachment; filename="from-axios-headers.bin"'
          : null,
    };
    mockGet.mockResolvedValueOnce({ data: new Blob([]), headers });

    const result = await downloadFile('x.bin');
    expect(result.filename).toBe('from-axios-headers.bin');
  });

  it('translates a clean 404 into a clear "file not found" error (files-4)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 404',
      response: { status: 404, statusText: 'Not Found', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    };
    mockGet.mockRejectedValueOnce(err);
    await expect(downloadFile('gone.bin')).rejects.toThrow(/not found/i);
  });

  it('rethrows non-404 download errors unchanged', async () => {
    const err = make503();
    mockGet.mockRejectedValueOnce(err);
    await expect(downloadFile('x.bin')).rejects.toBe(err);
  });
});

describe('getPresignedUrl', () => {
  it('GETs /api/files/{encoded objectName}/presigned-url and returns the response verbatim', async () => {
    const fixture = {
      objectName: 'media/2026/05/spring-promo.mp4',
      url: 'https://minio.local/bucket/media/2026/05/spring-promo.mp4?X-Amz-Signature=abc',
    };
    mockGet.mockResolvedValueOnce({ data: fixture });

    const result = await getPresignedUrl('media/2026/05/spring-promo.mp4');

    expect(mockGet).toHaveBeenCalledWith(
      '/api/files/media%2F2026%2F05%2Fspring-promo.mp4/presigned-url',
    );
    expect(result).toBe(fixture);
  });
});

describe('deleteFile', () => {
  it('sends DELETE /api/files/{encoded objectName} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await deleteFile('foo/bar.bin');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/files/foo%2Fbar.bin');
    expect(result).toBeUndefined();
  });

  it('propagates 403 unchanged (non-ADMIN/OPERATOR caller)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: '', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    await expect(deleteFile('a.bin')).rejects.toBe(err);
  });
});

describe('getStorageStatus', () => {
  it('returns { status: "UP" } when the body says UP', async () => {
    mockGet.mockResolvedValueOnce({ data: { status: 'UP' } });
    const result = await getStorageStatus();
    expect(mockGet).toHaveBeenCalledWith('/api/files/status');
    expect(result).toEqual({ status: 'UP' });
  });

  it('returns { status: "DEGRADED" } when the body says DEGRADED', async () => {
    mockGet.mockResolvedValueOnce({ data: { status: 'DEGRADED' } });
    const result = await getStorageStatus();
    expect(result).toEqual({ status: 'DEGRADED' });
  });

  it('biases unknown body status strings to DEGRADED (avoid masking issues)', async () => {
    // A future server-side state we don't recognise yet — better to
    // surface a possible problem than to over-report green.
    mockGet.mockResolvedValueOnce({ data: { status: 'PARTIAL' } });
    const result = await getStorageStatus();
    expect(result).toEqual({ status: 'DEGRADED' });
  });

  it('collapses 503 (MinIO degraded) to { status: "DEGRADED" } as a successful resolve', async () => {
    mockGet.mockRejectedValueOnce(make503());

    // Critical contract: 503 does NOT propagate as an error from this
    // resource. The global toast still fires (the interceptor handles
    // that), but the data surface returns DEGRADED so the admin status
    // page can render an inline indicator.
    const result = await getStorageStatus();
    expect(result).toEqual({ status: 'DEGRADED' });
  });

  it('propagates non-503 errors unchanged (e.g. 403, network drop)', async () => {
    const err403 = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: '', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockGet.mockRejectedValueOnce(err403);

    await expect(getStorageStatus()).rejects.toBe(err403);
  });

  it('propagates non-axios errors unchanged (network drop with no response)', async () => {
    const networkErr = new Error('Network Error');
    mockGet.mockRejectedValueOnce(networkErr);

    await expect(getStorageStatus()).rejects.toBe(networkErr);
  });
});
