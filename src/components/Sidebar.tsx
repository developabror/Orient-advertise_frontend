import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRole } from '@hooks/useRole';
import type { Role } from '@api/auth';

interface NavItem {
  readonly to: string;
  // i18n key under `nav.*`; resolved to the active language at render time.
  readonly labelKey: string;
  // Exact-match only. Used for `/reports` so it doesn't stay highlighted on the
  // sibling `/reports/playback` route (which has its own nav entry). Other
  // parents (e.g. `/devices`) intentionally stay active on their detail routes.
  readonly end?: boolean;
}

// Per-role nav lists. Advertisers intentionally see only their content section
// — fleet pages (incidents, devices, etc.) aren't part of their workflow and
// would surface data unrelated to their account.
const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  admin: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports', labelKey: 'nav.reports', end: true },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
    { to: '/devices', labelKey: 'nav.devices' },
    { to: '/content', labelKey: 'nav.content' },
    { to: '/playlists', labelKey: 'nav.playlists' },
    { to: '/users', labelKey: 'nav.users' },
    { to: '/settings', labelKey: 'nav.settings' },
  ],
  operator: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports', labelKey: 'nav.reports', end: true },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
    { to: '/devices', labelKey: 'nav.devices' },
    { to: '/content', labelKey: 'nav.content' },
    { to: '/playlists', labelKey: 'nav.playlists' },
    { to: '/settings', labelKey: 'nav.settings' },
  ],
  advertiser: [{ to: '/dashboard', labelKey: 'nav.myContent' }],
  viewer: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports', labelKey: 'nav.reports', end: true },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
    { to: '/devices', labelKey: 'nav.devices' },
  ],
};

export const Sidebar = () => {
  const { t } = useTranslation();
  const role = useRole();
  const items = role === null ? [] : NAV_BY_ROLE[role];

  return (
    <aside id="oa-sidebar" className="oa-sidebar" aria-label={t('topbar.primaryNav')}>
      <div className="oa-sidebar__brand">{t('topbar.brand')}</div>
      <nav className="oa-sidebar__nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              `oa-sidebar__link${isActive ? ' oa-sidebar__link--active' : ''}`
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};
