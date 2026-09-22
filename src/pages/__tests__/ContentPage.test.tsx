// Retry wiring on the content page.
//
// Before this existed, an operator facing a stuck upload had exactly one move:
// delete and re-upload — which re-runs the same race, strands the original raw
// object in MinIO forever, and eats more of an already-tight production disk.
//
// Three things have to hold for the button to be worth anything:
//   1. it dispatches POST /api/content/{id}/retranscode and the card moves;
//   2. a 409 puts the backend's own message ON SCREEN (a suppressed error with
//      no inline rendering is a button that does nothing);
//   3. it is absent entirely for a role the backend would 403.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ContentFileSummary } from '@api/resources/content';

const roleHolder = vi.hoisted(() => ({ role: 'operator' as string | null }));

vi.mock('@hooks/useRole', () => ({
  useRole: () => roleHolder.role,
}));

vi.mock('@api/resources/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/resources/content')>()),
  listContent: vi.fn(),
  getContentSummary: vi.fn(),
  retranscodeContent: vi.fn(),
  softDeleteContent: vi.fn(),
}));

// COLLECT the handlers rather than keeping the last one: this page mounts the
// real <ContentUploader> AND the real useContentItems, and both subscribe to
// CONTENT_STATUS_CHANGE. A single-slot mock would test only the uploader.
const ws = vi.hoisted(() => ({ handlers: [] as ((e: unknown) => void)[] }));

vi.mock('@hooks/useWsEvent', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useWsEvent: (type: string, handler: (e: unknown) => void) => {
      const ref = useRef(handler);
      ref.current = handler;
      useEffect(() => {
        if (type !== 'CONTENT_STATUS_CHANGE') return;
        const wrapper = (e: unknown): void => {
          ref.current(e);
        };
        ws.handlers.push(wrapper);
        return () => {
          const i = ws.handlers.indexOf(wrapper);
          if (i >= 0) ws.handlers.splice(i, 1);
        };
      }, [type]);
    },
  };
});

vi.mock('@api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getContentSummary, listContent, retranscodeContent } from '@api/resources/content';
import { http } from '@api/http';
import { ContentPage } from '../ContentPage';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const minutesAgo = (n: number): string => new Date(NOW - n * 60_000).toISOString();

// The production row: uploaded, never picked up, half an hour old.
const stuckRow = (over: Partial<ContentFileSummary> = {}): ContentFileSummary => ({
  id: 41,
  projectId: 7,
  name: 'promo.mp4',
  contentType: 'video/mp4',
  sizeBytes: 2_400_000,
  durationSeconds: null,
  status: 'UPLOADED',
  invalidReason: null,
  createdAt: minutesAgo(30),
  updatedAt: minutesAgo(30),
  thumbnailUrl: null,
  thumbnailExpiresAt: null,
  uploadedByUsername: 'operator',
  canManage: true,
  transcodeStartedAt: null,
  transcodeAttempts: 1,
  transcodeLastError: null,
  stalled: null,
  ...over,
});

const conflict = (message: string): unknown => ({
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      status: 409,
      error: 'Conflict',
      message,
      correlationId: 'abc123',
      timestamp: '2026-09-06T12:00:00Z',
    },
  },
});

// The status <select> also carries a "Transcoding" option, so status
// assertions are scoped to the card's own badge row.
const cardBadges = (): HTMLElement => {
  const el = document.querySelector('.oa-content-card__badges');
  if (el === null) throw new Error('card badges not rendered');
  return el as HTMLElement;
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ContentPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
  roleHolder.role = 'operator';
  ws.handlers.length = 0;
  vi.mocked(listContent).mockResolvedValue({
    content: [stuckRow()],
    totalElements: 1,
    totalPages: 1,
    number: 0,
    size: 24,
  } as never);
  // Retry now reconciles the row against the server (the retranscode CAS
  // commits before the 200), so the single-row GET has to answer with what
  // the server actually committed. The LIST stub deliberately keeps
  // returning the original 30-minute-old UPLOADED row — the point is that
  // the card converges on the row fetch, not on a refetched listing.
  vi.mocked(getContentSummary).mockResolvedValue(
    stuckRow({
      status: 'TRANSCODING',
      transcodeStartedAt: minutesAgo(0),
      updatedAt: minutesAgo(0),
      stalled: false,
    }) as never,
  );
});

describe('ContentPage — Retry', () => {
  it('dispatches the retranscode call and moves the card out of its stuck state', async () => {
    vi.mocked(retranscodeContent).mockResolvedValue({ status: 'TRANSCODING' });

    renderPage();
    expect(await screen.findByText('Stuck — not processed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(retranscodeContent).toHaveBeenCalledWith(41);
    });
    // Optimistic: the card reflects the new status immediately, before any
    // refetch, and stops claiming it is stuck.
    await waitFor(() => {
      expect(within(cardBadges()).getByText('Transcoding')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stuck — not processed.')).not.toBeInTheDocument();
  });

  it('falls back to an optimistic TRANSCODING when the response carries no status', async () => {
    vi.mocked(retranscodeContent).mockResolvedValue({ status: null });

    renderPage();
    await screen.findByText('Stuck — not processed.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(within(cardBadges()).getByText('Transcoding')).toBeInTheDocument();
    });
  });

  it('renders the 409 envelope message VISIBLY on the card', async () => {
    const message = 'Content is not retryable: status is READY.';
    vi.mocked(retranscodeContent).mockRejectedValue(conflict(message));

    renderPage();
    await screen.findByText('Stuck — not processed.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // On screen and announced — not merely swallowed into a title attribute
    // or silenced along with the global modal.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.getByText(message)).toBeVisible();
  });

  it('clears a previous retry error when the operator tries again', async () => {
    vi.mocked(retranscodeContent)
      .mockRejectedValueOnce(conflict('Raw object is missing.'))
      .mockResolvedValueOnce({ status: 'TRANSCODING' });

    renderPage();
    await screen.findByText('Stuck — not processed.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Raw object is missing.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByText('Raw object is missing.')).not.toBeInTheDocument();
    });
  });

  it('renders no Retry button for a viewer — the role the backend would 403', async () => {
    roleHolder.role = 'viewer';

    renderPage();
    // The stuck state is still surfaced; only the action they cannot perform
    // is withheld.
    expect(await screen.findByText('Stuck — not processed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(retranscodeContent).not.toHaveBeenCalled();
  });

  it('renders Retry for an admin', async () => {
    roleHolder.role = 'admin';

    renderPage();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('ContentPage — schedules', () => {
  it('offers no Schedules action: dayparting is not applied to playback yet (LOGIC-04)', async () => {
    roleHolder.role = 'admin';
    vi.mocked(listContent).mockResolvedValue({
      content: [stuckRow({ status: 'READY', durationSeconds: 15 })],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 24,
    } as never);

    renderPage();

    // A READY card is exactly where ContentCard would render the Schedules button.
    expect(await screen.findByText('promo.mp4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedules' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Live status on the grid.
//
// The operator's report, in three parts:
//   1. an upload does not appear until the page is reloaded;
//   2. after the reload it reads "Transcoding" (correct);
//   3. when transcoding finishes it does not read "Ready" until a SECOND
//      reload.
//
// (1) and (3) are the same defect seen from two ends: the live feed had
// exactly one subscriber, `ContentUploader`, and it matched frames against
// its own per-mount state. A row it did not upload in this render — because
// the page reloaded, or because the row is only just being announced — could
// not be matched, so the frame was discarded and nothing else was listening.
// ---------------------------------------------------------------------------

const makeFileList = (files: readonly File[]): FileList =>
  ({
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  }) as unknown as FileList;

const selectVideo = (input: HTMLInputElement, name: string): void => {
  const file = new File(['video-bytes'], name, { type: 'video/mp4' });
  Object.defineProperty(input, 'files', { value: makeFileList([file]), configurable: true });
  fireEvent.change(input);
};

const fileInputs = (): readonly HTMLInputElement[] =>
  [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[];

const cardFor = (filename: string): Element | null =>
  [...document.querySelectorAll('.oa-content-card')].find(
    (el) => el.querySelector('.oa-content-card__filename')?.textContent === filename,
  ) ?? null;

const emitWs = (event: Record<string, unknown>): void => {
  act(() => {
    for (const handler of [...ws.handlers]) handler(event);
  });
};

describe('ContentPage — a new upload reaches the grid without a reload', () => {
  it('puts a card in the grid the moment the upload is accepted', async () => {
    // Symptom 1. A 202 is the only moment anything knows the id exists: the
    // row is UPLOADED, and UPLOADED is the one status the live feed never
    // broadcasts.
    vi.mocked(http.post).mockResolvedValue({
      data: { fileId: 99, status: 'UPLOADED' },
    } as never);
    vi.mocked(http.get).mockResolvedValue({
      data: { id: 99, status: 'UPLOADED' },
    } as never);
    vi.mocked(getContentSummary).mockResolvedValue(
      stuckRow({ id: 99, name: 'new.mp4', status: 'UPLOADED', createdAt: minutesAgo(0) }) as never,
    );

    renderPage();
    await screen.findByText('Stuck — not processed.');
    const listCallsBefore = vi.mocked(listContent).mock.calls.length;

    const input = fileInputs()[0];
    if (input === undefined) throw new Error('uploader file input not rendered');
    selectVideo(input, 'new.mp4');

    // A real grid card, not the uploader's own transient progress row.
    await waitFor(() => {
      expect(cardFor('new.mp4')).not.toBeNull();
    });
    expect(getContentSummary).toHaveBeenCalledWith(99, expect.anything());
    // One targeted row fetch — never a re-listing. Multiplied across a fleet,
    // a refetch per upload is a stampede.
    expect(vi.mocked(listContent).mock.calls).toHaveLength(listCallsBefore);
  });

  it('announces the urgent upload path too', async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { fileId: 77, webSocketPush: null },
    } as never);
    vi.mocked(getContentSummary).mockResolvedValue(
      stuckRow({ id: 77, name: 'urgent.mp4', status: 'UPLOADED', createdAt: minutesAgo(0) }) as never,
    );

    renderPage();
    await screen.findByText('Stuck — not processed.');

    fireEvent.click(screen.getByRole('button', { name: /Urgent upload/ }));
    const inputs = fileInputs();
    // The modal's input is the one that appears after the page's own.
    const urgentInput = inputs[inputs.length - 1];
    if (urgentInput === undefined) throw new Error('urgent file input not rendered');
    selectVideo(urgentInput, 'urgent.mp4');

    await waitFor(() => {
      expect(getContentSummary).toHaveBeenCalledWith(77, expect.anything());
    });
    await waitFor(() => {
      expect(cardFor('urgent.mp4')).not.toBeNull();
    });
  });

  it('flips a card this page never uploaded — the post-reload scenario', async () => {
    // Symptom 3, exactly as it reaches an operator who pressed F5 while the
    // file was transcoding: nothing in this render uploaded row 41, there is
    // no poller, and the frame still has to land.
    vi.mocked(listContent).mockResolvedValue({
      content: [stuckRow({ status: 'TRANSCODING', updatedAt: minutesAgo(1), stalled: false })],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 24,
    } as never);
    vi.mocked(getContentSummary).mockResolvedValue(
      stuckRow({
        status: 'READY',
        durationSeconds: 12,
        thumbnailUrl: 'https://x/t.jpg',
        updatedAt: minutesAgo(0),
        stalled: false,
      }) as never,
    );

    renderPage();
    await waitFor(() => {
      expect(within(cardBadges()).getByText('Transcoding')).toBeInTheDocument();
    });

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 41, status: 'READY', invalidReason: null });

    await waitFor(() => {
      expect(within(cardBadges()).getByText('Ready')).toBeInTheDocument();
    });
    // And it picked up what the frame does not carry.
    await waitFor(() => {
      expect(document.querySelector('img.oa-content-card__thumb-img')).toHaveAttribute(
        'src',
        'https://x/t.jpg',
      );
    });
  });
});
