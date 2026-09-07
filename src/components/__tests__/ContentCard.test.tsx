// Render tests for ContentCard's canManage delete-gating and ownership line.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContentCard } from '../ContentCard';
import type { ContentItem } from '@hooks/useContentItems';

const item = (over: Partial<ContentItem> = {}): ContentItem => ({
  id: '88',
  filename: 'promo.mp4',
  durationSeconds: 30,
  sizeBytes: 1024,
  status: 'ready',
  progressPct: 100,
  urgent: false,
  assignedTo: 0,
  errorMessage: null,
  thumbnailUrl: null,
  uploadedByUsername: null,
  canManage: false,
  stalled: false,
  createdAt: '2026-09-06T11:00:00Z',
  ...over,
});

describe('ContentCard — canManage delete gating', () => {
  it('shows Delete when onDelete is passed AND canManage is true', () => {
    render(<ContentCard item={item({ canManage: true })} layout="grid" onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('does NOT show Delete for a granted-not-owned row (canManage false)', () => {
    render(<ContentCard item={item({ canManage: false })} layout="grid" onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('FIX-8: a canManage:false row with no Schedules action renders NO action bar at all', () => {
    // No onSchedules, content not interactive for delete → the action-row
    // wrapper must not render (proves the wrapper guard includes canManage).
    const { container } = render(
      <ContentCard item={item({ status: 'transcoding', canManage: false })} layout="grid" onDelete={vi.fn()} />,
    );
    expect(container.querySelector('.oa-content-card__actions')).toBeNull();
  });
});

describe('ContentCard — ownership line', () => {
  it('shows "Uploaded by {username}" when uploadedByUsername is present', () => {
    render(<ContentCard item={item({ uploadedByUsername: 'operator' })} layout="grid" />);
    expect(screen.getByText('Uploaded by')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  it('omits the uploaded-by pair when uploadedByUsername is null', () => {
    render(<ContentCard item={item({ uploadedByUsername: null })} layout="grid" />);
    expect(screen.queryByText('Uploaded by')).not.toBeInTheDocument();
  });
});

// A stalled row is one nothing is going to finish on its own. It must read as
// stopped, not as busy — the "Processing…" placeholder and the 0% progress bar
// are what let a permanently-stuck file look like an in-flight one.
describe('ContentCard — stalled row', () => {
  it('names the stuck state instead of implying progress', () => {
    const { container } = render(
      <ContentCard item={item({ status: 'uploading', stalled: true })} layout="grid" />,
    );

    expect(screen.getByText('Stuck — not processed.')).toBeInTheDocument();
    // Badge + thumbnail placeholder both name it.
    expect(screen.getAllByText('Stuck')).toHaveLength(2);
    // No activity affordances: no "Processing…" placeholder, no progress bar
    // pinned at 0%.
    expect(screen.queryByText('Processing…')).not.toBeInTheDocument();
    expect(container.querySelector('.oa-content-card__progress')).toBeNull();
    expect(container.querySelector('.oa-content-card--stalled')).not.toBeNull();
  });

  it('keeps the normal in-flight rendering for a row that is NOT stalled', () => {
    const { container } = render(
      <ContentCard item={item({ status: 'transcoding', stalled: false })} layout="grid" />,
    );

    expect(screen.queryByText('Stuck — not processed.')).not.toBeInTheDocument();
    expect(container.querySelector('.oa-content-card__progress')).not.toBeNull();
  });
});

describe('ContentCard — Retry action', () => {
  it('offers Retry on a stuck UPLOADED row and calls back with the row id', () => {
    const onRetry = vi.fn();
    render(
      <ContentCard
        item={item({ id: '41', status: 'uploading', stalled: true })}
        layout="grid"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('41');
  });

  it('offers Retry on FAILED and INVALID rows', () => {
    for (const status of ['failed', 'invalid'] as const) {
      const { unmount } = render(
        <ContentCard item={item({ status })} layout="grid" onRetry={vi.fn()} />,
      );
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      unmount();
    }
  });

  it('hides Retry on a READY row and on a row the backend is actively encoding', () => {
    // READY has nothing to retry; TRANSCODING would only earn a 409.
    for (const status of ['ready', 'transcoding'] as const) {
      const { unmount } = render(
        <ContentCard item={item({ status })} layout="grid" onRetry={vi.fn()} />,
      );
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('renders NO Retry button when the page withholds onRetry (unauthorised role)', () => {
    // The page omits the prop entirely for roles the backend would 403.
    render(<ContentCard item={item({ status: 'failed', stalled: true })} layout="grid" />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('disables the button while a retry is in flight', () => {
    render(
      <ContentCard item={item({ status: 'failed' })} layout="grid" onRetry={vi.fn()} isRetrying />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('renders a retry error visibly as an alert, not just in a title attribute', () => {
    const message = 'Content is not in a retryable status (READY).';
    render(
      <ContentCard
        item={item({ status: 'failed' })}
        layout="grid"
        onRetry={vi.fn()}
        retryError={message}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(message);
  });
});
