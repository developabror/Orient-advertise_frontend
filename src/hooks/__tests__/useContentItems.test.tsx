// Stall detection is the whole point of this file.
//
// The uploader used to decide "this is stuck" from a 10-minute deadline held
// in its own component state, and then told the operator to refresh — which
// unmounted the component, erased the verdict, AND stopped the polling that
// produced it. The state could not survive the action its own copy
// recommended.
//
// `useContentItems` derives the verdict from the listing response instead, so
// it is recomputed on every fetch. These tests pin both halves:
//   1. `isRowStalled` — the pure rule (server flag wins; age is the fallback).
//   2. A full unmount + remount still renders the stuck state, because nothing
//      about it lives in React state.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ContentFileStatus, ContentFileSummary } from '@api/resources/content';

vi.mock('@api/resources/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/resources/content')>()),
  listContent: vi.fn(),
  getContentSummary: vi.fn(),
}));

// COLLECT the handlers, don't overwrite the last one: two components subscribe
// to CONTENT_STATUS_CHANGE now (the uploader keeps its own), and a mock that
// holds a single handler would silently test only whichever mounted last.
// Mirrors the real hook — a ref refreshed every render, subscribed on mount,
// unsubscribed on unmount — so a stale handler can't survive a teardown.
const ws = vi.hoisted(() => ({ handlers: [] as ((e: unknown) => void)[] }));

vi.mock('../useWsEvent', async () => {
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

import { getContentSummary, listContent } from '@api/resources/content';
import { ContentCard } from '@components/ContentCard';
import {
  applyWsPatch,
  isRowStalled,
  matchesContentFilter,
  useContentItems,
  type ContentItem,
  type ContentItemsState,
} from '../useContentItems';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const minutesAgo = (n: number): string => new Date(NOW - n * 60_000).toISOString();

const row = (over: Partial<ContentFileSummary> = {}): ContentFileSummary => ({
  id: 41,
  projectId: 7,
  name: 'promo.mp4',
  contentType: 'video/mp4',
  sizeBytes: 2_400_000,
  durationSeconds: null,
  status: 'UPLOADED',
  invalidReason: null,
  createdAt: minutesAgo(1),
  updatedAt: minutesAgo(1),
  thumbnailUrl: null,
  thumbnailExpiresAt: null,
  uploadedByUsername: 'operator',
  canManage: true,
  transcodeStartedAt: null,
  transcodeAttempts: null,
  transcodeLastError: null,
  stalled: null,
  ...over,
});

describe('isRowStalled — the server flag is authoritative', () => {
  it('takes the server verdict verbatim when the backend sends one', () => {
    // Fresh row the server nonetheless calls stuck — believe the server.
    expect(isRowStalled(row({ stalled: true, createdAt: minutesAgo(0) }), NOW)).toBe(true);
    // Old row the server says is fine (e.g. its lease is still live) — the
    // age heuristic must NOT override that.
    expect(isRowStalled(row({ stalled: false, createdAt: minutesAgo(120) }), NOW)).toBe(false);
  });
});

describe('isRowStalled — age fallback for a backend without the flag', () => {
  it('flags an UPLOADED row older than 10 minutes', () => {
    expect(isRowStalled(row({ status: 'UPLOADED', createdAt: minutesAgo(11) }), NOW)).toBe(true);
  });

  it('leaves a recent UPLOADED row alone', () => {
    expect(isRowStalled(row({ status: 'UPLOADED', createdAt: minutesAgo(3) }), NOW)).toBe(false);
  });

  it('gives TRANSCODING the backend lease cutoff (20 min), not the 10-min one', () => {
    const base: Partial<ContentFileSummary> = { status: 'TRANSCODING' };
    // 15 minutes in: past the UPLOADED threshold but inside the encode lease,
    // so the FE must not contradict a server that still considers it alive.
    expect(isRowStalled(row({ ...base, updatedAt: minutesAgo(15) }), NOW)).toBe(false);
    expect(isRowStalled(row({ ...base, updatedAt: minutesAgo(21) }), NOW)).toBe(true);
  });

  it('prefers transcodeStartedAt over updatedAt as the encode age basis', () => {
    // `updatedAt` looks recent, but the lease says the encode was claimed
    // half an hour ago — the lease is the truth during an ffmpeg run.
    expect(
      isRowStalled(
        row({ status: 'TRANSCODING', updatedAt: minutesAgo(1), transcodeStartedAt: minutesAgo(30) }),
        NOW,
      ),
    ).toBe(true);
  });

  it('never flags a terminal row', () => {
    for (const status of ['READY', 'FAILED', 'INVALID'] as const) {
      expect(isRowStalled(row({ status, createdAt: minutesAgo(600) }), NOW)).toBe(false);
    }
  });

  it('does not flag on an unparseable timestamp instead of guessing', () => {
    expect(isRowStalled(row({ status: 'UPLOADED', createdAt: 'not-a-date' }), NOW)).toBe(false);
  });
});

// Minimal harness: the real hook, the real card, only the network mocked.
const Harness = () => {
  const { items, isLoading } = useContentItems({ page: 1, size: 24, status: '' });
  if (isLoading) return <p>loading</p>;
  return (
    <div>
      {items.map((item) => (
        <ContentCard key={item.id} item={item} layout="grid" onRetry={vi.fn()} />
      ))}
    </div>
  );
};

describe('useContentItems — the stuck verdict survives a remount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
  });

  it('re-renders "Stuck" after a full unmount/remount (the reload that used to erase it)', async () => {
    // The production row: uploaded 30 minutes ago, never picked up.
    vi.mocked(listContent).mockResolvedValue({
      content: [row({ status: 'UPLOADED', createdAt: minutesAgo(30), updatedAt: minutesAgo(30) })],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 24,
    } as never);

    const first = render(<Harness />);
    expect(await screen.findByText('Stuck — not processed.')).toBeInTheDocument();

    // Simulate the reload / route change. Everything React held is gone.
    first.unmount();

    render(<Harness />);
    expect(await screen.findByText('Stuck — not processed.')).toBeInTheDocument();
    // And the operator's way out is on the card, not in an unmounted uploader.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows no stuck state for a row that is merely recent', async () => {
    vi.mocked(listContent).mockResolvedValue({
      content: [row({ status: 'UPLOADED', createdAt: minutesAgo(2), updatedAt: minutesAgo(2) })],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 24,
    } as never);

    render(<Harness />);
    await waitFor(() => {
      expect(screen.queryByText('loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Stuck — not processed.')).not.toBeInTheDocument();
  });

  it('honours a server `stalled: true` on a row too young for the age rule', async () => {
    const status: ContentFileStatus = 'TRANSCODING';
    vi.mocked(listContent).mockResolvedValue({
      content: [row({ status, updatedAt: minutesAgo(1), stalled: true })],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 24,
    } as never);

    render(<Harness />);
    expect(await screen.findByText('Stuck — not processed.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Live status.
//
// The listing hook owns `items`, so it owns every way `items` can change —
// including the live CONTENT_STATUS_CHANGE feed. It did not, and that is the
// whole bug: the only subscriber in the app was `ContentUploader`, matching
// frames against per-mount reducer state. Reload while a file transcodes and
// that state is empty, so the READY frame matched nothing and was dropped. The
// card sat on "Transcoding" until a second reload.
//
// Everything below is written against the operator's report, not the
// implementation: a card must reach its next status without a reload, an
// uploaded row must appear without one, and a fleet of operators must not
// stampede the API because content frames fan out unscoped.
// ---------------------------------------------------------------------------

const emitWs = (event: Record<string, unknown>): void => {
  act(() => {
    for (const handler of [...ws.handlers]) handler(event);
  });
};

// Hold the live hook value so a test can drive `syncItem` / `refresh`
// directly — the WS path applies its own pre-filters, and some cases are
// about the reconciliation entry point rather than the frame that triggers it.
const api: { current: ContentItemsState | null } = { current: null };

interface LiveHarnessProps {
  readonly page?: number;
  readonly status?: string;
  readonly size?: number;
}

const LiveHarness = ({ page = 1, status = '', size = 24 }: LiveHarnessProps) => {
  const state = useContentItems({ page, size, status });
  api.current = state;
  if (state.isLoading) return <p>loading</p>;
  return (
    <div>
      {state.items.map((item) => (
        <ContentCard key={item.id} item={item} layout="grid" />
      ))}
    </div>
  );
};

const pageOf = (rows: readonly ContentFileSummary[]): unknown => ({
  content: rows,
  totalElements: rows.length,
  totalPages: 1,
  number: 0,
  size: 24,
});

const badgeText = (): readonly string[] =>
  [...document.querySelectorAll('.oa-content-card__badges')].map((el) => el.textContent ?? '');

const filenamesInOrder = (): readonly string[] =>
  [...document.querySelectorAll('.oa-content-card__filename')].map((el) => el.textContent ?? '');

const axiosError = (status: number): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: { status, data: {}, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

describe('useContentItems — live CONTENT_STATUS_CHANGE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    ws.handlers.length = 0;
    api.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flips a listed row to Ready — with its thumbnail — on a READY frame, no reload', async () => {
    // THE regression test for symptom 3: transcode finishes, card stays stuck.
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ status: 'TRANSCODING', updatedAt: minutesAgo(1) })]) as never,
    );
    // A READY frame carries five keys — id, status, reason, and no poster or
    // duration. Those live only on the row, so one hydrate follows.
    vi.mocked(getContentSummary).mockResolvedValue(
      row({
        status: 'READY',
        thumbnailUrl: 'https://x/t.jpg',
        durationSeconds: 12,
      }) as never,
    );

    render(<LiveHarness />);
    await waitFor(() => {
      expect(badgeText()).toEqual(['Transcoding']);
    });

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 41, status: 'READY', invalidReason: null });

    await waitFor(() => {
      expect(badgeText()).toEqual(['Ready']);
    });
    expect(getContentSummary).toHaveBeenCalledTimes(1);
    expect(getContentSummary).toHaveBeenCalledWith(41, expect.anything());
    await waitFor(() => {
      expect(document.querySelector('img.oa-content-card__thumb-img')).toHaveAttribute(
        'src',
        'https://x/t.jpg',
      );
    });
    // The grid never went through a loading state to get there.
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
  });

  it('flips UPLOADED → Transcoding with zero network', async () => {
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ status: 'UPLOADED', createdAt: minutesAgo(1) })]) as never,
    );

    render(<LiveHarness />);
    await waitFor(() => {
      expect(badgeText()).toEqual(['Uploading']);
    });
    vi.mocked(listContent).mockClear();

    emitWs({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 41,
      status: 'TRANSCODING',
      invalidReason: null,
    });

    await waitFor(() => {
      expect(badgeText()).toEqual(['Transcoding']);
    });
    // A frame that fully describes the transition costs nothing. Anything
    // else, multiplied by every file and every operator, is a stampede.
    expect(getContentSummary).not.toHaveBeenCalled();
    expect(listContent).not.toHaveBeenCalled();
  });

  it('hydrates an unknown id and prepends it at the head of page 1', async () => {
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'old.mp4', status: 'READY' })]) as never,
    );
    vi.mocked(getContentSummary).mockResolvedValue(
      row({ id: 99, name: 'new.mp4', status: 'UPLOADED', createdAt: minutesAgo(0) }) as never,
    );

    render(<LiveHarness />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['old.mp4']);
    });

    // Driven through syncItem: this is the `onUploadAccepted` path, and an
    // UPLOADED row is precisely what the WS feed never announces.
    act(() => {
      api.current?.syncItem('99');
    });

    await waitFor(() => {
      // First, because `createdAt,desc` puts the newest row at the head.
      expect(filenamesInOrder()).toEqual(['new.mp4', 'old.mp4']);
    });
  });

  it('hydrates an unknown id arriving over the wire when no filter excludes it', async () => {
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'old.mp4', status: 'READY' })]) as never,
    );
    vi.mocked(getContentSummary).mockResolvedValue(
      row({ id: 99, name: 'wire.mp4', status: 'TRANSCODING', updatedAt: minutesAgo(0) }) as never,
    );

    render(<LiveHarness />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['old.mp4']);
    });

    emitWs({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 99,
      status: 'TRANSCODING',
      invalidReason: null,
    });

    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['wire.mp4', 'old.mp4']);
    });
    expect(getContentSummary).toHaveBeenCalledTimes(1);
  });

  it('asks once for an id it cannot see, then never again', async () => {
    // Content frames fan out UNSCOPED — every operator receives every file's
    // frames, and asking for one they have no grant for is a 404. Without the
    // ignore-set every browser in the fleet re-GETs every other operator's
    // content on every frame of every transcode.
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'mine.mp4', status: 'READY' })]) as never,
    );
    vi.mocked(getContentSummary).mockRejectedValue(axiosError(404));

    render(<LiveHarness />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['mine.mp4']);
    });

    const frame = {
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 777,
      status: 'TRANSCODING',
      invalidReason: null,
    };
    emitWs(frame);
    await waitFor(() => {
      expect(getContentSummary).toHaveBeenCalledTimes(1);
    });
    emitWs(frame);
    emitWs({ ...frame, status: 'READY' });

    await waitFor(() => {
      expect(getContentSummary).toHaveBeenCalledTimes(1);
    });
    expect(filenamesInOrder()).toEqual(['mine.mp4']);
  });

  it('ignores an unknown id entirely when the operator is not on page 1', async () => {
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'p2.mp4', status: 'READY' })]) as never,
    );

    render(<LiveHarness page={2} />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['p2.mp4']);
    });

    emitWs({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 99,
      status: 'TRANSCODING',
      invalidReason: null,
    });

    // A row prepended to page 2 is a pagination bug, not a live update.
    await waitFor(() => {
      expect(getContentSummary).not.toHaveBeenCalled();
    });
    expect(filenamesInOrder()).toEqual(['p2.mp4']);
  });

  it('ignores an unknown id whose status cannot match the active filter', async () => {
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'ready.mp4', status: 'READY' })]) as never,
    );

    render(<LiveHarness status="ready" />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['ready.mp4']);
    });

    emitWs({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 99,
      status: 'TRANSCODING',
      invalidReason: null,
    });

    await waitFor(() => {
      expect(getContentSummary).not.toHaveBeenCalled();
    });
  });

  it('refetches in the background without ever blanking the grid', async () => {
    // Unmounting 24 cards for a refetch collapses the grid to a 240px box,
    // clamps the scroll position and drops focus to <body>. `isLoading` is for
    // "the operator asked for a different list" and nothing else.
    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'stable.mp4', status: 'READY' })]) as never,
    );

    render(<LiveHarness />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['stable.mp4']);
    });

    let sawSpinner = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText('loading') !== null) sawSpinner = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await act(async () => {
      api.current?.refresh();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(listContent).toHaveBeenCalledTimes(2);
    });
    observer.disconnect();

    expect(sawSpinner).toBe(false);
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
    expect(filenamesInOrder()).toEqual(['stable.mp4']);
  });

  it('leaves the grid intact when a background refetch fails', async () => {
    vi.mocked(listContent).mockResolvedValueOnce(
      pageOf([row({ id: 41, name: 'stable.mp4', status: 'READY' })]) as never,
    );
    render(<LiveHarness />);
    await waitFor(() => {
      expect(filenamesInOrder()).toEqual(['stable.mp4']);
    });

    vi.mocked(listContent).mockRejectedValueOnce(axiosError(500));
    await act(async () => {
      api.current?.refresh();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(api.current?.isStale).toBe(true);
    });
    // Stale, not empty. The last good answer stays on screen.
    expect(filenamesInOrder()).toEqual(['stable.mp4']);
  });

  it('asks the server for the newest rows first', async () => {
    // Without this, "prepend to the head of page 1" is an arbitrary claim
    // about where the server would have put the row.
    vi.mocked(listContent).mockResolvedValue(pageOf([row()]) as never);

    render(<LiveHarness />);

    await waitFor(() => {
      expect(listContent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sort: 'createdAt,desc' }),
        expect.anything(),
      );
    });
  });

  it('tears down its poll and its in-flight hydrate on unmount', async () => {
    vi.useFakeTimers();
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.mocked(listContent).mockResolvedValue(
      pageOf([row({ id: 41, name: 'mine.mp4', status: 'TRANSCODING' })]) as never,
    );
    // A hydrate that never settles — the unmount has to be safe regardless.
    vi.mocked(getContentSummary).mockReturnValue(new Promise(() => undefined) as never);

    const view = render(<LiveHarness />);
    await act(async () => {
      await Promise.resolve();
    });

    emitWs({ type: 'CONTENT_STATUS_CHANGE', contentId: 41, status: 'READY', invalidReason: null });
    expect(getContentSummary).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(clearInterval).toHaveBeenCalled();
    // The handler went with the component; a frame after unmount reaches
    // nothing at all.
    expect(ws.handlers).toHaveLength(0);
    // Advancing past a full poll period must not resurrect the fetch.
    const before = vi.mocked(listContent).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(vi.mocked(listContent).mock.calls).toHaveLength(before);
    expect(warn).not.toHaveBeenCalled();
  });
});

// The two pure helpers the live path is built from. Same treatment as
// `isRowStalled` above: no React, no network, just the rule.

const item = (over: Partial<ContentItem> = {}): ContentItem => ({
  id: '41',
  filename: 'promo.mp4',
  durationSeconds: 0,
  sizeBytes: 2_400_000,
  status: 'transcoding',
  progressPct: 0,
  urgent: false,
  assignedTo: 0,
  errorMessage: null,
  thumbnailUrl: null,
  uploadedByUsername: 'operator',
  canManage: true,
  stalled: false,
  createdAt: minutesAgo(1),
  ...over,
});

describe('matchesContentFilter', () => {
  it('admits everything when no filter is set', () => {
    for (const status of ['ready', 'transcoding', 'failed', 'invalid', 'uploading'] as const) {
      expect(matchesContentFilter(item({ status }), '')).toBe(true);
    }
  });

  it('admits only the matching status otherwise', () => {
    expect(matchesContentFilter(item({ status: 'ready' }), 'ready')).toBe(true);
    expect(matchesContentFilter(item({ status: 'transcoding' }), 'ready')).toBe(false);
  });
});

describe('applyWsPatch', () => {
  const frame = (over: Record<string, unknown> = {}) =>
    ({
      type: 'CONTENT_STATUS_CHANGE',
      contentId: 41,
      status: 'READY',
      invalidReason: null,
      ...over,
    }) as never;

  it('returns the SAME row object when the frame says nothing new', () => {
    // Identity, not equality: a repeated frame must cost no render. The
    // broadcaster is free to re-emit, and every operator receives every file's
    // frames.
    const row = item({ status: 'ready', progressPct: 100 });
    expect(applyWsPatch(row, frame())).toBe(row);
  });

  it('clears a stale stuck verdict when the pipeline proves it moved', () => {
    const row = item({ status: 'uploading', stalled: true, errorMessage: 'boom' });
    const next = applyWsPatch(row, frame({ status: 'TRANSCODING' }));
    expect(next.status).toBe('transcoding');
    expect(next.stalled).toBe(false);
    expect(next.errorMessage).toBeNull();
  });

  it('keeps the row progress when the frame carries no percentage', () => {
    // The production broadcaster emits five keys and progressPct is not one.
    const row = item({ status: 'transcoding', progressPct: 42 });
    expect(applyWsPatch(row, frame({ status: 'TRANSCODING' })).progressPct).toBe(42);
  });

  it('clamps a reported percentage below 100 so the bar cannot outrun the status', () => {
    const row = item({ status: 'transcoding', progressPct: 10 });
    expect(applyWsPatch(row, frame({ status: 'TRANSCODING', progressPct: 240 })).progressPct).toBe(99);
    expect(applyWsPatch(row, frame({ status: 'TRANSCODING', progressPct: -5 })).progressPct).toBe(0);
  });

  it('takes the reason on INVALID and keeps the existing one on FAILED', () => {
    // Only INVALID supplies a string; FAILED sends an explicit null, and
    // blanking a reason the row already carried would lose the only
    // explanation on the card.
    const row = item({ status: 'transcoding', errorMessage: 'ffmpeg exit 1' });
    expect(applyWsPatch(row, frame({ status: 'INVALID', invalidReason: 'No video stream' })))
      .toMatchObject({ status: 'invalid', errorMessage: 'No video stream' });
    expect(applyWsPatch(row, frame({ status: 'FAILED' }))).toMatchObject({
      status: 'failed',
      errorMessage: 'ffmpeg exit 1',
    });
  });
});
