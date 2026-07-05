import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@hooks/useAuth';
import { wsClient } from '@api/wsClient';
import { criticalAlerts, handleIncidentUpdated, handleSnapshot } from '@api/criticalAlerts';
import { notify } from '@api/notify';
import { CriticalAlertBar } from './CriticalAlertBar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LiveStatusIndicator } from './LiveStatusIndicator';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';

const INCIDENT_TOAST_THROTTLE_MS = 2000;

export const AppLayout = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Off-canvas nav drawer for small screens. On desktop the sidebar is a static
  // grid column and this stays false (the toggle button is CSS-hidden). Pure UI
  // state — no business logic depends on it.
  const [navOpen, setNavOpen] = useState(false);

  // Close the drawer after navigating to another page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer while it's open.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navOpen]);

  useEffect(() => {
    // Single subscription point for both incident WS events. Routing
    // both through here avoids the double-dismiss race that would
    // happen if two components independently subscribed to
    // INCIDENT_UPDATED. AppLayout mounts once for the authenticated
    // app, so React's useEffect cleanup is enough to keep HMR from
    // accumulating stale listeners.
    let lastToastAt = 0;
    const unsubCritical = wsClient.onEvent('INCIDENT_CRITICAL', (e) => {
      // IncidentPayload carries numeric ids and `description`/`openedAt`
      // (no `message`/`occurredAt`); stringify ids at the criticalAlerts
      // boundary so its store-key contract stays homogeneous with the
      // SNAPSHOT and REST-derived rows.
      const id = String(e.incidentId);
      criticalAlerts.add({
        id,
        incidentId: id,
        deviceId: String(e.deviceId),
        message: e.description,
        occurredAt: e.openedAt,
      });
      const now = Date.now();
      if (now - lastToastAt >= INCIDENT_TOAST_THROTTLE_MS) {
        lastToastAt = now;
        notify.error(`Critical incident: ${e.description}`);
      }
    });
    const unsubUpdated = wsClient.onEvent('INCIDENT_UPDATED', handleIncidentUpdated);
    const unsubSnapshot = wsClient.onEvent('SNAPSHOT', handleSnapshot);
    return () => {
      unsubCritical();
      unsubUpdated();
      unsubSnapshot();
      criticalAlerts.clear();
    };
  }, []);

  const onLogout = (): void => {
    void (async () => {
      await logout();
      navigate('/login', { replace: true });
    })();
  };

  return (
    <div className="oa-app">
      <CriticalAlertBar />
      <div className="oa-layout" data-nav-open={navOpen}>
        <Sidebar />
        <button
          type="button"
          className="oa-nav-backdrop"
          aria-label={t('topbar.closeMenu')}
          tabIndex={navOpen ? 0 : -1}
          onClick={() => {
            setNavOpen(false);
          }}
        />
        <div className="oa-layout__content">
          <header className="oa-topbar">
            <div className="oa-topbar__left">
              <button
                type="button"
                className="oa-topbar__menu-btn"
                aria-label={t('topbar.openMenu')}
                aria-expanded={navOpen}
                aria-controls="oa-sidebar"
                onClick={() => {
                  setNavOpen((open) => !open);
                }}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div className="oa-topbar__user">
                {user && (
                  <span className="oa-topbar__user-text">
                    {user.sub} ·{' '}
                    <span className="oa-topbar__role">{t(`roles.${user.role}`)}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="oa-header-tools">
              <LanguageSwitcher compact />
              <ThemeToggle compact />
              <LiveStatusIndicator />
              <Link to="/account" className="oa-topbar__account">
                {t('topbar.account')}
              </Link>
              <button type="button" className="oa-topbar__logout" onClick={onLogout}>
                {t('topbar.logout')}
              </button>
            </div>
          </header>
          <main className="oa-main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};
