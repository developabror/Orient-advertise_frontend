// Render tests for OperatorContentAccessPage — mirrors the advertiser access
// page structure but wired to the operator-content hook.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ContentItem } from '@hooks/useContentItems';

const access = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const library = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@hooks/useOperatorAccess', () => ({
  useOperatorAccess: () => access.value,
}));
vi.mock('@hooks/useContentLibrary', () => ({
  useContentLibrary: () => library.value,
}));
vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { OperatorContentAccessPage } from '../OperatorContentAccessPage';

const item = (over: Partial<ContentItem>): ContentItem => ({
  id: '1',
  filename: 'promo.mp4',
  durationSeconds: 0,
  sizeBytes: 0,
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

const defaultLibrary = {
  items: [] as ContentItem[],
  totalItems: 0,
  isLoading: false,
  error: null,
  hasMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
  removeLocally: vi.fn(),
  retry: vi.fn(),
};

const mount = (accessOver: Record<string, unknown>, libOver: Record<string, unknown> = {}) => {
  access.value = {
    user: { id: '7', name: 'operator', email: '', role: 'operator', status: 'active', lastLoginAt: null, linkedContentCount: 0 },
    userLoading: false,
    userError: null,
    notFound: false,
    linked: [] as ContentItem[],
    linkedLoading: false,
    linkedError: null,
    retry: vi.fn(),
    link: vi.fn(),
    unlink: vi.fn(),
    ...accessOver,
  };
  library.value = { ...defaultLibrary, ...libOver };
  return render(
    <MemoryRouter initialEntries={['/users/7/operator-access']}>
      <Routes>
        <Route path="/users/:userId/operator-access" element={<OperatorContentAccessPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('OperatorContentAccessPage', () => {
  it('renders the operator-access header and notice', () => {
    mount({});
    expect(screen.getByText(/Manage operator access/i)).toBeInTheDocument();
    expect(screen.getByText(/regardless of their project assignment/i)).toBeInTheDocument();
  });

  it('renders linked content + available library columns', () => {
    mount(
      { linked: [item({ id: '88', filename: 'linked.mp4' })] },
      { items: [item({ id: '90', filename: 'libitem.mp4' })], totalItems: 1 },
    );
    expect(screen.getByText('linked.mp4')).toBeInTheDocument();
    expect(screen.getByText('libitem.mp4')).toBeInTheDocument();
  });

  it('shows "User not found" on a 404', () => {
    mount({ notFound: true });
    expect(screen.getByText(/User not found/i)).toBeInTheDocument();
  });
});
