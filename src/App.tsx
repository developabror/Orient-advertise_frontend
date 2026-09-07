import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout, ProtectedRoute, SettingsLayout } from '@components';
import {
  AccountPage,
  AdvertiserContentDetailPage,
  ContentPage,
  DashboardPage,
  DeviceDetailPage,
  DeviceGroupsPage,
  DevicePlaybackReportPage,
  DevicesPage,
  EventsPage,
  FacilitiesPage,
  ForbiddenPage,
  ForgotPasswordPage,
  IncidentsPage,
  LoginPage,
  NotFoundPage,
  PlaylistsPage,
  ProjectsPage,
  RegionsPage,
  ReportsPage,
  ResetPasswordPage,
  SyncGroupsPage,
  OperatorContentAccessPage,
  UserAccessPage,
  UsersPage,
} from '@pages';

/**
 * The only lazily-loaded page, and the only one imported outside `@pages`.
 *
 * It pulls in the scrcpy protocol client and the WebCodecs decoder — ~90 kB
 * (~29 kB gzipped) that every operator would otherwise download on every
 * dashboard load for a screen most sessions never open. Importing it through
 * the `@pages` barrel would put it straight back in the main chunk, which is
 * why `pages/index.ts` deliberately does not re-export it.
 */
const DeviceRemotePage = lazy(async () => ({
  default: (await import('./pages/DeviceRemotePage')).DeviceRemotePage,
}));

export const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/forbidden" element={<ForbiddenPage />} />

    <Route element={<ProtectedRoute />}>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/my-content/:contentId" element={<AdvertiserContentDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/reports" element={<ReportsPage />} />

        {/* Playback report — backend allows VIEWER (200); only ADVERTISER is 403. */}
        <Route element={<ProtectedRoute roles={['admin', 'operator', 'viewer']} />}>
          <Route path="/reports/playback" element={<DevicePlaybackReportPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['admin', 'operator', 'advertiser']} />}>
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['admin', 'operator']} />}>
          {/* Remote viewer sits in the admin/operator block, NOT beside
              /devices/:id above — that block admits `advertiser`, who must
              never reach a live screen (contract §7 rule 6). */}
          <Route
            path="/devices/:id/remote"
            element={
              <Suspense fallback={null}>
                <DeviceRemotePage />
              </Suspense>
            }
          />
          <Route path="/content" element={<ContentPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          {/* Sync groups: promoted out of /settings into a top-level nav item. */}
          <Route path="/sync-groups" element={<SyncGroupsPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/regions" replace />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="regions" element={<RegionsPage />} />
            <Route path="facilities" element={<FacilitiesPage />} />
            <Route path="groups" element={<DeviceGroupsPage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:userId/access" element={<UserAccessPage />} />
          <Route path="/users/:userId/operator-access" element={<OperatorContentAccessPage />} />
        </Route>
      </Route>
    </Route>

    <Route path="*" element={<NotFoundPage />} />
  </Routes>
);
