export { env } from './env';
export { AuthContext, tokenToUser } from './auth';
export type { AuthContextValue, AuthUser, Role } from './auth';
export { AuthProvider } from './AuthProvider';
export { http } from './http';
export { tokenStore } from './tokenStore';
export { notify } from './notify';
export type { Toast, ToastKind } from './notify';
export { errorDialog, onErrorDialog, markErrorHandled } from './errorDialog';
export type { ErrorDialog, ErrorDialogContent } from './errorDialog';
export { criticalAlerts } from './criticalAlerts';
export type { CriticalAlert } from './criticalAlerts';
export { wsClient } from './wsClient';
export { planBulkSelection, runBulkGroupActions } from './bulkDeviceActions';
export type {
  BulkPlan,
  BulkSummary,
  DeviceGroupAction,
  GroupResult,
  RunBulkResult,
} from './bulkDeviceActions';
export type {
  WsStatus,
  WsEvent,
  WsEventType,
  IncidentCriticalEvent,
  DeviceStatusChangeEvent,
  DeviceWsStatus,
  IncidentUpdatedEvent,
  IncidentStatus,
  IncidentPriority,
  SnapshotEvent,
} from './wsClient';
export { isErrorResponse, extractFieldErrors, extractApiMessage, parsePage } from './resources/_types';
export type { Page, Pageable, ErrorResponse, FieldError } from './resources/_types';
export type {
  AssignmentStatus,
  ContentStatus,
  DeviceActionType as BackendDeviceActionType,
  DeviceStatus as BackendDeviceStatus,
  EventPriority as BackendEventPriority,
  IncidentStatus as BackendIncidentStatus,
  RemoteActionStatus as BackendRemoteActionStatus,
  Role as BackendRole,
  ScheduleRepeatType,
  TargetType as BackendTargetType,
} from './resources/_enums';
export { normalizeError } from './errorNormalize';
export type { NormalizedError } from './errorNormalize';
export { getDashboardSummary } from './resources/dashboard';
export type {
  DashboardSummary,
  OpenIncidentCounts,
  RegionSummary,
} from './resources/dashboard';
export {
  acknowledgeIncident,
  listOpenIncidents,
  resolveIncident,
} from './resources/incidents';
export type { IncidentDto } from './resources/incidents';
export {
  clearDeviceVolume,
  deleteDevice,
  getDevice,
  listDevices,
  setAllDevicesVolume,
  setDeviceVolume,
  updateDevice,
  updateDeviceLocation,
} from './resources/devices';
export type {
  DeviceDetail,
  DeviceListFilters,
  DeviceListItem,
  DeviceStatus,
} from './resources/devices';
export {
  getDiagnostics,
  issueDeviceAction,
  listDeviceActionHistory,
  playlistControl,
} from './resources/deviceDiagnostics';
export type {
  ActionEntry,
  DeviceActionHistoryFilters,
  DeviceActionRequest,
  DeviceActionType,
  DeviceDiagnostics,
  EventEntry,
  PlaylistControlAction,
  PlaylistControlRequest,
  RemoteActionDto,
  RemoteActionResponse,
  RemoteActionStatus,
} from './resources/deviceDiagnostics';
export { listEvents } from './resources/events';
export type { EventDto, EventFilters, EventPriority } from './resources/events';
export { exportExcel, getEventReport, pollReportJob, RateLimitedError } from './resources/reports';
export type {
  EventReport,
  EventReportFilters,
  EventReportResponse,
  ExportFilters,
  ExportType,
  JobResponse,
  TopAffectedDevice,
} from './resources/reports';
export {
  cancelAssignment,
  confirmAssignment,
  createDraft,
  previewAssignment,
} from './resources/assignments';
export type {
  AssignmentResponse,
  ConfirmAssignmentRequest,
  CreateDraftRequest,
  PreviewDevice,
  PreviewResult,
  TargetType,
} from './resources/assignments';
export {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
} from './resources/schedules';
export type {
  CreateScheduleRequest,
  OverlapWarning,
  RepeatType,
  ScheduleDetail,
  ScheduleListFilters,
  ScheduleResponse,
  ScheduleSummary,
  UpdateScheduleRequest,
} from './resources/schedules';
export { createUser, deleteUser, getUser, listUsers } from './resources/users';
export type {
  CreateUserRequest,
  Role as UserRole,
  UserDetailResponse,
  UserResponse,
} from './resources/users';
export { linkContent, listLinkedContent, unlinkContent } from './resources/advertiserContent';
export type { LinkedContent } from './resources/advertiserContent';
export {
  linkOperatorContent,
  listLinkedOperatorContent,
  unlinkOperatorContent,
} from './resources/operatorContent';
export { listApiKeys, mintApiKey, revokeApiKey } from './resources/apiKeys';
export type { ApiKeyStatus, ApiKeySummary, CreatedKey } from './resources/apiKeys';
export {
  deleteFile,
  downloadFile,
  getPresignedUrl,
  getStorageStatus,
  uploadFile,
} from './resources/files';
export type {
  PresignedUrlResponse,
  StorageStatus,
  UploadResponse as FileUploadResponse,
} from './resources/files';
export {
  InvalidVideoFileError,
  isWebSocketPushResult,
  uploadContent,
} from './resources/contentUpload';
export type {
  InvalidVideoFileReason,
  UploadResponse as ContentUploadResponse,
  WebSocketPushResult,
} from './resources/contentUpload';
export { reportPlayback } from './resources/playback';
export type { BatchRejection, BatchResponse, PlaybackEntry } from './resources/playback';
export { getHealth } from './resources/health';
export type { ComponentStatus, HealthResponse, HealthStatus } from './resources/health';
export { getMe } from './resources/me';
export type { MeResponse } from './resources/me';
export {
  getContent,
  getContentStreamUrl,
  listContent,
  setContentProject,
  softDeleteContent,
} from './resources/content';
export type {
  ContentFileDetail,
  ContentFileStatus,
  ContentFileSummary,
  ContentListFilters,
  StreamUrlResponse,
} from './resources/content';
export {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistItem,
  removePlaylistItem,
  renamePlaylist,
  reorderPlaylistItems,
  setItemDurationOverride,
} from './resources/playlists';
export type {
  PlaylistDetail,
  PlaylistItemDto,
  PlaylistListFilters,
  PlaylistSummary,
} from './resources/playlists';
export {
  addDevicesToGroup,
  clearDeviceGroupVolume,
  createDeviceGroup,
  deleteDeviceGroup,
  getDeviceGroup,
  listDeviceGroups,
  removeDeviceFromGroup,
  renameDeviceGroup,
  setDeviceGroupVolume,
} from './resources/deviceGroups';
export type {
  AddDevicesResult,
  DeviceGroupDetail,
  DeviceGroupListFilters,
  DeviceGroupMember,
  DeviceGroupSummary,
} from './resources/deviceGroups';
export {
  addDevicesToSyncGroup,
  createSyncGroup,
  deleteSyncGroup,
  getSyncGroup,
  listSyncGroups,
  removeDeviceFromSyncGroup,
  renameSyncGroup,
} from './resources/syncGroups';
export type {
  SyncGroupDetail,
  SyncGroupListFilters,
  SyncGroupMember,
  SyncGroupSummary,
} from './resources/syncGroups';
export {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
} from './resources/projects';
export type { ProjectDetail, ProjectSummary } from './resources/projects';
export {
  addProjectOperator,
  getProjectOperators,
  removeProjectOperator,
  setProjectOperators,
} from './resources/projectOperators';
export type { OperatorRef } from './resources/projectOperators';
export {
  createRegion,
  deleteRegion,
  getRegion,
  listRegions,
  updateRegion,
} from './resources/regions';
// Aliased: dashboard.ts already exports `RegionSummary` for the
// per-region dashboard rollup (deviceCounts). The org-tree DTO is a
// different shape (id/code/name/facilityCount/timestamps), so it's
// re-exported as `RegionRecord` here to avoid the collision.
export type {
  RegionDetail,
  RegionListFilters,
  RegionSummary as RegionRecord,
} from './resources/regions';
export {
  createFacility,
  deleteFacility,
  getFacility,
  listFacilities,
  renameFacility,
} from './resources/facilities';
export type {
  FacilityDetail,
  FacilityListFilters,
  FacilitySummary,
} from './resources/facilities';
