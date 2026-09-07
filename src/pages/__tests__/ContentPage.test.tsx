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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ContentFileSummary } from '@api/resources/content';

const roleHolder = vi.hoisted(() => ({ role: 'operator' as string | null }));

vi.mock('@hooks/useRole', () => ({
  useRole: () => roleHolder.role,
}));

vi.mock('@api/resources/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/resources/content')>()),
  listContent: vi.fn(),
  retranscodeContent: vi.fn(),
  softDeleteContent: vi.fn(),
}));

vi.mock('@api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { listContent, retranscodeContent } from '@api/resources/content';
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
  vi.mocked(listContent).mockResolvedValue({
    content: [stuckRow()],
    totalElements: 1,
    totalPages: 1,
    number: 0,
    size: 24,
  } as never);
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
