// Render tests for the content uploader's transcoding-status handling.
//
//   B1 — a CONTENT_STATUS_CHANGE WS event flips an in-flight entry to
//        ready/failed immediately, without waiting for the 5s poll.
//   B2 — a never-completing transcode (always TRANSCODING) hits the polling
//        deadline and surfaces a timeout instead of spinning at 100% forever.
//
// useWsEvent is stubbed to capture the latest handler (a vi.hoisted holder so
// the mock factory can reference it); http is mocked for the upload POST and
// the detail poll GET.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Capture the latest CONTENT_STATUS_CHANGE handler the component registers.
const ws = vi.hoisted(() => ({ handler: null as ((e: unknown) => void) | null }));

vi.mock('@hooks/useWsEvent', () => ({
  useWsEvent: (type: string, handler: (e: unknown) => void) => {
    if (type === 'CONTENT_STATUS_CHANGE') ws.handler = handler;
  },
}));

vi.mock('@api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { http } from '@api/http';
import { ContentUploader } from '../ContentUploader';

const getFileInput = (container: HTMLElement): HTMLInputElement => {
  const el = container.querySelector('input[type="file"]');
  if (el === null) throw new Error('file input not found');
  return el as HTMLInputElement;
};

// The component reads e.target.files as a FileList (uses .item()/.length), so a
// plain array won't do. Build a minimal FileList and force it onto the input.
const makeFileList = (files: readonly File[]): FileList =>
  ({
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  }) as unknown as FileList;

const selectVideo = (container: HTMLElement): void => {
  const input = getFileInput(container);
  const file = new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' });
  Object.defineProperty(input, 'files', { value: makeFileList([file]), configurable: true });
  fireEvent.change(input);
};

// Select a video whose reported size is forced (avoids allocating real MBs) —
// used to drive the client-side size pre-check.
const selectVideoOfSize = (container: HTMLElement, bytes: number): void => {
  const input = getFileInput(container);
  const file = new File(['x'], 'big.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: bytes });
  Object.defineProperty(input, 'files', { value: makeFileList([file]), configurable: true });
  fireEvent.change(input);
};

const emitWs = (event: Record<string, unknown>): void => {
  act(() => {
    ws.handler?.(event);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  ws.handler = null;
  // Upload accepted, transcoding kicked off.
  vi.mocked(http.post).mockResolvedValue({ data: { fileId: 123, status: 'TRANSCODING' } } as never);
  // Poll keeps reporting TRANSCODING (non-terminal) by default.
  vi.mocked(http.get).mockResolvedValue({ data: { id: 123, status: 'TRANSCODING' } } as never);
  vi.mocked(http.delete).mockResolvedValue({ data: undefined } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ContentUploader — live WS status (B1)', () => {
  it('flips a processing entry to Ready on a CONTENT_STATUS_CHANGE READY event', async () => {
    const { container } = render(<ContentUploader />);
    selectVideo(container);

    // Upload POST resolves → entry enters "Processing".
    expect(await screen.findByText('Processing')).toBeInTheDocument();

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 123, status: 'READY' });

    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('flips to Failed and shows the invalidReason on a FAILED/INVALID event', async () => {
    const { container } = render(<ContentUploader />);
    selectVideo(container);
    await screen.findByText('Processing');

    emitWs({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 123,
      status: 'INVALID',
      invalidReason: 'Unsupported codec',
    });

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Unsupported codec')).toBeInTheDocument();
  });

  it('ignores an event for an unrelated contentId', async () => {
    const { container } = render(<ContentUploader />);
    selectVideo(container);
    await screen.findByText('Processing');

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 999, status: 'READY' });

    // Still processing — the foreign event was not applied.
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('does NOT resurrect a cancelled upload from a late READY event (terminal-state guard)', async () => {
    const { container } = render(<ContentUploader />);
    selectVideo(container);
    await screen.findByText('Processing');

    // Operator cancels mid-transcode.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();

    // A socket event that arrives after cancellation must be a no-op — the
    // entry's status guard (not just the contentId match) is what prevents
    // re-listing a file the operator just removed.
    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 123, status: 'READY' });

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('shows a determinate transcode bar when a TRANSCODING event carries progressPct', async () => {
    const { container } = render(<ContentUploader />);
    selectVideo(container);
    await screen.findByText('Processing');

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 123, status: 'TRANSCODING', progressPct: 55 });

    const bar = screen.getByRole('progressbar', { name: 'Transcoding progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '55');
    // Still in flight — a progress update is not a terminal transition.
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });
});

describe('ContentUploader — polling deadline fallback (B2)', () => {
  it('times out a never-completing transcode instead of spinning forever', async () => {
    vi.useFakeTimers();
    // The transcode never finishes — every poll says TRANSCODING.
    vi.mocked(http.get).mockResolvedValue({ data: { id: 123, status: 'TRANSCODING' } } as never);

    const { container } = render(<ContentUploader />);
    selectVideo(container);

    // Flush the upload POST microtask so polling starts and the entry is processing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Processing')).toBeInTheDocument();

    // Advance past the 10-minute deadline (+ one poll interval).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 5_000);
    });

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });
});

describe('ContentUploader — size cap & 413 (content-1)', () => {
  it('rejects an over-cap file client-side before uploading (no POST)', () => {
    const { container } = render(<ContentUploader />);
    selectVideoOfSize(container, 51 * 1024 * 1024); // 51 MB > 50 MB cap

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Files must be 50 MB or smaller.')).toBeInTheDocument();
    // Pre-check spared the doomed upload.
    expect(http.post).not.toHaveBeenCalled();
  });

  it('surfaces a clear "too large" message on a server 413', async () => {
    vi.mocked(http.post).mockRejectedValue({
      isAxiosError: true,
      response: { status: 413, data: {} },
    } as never);

    const { container } = render(<ContentUploader />);
    selectVideo(container); // passes the client check; the server rejects it

    expect(await screen.findByText(/file is too large \(server limit is 50 MB\)/i)).toBeInTheDocument();
  });
});
