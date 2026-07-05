// Render tests for ContentCard's canManage delete-gating and ownership line.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
