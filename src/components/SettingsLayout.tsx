import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRole } from '@hooks/useRole';

interface SubNavItem {
  readonly to: string;
  // i18n key under `settingsNav.*`; resolved at render time.
  readonly labelKey: string;
  readonly adminOnly?: boolean;
}

const SUB_NAV: readonly SubNavItem[] = [
  { to: '/settings/projects', labelKey: 'settingsNav.projects', adminOnly: true },
  { to: '/settings/regions', labelKey: 'settingsNav.regions' },
  { to: '/settings/facilities', labelKey: 'settingsNav.facilities' },
  { to: '/settings/groups', labelKey: 'settingsNav.deviceGroups' },
  { to: '/settings/sync-groups', labelKey: 'settingsNav.syncGroups' },
];

export const SettingsLayout = () => {
  const { t } = useTranslation();
  const role = useRole();
  const items = SUB_NAV.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <section className="oa-settings">
      <header className="oa-settings__header">
        <h1>{t('settingsNav.heading')}</h1>
      </header>
      <div className="oa-settings__layout">
        <nav className="oa-settings__subnav" aria-label={t('settingsNav.sectionsLabel')}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `oa-settings__sublink${isActive ? ' oa-settings__sublink--active' : ''}`
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="oa-settings__content">
          <Outlet />
        </div>
      </div>
    </section>
  );
};
