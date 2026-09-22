// Role gating for the incident actions. FE-19 admits viewers to /incidents on
// purpose (the backend serves them the list), but acknowledge/resolve are
// ADMIN/OPERATOR endpoints — a viewer clicking them got an optimistic flip, a
// 403 and a rollback toast. The list must stay readable; only the actions go.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Role } from '@api/auth';
import type { FullIncident } from '@hooks/useIncidents';

const roleMock = vi.fn<() => Role | null>();
vi.mock('@hooks/useRole', () => ({ useRole: () => roleMock() }));

const incidents: readonly FullIncident[] = [
  {
    id: '1',
    priority: 'critical',
    deviceId: 'TV-LOBBY',
    facility: 'HQ',
    occurredAt: '2026-09-22T08:00:00Z',
    status: 'open',
    message: 'offline',
  },
  {
    id: '2',
    priority: 'medium',
    deviceId: 'TV-HALL',
    facility: 'HQ',
    occurredAt: '2026-09-22T07:00:00Z',
    status: 'acknowledged',
    message: 'content mismatch',
  },
];
vi.mock('@hooks/useIncidents', () => ({
  useIncidents: () => ({
    incidents,
    isLoading: false,
    isStale: false,
    acknowledge: vi.fn(),
    resolve: vi.fn(),
  }),
}));
vi.mock('@hooks/useIncidentStats', () => ({
  useIncidentStats: () => ({
    stats: { critical: 1, warning: 1, resolvedToday: 0 },
    isLoading: false,
    isStale: false,
  }),
}));

import { IncidentsPage } from '../IncidentsPage';

const renderAs = (role: Role): void => {
  roleMock.mockReturnValue(role);
  render(
    <MemoryRouter initialEntries={['/incidents']}>
      <IncidentsPage />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IncidentsPage actions', () => {
  it('shows a viewer the incidents but no acknowledge/resolve buttons', () => {
    renderAs('viewer');

    expect(screen.getByText('TV-LOBBY')).toBeInTheDocument();
    expect(screen.getByText('TV-HALL')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it.each(['admin', 'operator'] as const)('gives %s the actions', (role) => {
    renderAs(role);

    // Acknowledge only on the open incident; resolve on both unresolved ones.
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(2);
  });
});
