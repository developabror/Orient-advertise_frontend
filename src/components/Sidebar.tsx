import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRole } from '@hooks/useRole';
import type { Role } from '@api/auth';

interface NavItem {
  readonly to: string;
  // i18n key under `nav.*`; resolved to the active language at render time.
  readonly labelKey: string;
  // Exact-match only. Set on a parent route that must not stay highlighted while
  // a sibling child route (with its own nav entry) is active. Most parents
  // (e.g. `/devices`) intentionally stay active on their detail routes.
  readonly end?: boolean;
}

// Per-role nav lists. Advertisers intentionally see only their content section
// — fleet pages (incidents, devices, etc.) aren't part of their workflow and
// would surface data unrelated to their account.
// Ordering follows the operator's mental model, grouped by domain:
// Overview → Fleet (devices/sync groups) → Content → Monitoring → Administration.
// The `/reports` landing page is intentionally hidden for now — the route still
// exists, but no nav entry points to it. `/reports/playback` (Playback report)
// is a distinct feature and stays.
const NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  admin: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/devices', labelKey: 'nav.devices' },
    { to: '/sync-groups', labelKey: 'nav.syncGroups' },
    { to: '/content', labelKey: 'nav.content' },
    { to: '/playlists', labelKey: 'nav.playlists' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
    { to: '/users', labelKey: 'nav.users' },
    { to: '/settings', labelKey: 'nav.settings' },
  ],
  operator: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/devices', labelKey: 'nav.devices' },
    { to: '/sync-groups', labelKey: 'nav.syncGroups' },
    { to: '/content', labelKey: 'nav.content' },
    { to: '/playlists', labelKey: 'nav.playlists' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
    { to: '/settings', labelKey: 'nav.settings' },
  ],
  advertiser: [{ to: '/dashboard', labelKey: 'nav.myContent' }],
  viewer: [
    { to: '/dashboard', labelKey: 'nav.dashboard' },
    { to: '/devices', labelKey: 'nav.devices' },
    { to: '/incidents', labelKey: 'nav.incidents' },
    { to: '/events', labelKey: 'nav.events' },
    { to: '/reports/playback', labelKey: 'nav.playbackReport' },
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
