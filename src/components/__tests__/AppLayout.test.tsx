// Tests for the responsive nav drawer state in AppLayout. The drawer is the
// only stateful piece of the mobile-layout work: the hamburger toggles
// data-nav-open on .oa-layout, and Escape / backdrop click / navigation all
// close it. (The CSS media queries that turn the sidebar into an off-canvas
// drawer aren't exercised here — jsdom doesn't evaluate them — but the toggle
// state machine is.)

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@api/wsClient', () => ({ wsClient: { onEvent: vi.fn(() => () => undefined) } }));
vi.mock('@api/criticalAlerts', () => ({
  criticalAlerts: { add: vi.fn(), clear: vi.fn() },
  handleIncidentUpdated: vi.fn(),
  handleSnapshot: vi.fn(),
}));
vi.mock('@api/notify', () => ({ notify: { error: vi.fn() } }));
// Stub the heavy child widgets so the layout renders in isolation.
vi.mock('../CriticalAlertBar', () => ({ CriticalAlertBar: () => null }));
vi.mock('../LiveStatusIndicator', () => ({ LiveStatusIndicator: () => null }));
vi.mock('../LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../Sidebar', () => ({ Sidebar: () => <aside id="oa-sidebar" /> }));

import { useAuth } from '@hooks/useAuth';
import { AppLayout } from '../AppLayout';

const renderLayout = (initialPath = '/dashboard'): HTMLElement => {
  vi.mocked(useAuth).mockReturnValue({
    user: { sub: 'op', role: 'operator', profile: null },
    logout: vi.fn(),
  } as never);
  const { container } = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/dashboard"
            element={<Link to="/devices">go-devices</Link>}
          />
          <Route path="/devices" element={<div>Devices view</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  const layout = container.querySelector('.oa-layout');
  if (layout === null) throw new Error('.oa-layout not found');
  return layout as HTMLElement;
};

const openBtn = (): HTMLElement => screen.getByRole('button', { name: 'Open menu' });

describe('AppLayout — responsive nav drawer', () => {
  it('starts closed and the hamburger toggles data-nav-open', () => {
    const layout = renderLayout();
    expect(layout.getAttribute('data-nav-open')).toBe('false');
    expect(openBtn()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(openBtn());
    expect(layout.getAttribute('data-nav-open')).toBe('true');
    expect(openBtn()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(openBtn());
    expect(layout.getAttribute('data-nav-open')).toBe('false');
  });

  it('closes on Escape', () => {
    const layout = renderLayout();
    fireEvent.click(openBtn());
    expect(layout.getAttribute('data-nav-open')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(layout.getAttribute('data-nav-open')).toBe('false');
  });

  it('closes when the backdrop is clicked', () => {
    const layout = renderLayout();
    fireEvent.click(openBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(layout.getAttribute('data-nav-open')).toBe('false');
  });

  it('closes after navigating to another route', () => {
    const layout = renderLayout();
    fireEvent.click(openBtn());
    expect(layout.getAttribute('data-nav-open')).toBe('true');

    fireEvent.click(screen.getByText('go-devices'));
    expect(screen.getByText('Devices view')).toBeInTheDocument();
    expect(layout.getAttribute('data-nav-open')).toBe('false');
  });
});
