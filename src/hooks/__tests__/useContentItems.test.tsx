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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ContentFileStatus, ContentFileSummary } from '@api/resources/content';

vi.mock('@api/resources/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/resources/content')>()),
  listContent: vi.fn(),
}));

import { listContent } from '@api/resources/content';
import { ContentCard } from '@components/ContentCard';
import { isRowStalled, useContentItems } from '../useContentItems';

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
