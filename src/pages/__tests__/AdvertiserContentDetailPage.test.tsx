// RS-1: the Excel export endpoint is ADMIN/OPERATOR-only, so an advertiser
// always 403s. The page must hide the export control for that role rather than
// offer a button that can only fail. (The 403/429 message branches in
// exportErrorMessage cover any other role that somehow hits it.)

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@hooks/useAdvertiserContentDetail', () => ({
  useAdvertiserContentDetail: () => ({
    detail: { filename: 'ad.mp4', totalPlays: 10, perDevice: [] },
    isLoading: false,
    error: null,
    notFound: false,
    retry: () => undefined,
  }),
}));
vi.mock('@hooks/useAdvertiserContentPlays', () => ({
  useAdvertiserContentPlays: () => ({
    items: [],
    totalItems: 0,
    totalPages: 0,
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

import { useRole } from '@hooks/useRole';
import { AdvertiserContentDetailPage } from '../AdvertiserContentDetailPage';

const renderAt = (): void => {
  render(
    <MemoryRouter initialEntries={['/content/123']}>
      <Routes>
        <Route path="/content/:contentId" element={<AdvertiserContentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('AdvertiserContentDetailPage — export role gating (RS-1)', () => {
  it('hides the Export Excel button for the advertiser role', () => {
    vi.mocked(useRole).mockReturnValue('advertiser');
    renderAt();
    expect(screen.queryByRole('button', { name: /export excel/i })).not.toBeInTheDocument();
  });

  it('shows the Export Excel button for an admin/operator viewing the page', () => {
    vi.mocked(useRole).mockReturnValue('admin');
    renderAt();
    expect(screen.getByRole('button', { name: /export excel/i })).toBeInTheDocument();
  });
});
