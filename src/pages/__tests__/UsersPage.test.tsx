// Render tests for UsersPage "Manage access" link routing per role.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserRecord } from '@hooks/useUsers';

const useUsersMock = vi.fn();
vi.mock('@hooks/useUsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hooks/useUsers')>();
  return { ...actual, useUsers: () => useUsersMock() };
});

vi.mock('@hooks/useAuth', () => ({
  useAuth: () => ({ user: { sub: 999, role: 'admin', profile: null } }),
}));

vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { UsersPage } from '../UsersPage';

const rec = (over: Partial<UserRecord>): UserRecord => ({
  id: '1',
  name: 'user',
  email: '',
  role: 'advertiser',
  status: 'active',
  lastLoginAt: null,
  linkedContentCount: 0,
  ...over,
});

const mountWith = (items: UserRecord[]) => {
  useUsersMock.mockReturnValue({
    items,
    totalItems: items.length,
    totalPages: 1,
    isLoading: false,
    error: null,
    retry: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  });
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
};

const accessLink = (): HTMLAnchorElement | null =>
  screen.queryByRole('link', { name: /manage access/i }) as HTMLAnchorElement | null;

afterEach(() => {
  useUsersMock.mockReset();
});

describe('UsersPage — Manage access link', () => {
  it('renders for an advertiser pointing at /users/{id}/access', () => {
    mountWith([rec({ id: '10', name: 'adv', role: 'advertiser' })]);
    expect(accessLink()?.getAttribute('href')).toBe('/users/10/access');
  });

  it('renders for an operator pointing at /users/{id}/operator-access', () => {
    mountWith([rec({ id: '20', name: 'op', role: 'operator' })]);
    expect(accessLink()?.getAttribute('href')).toBe('/users/20/operator-access');
  });

  it('does NOT render for an admin row', () => {
    mountWith([rec({ id: '30', name: 'adm', role: 'admin' })]);
    expect(accessLink()).toBeNull();
  });

  it('does NOT render for a viewer row', () => {
    mountWith([rec({ id: '40', name: 'vw', role: 'viewer' })]);
    expect(accessLink()).toBeNull();
  });
});

describe('UsersPage — username column', () => {
  it('shows the username, not the email', () => {
    mountWith([rec({ id: '50', name: 'alice', email: 'alice@example.com' })]);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
  });
});
