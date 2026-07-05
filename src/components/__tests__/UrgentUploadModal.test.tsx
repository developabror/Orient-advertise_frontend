// Tests for the urgent uploader's size handling (content-1). It shares the
// /api/content/upload endpoint and 50 MB cap with ContentUploader, so it needs
// both the client-side pre-check and a clear 413 server message.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@api/http', () => ({ http: { post: vi.fn(), delete: vi.fn() } }));

import { http } from '@api/http';
import { UrgentUploadModal } from '../UrgentUploadModal';

// The modal renders through a portal into document.body, so query the document.
const fileInput = (): HTMLInputElement => {
  const el = document.querySelector('input[type="file"]');
  if (el === null) throw new Error('file input not found');
  return el as HTMLInputElement;
};

const makeFileList = (files: readonly File[]): FileList =>
  ({
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  }) as unknown as FileList;

const selectVideo = (bytes?: number): void => {
  const input = fileInput();
  const file = new File(['x'], 'urgent.mp4', { type: 'video/mp4' });
  if (bytes !== undefined) Object.defineProperty(file, 'size', { value: bytes });
  Object.defineProperty(input, 'files', { value: makeFileList([file]), configurable: true });
  fireEvent.change(input);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(http.post).mockResolvedValue({ data: { fileId: 1, webSocketPush: null } } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UrgentUploadModal — size cap & 413 (content-1)', () => {
  it('rejects an over-cap file client-side before uploading (no POST)', () => {
    render(<UrgentUploadModal isOpen onClose={() => undefined} />);
    selectVideo(51 * 1024 * 1024); // 51 MB > 50 MB cap

    expect(screen.getByText('Files must be 50 MB or smaller.')).toBeInTheDocument();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('surfaces a clear "too large" message on a server 413', async () => {
    vi.mocked(http.post).mockRejectedValue({
      isAxiosError: true,
      response: { status: 413, data: {} },
    } as never);

    render(<UrgentUploadModal isOpen onClose={() => undefined} />);
    selectVideo(); // passes the client check; the server rejects it

    expect(
      await screen.findByText(/file is too large \(server limit is 50 MB\)/i),
    ).toBeInTheDocument();
  });
});
