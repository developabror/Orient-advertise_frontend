import { Trans, useTranslation } from 'react-i18next';
import { useDashboardStats } from '@hooks/useDashboardStats';
import { useRecentIncidents } from '@hooks/useRecentIncidents';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { AdvertiserDashboard, RecentIncidentsCard, RegionsCard, StatCard } from '@components';

const formatTime = (date: Date): string =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const DashboardPage = () => {
  const { t } = useTranslation();
  const role = useRole();
  const { user } = useAuth();
  const { stats, lastUpdatedAt, isInitialLoading, isStale } = useDashboardStats();
  const {
    incidents,
    isInitialLoading: incidentsLoading,
    isStale: incidentsStale,
  } = useRecentIncidents();

  // Advertisers get a scoped view of just their content's play counts —
  // none of the fleet/incident data on the operator/admin dashboard applies.
  if (role === 'advertiser') {
    return <AdvertiserDashboard />;
  }

  return (
    <section className="oa-dashboard">
      <header className="oa-dashboard__header">
        <div>
          <h1 className="oa-dashboard__title">{t('dashboard.title')}</h1>
          {user && (
            <p className="oa-dashboard__subtitle">
              <Trans
                i18nKey="dashboard.signedInAs"
                values={{ name: user.sub, role: t(`roles.${user.role}`) }}
                components={[<strong key="name" />]}
              />
            </p>
          )}
        </div>
        <div className="oa-dashboard__status">
          {isStale && lastUpdatedAt !== null && (
            <span className="oa-dashboard__stale">
              {t('dashboard.showingStale', { time: formatTime(lastUpdatedAt) })}
            </span>
          )}
          {isStale && lastUpdatedAt === null && (
            <span className="oa-dashboard__stale">{t('dashboard.couldNotLoad')}</span>
          )}
          {!isStale && lastUpdatedAt !== null && (
            <span className="oa-dashboard__fresh">
              {t('dashboard.updated', { time: formatTime(lastUpdatedAt) })}
            </span>
          )}
        </div>
      </header>

      <div className="oa-stat-grid">
        <StatCard
          label={t('dashboard.stats.totalDevices')}
          value={stats.totalDevices}
          isLoading={isInitialLoading}
          isStale={isStale}
        />
        <StatCard
          label={t('dashboard.stats.onlineNow')}
          value={stats.onlineDevices}
          isLoading={isInitialLoading}
          isStale={isStale}
        />
        <StatCard
          label={t('dashboard.stats.offline')}
          value={stats.offlineDevices}
          isLoading={isInitialLoading}
          isStale={isStale}
        />
        <StatCard
          label={t('dashboard.stats.openIncidents')}
          value={stats.openIncidents}
          isLoading={isInitialLoading}
          isStale={isStale}
        />
      </div>

      <div className="oa-dashboard__widgets">
        <RegionsCard regions={stats.regions} isLoading={isInitialLoading} isStale={isStale} />
        <RecentIncidentsCard
          incidents={incidents}
          isLoading={incidentsLoading}
          isStale={incidentsStale}
        />
      </div>
    </section>
  );
};
