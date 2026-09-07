export { LoginPage } from './LoginPage';
export { ForgotPasswordPage } from './ForgotPasswordPage';
export { ResetPasswordPage } from './ResetPasswordPage';
export { AccountPage } from './AccountPage';
export { DashboardPage } from './DashboardPage';
export { AdvertiserContentDetailPage } from './AdvertiserContentDetailPage';
export { UsersPage } from './UsersPage';
export { UserAccessPage } from './UserAccessPage';
export { OperatorContentAccessPage } from './OperatorContentAccessPage';
export { DevicesPage } from './DevicesPage';
export { DeviceDetailPage } from './DeviceDetailPage';
// DeviceRemotePage is deliberately NOT exported here. It is code-split in
// App.tsx via a direct dynamic import; re-exporting it from this barrel would
// pull its scrcpy/WebCodecs dependencies back into the main chunk and undo the
// split. Import it from './DeviceRemotePage' directly if you ever need it.
export { ContentPage } from './ContentPage';
export { IncidentsPage } from './IncidentsPage';
export { EventsPage } from './EventsPage';
export { ReportsPage } from './ReportsPage';
export { DevicePlaybackReportPage } from './DevicePlaybackReportPage';
export { ForbiddenPage } from './ForbiddenPage';
export { NotFoundPage } from './NotFoundPage';
export { ProjectsPage } from './ProjectsPage';
export { RegionsPage } from './RegionsPage';
export { FacilitiesPage } from './FacilitiesPage';
export { DeviceGroupsPage } from './DeviceGroupsPage';
export { SyncGroupsPage } from './SyncGroupsPage';
export { PlaylistsPage } from './PlaylistsPage';
