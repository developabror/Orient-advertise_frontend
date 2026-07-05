// Backend-enum string-literal unions, centralized.
//
// These mirror backend enums in
// domain/src/main/java/.../{Role,Device,Event,Incident,ContentFile,
// RemoteAction,Assignment,Schedule,Target}.java. **When a backend
// enum changes, update here in the same PR or downstream fields
// silently fail validation.**
//
// This file is documentation (and a single import point), NOT a
// runtime safeguard — the actual contract is enforced by the
// backend tests and OpenAPI schema. The unions just give the FE
// type-system help so consumers don't have to remember the case.
//
// Cases are uppercase across the board — match the wire shape exactly.

/** Backend `Role`. The FE auth.ts uses a separate lowercase shape for routing. */
export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'ADVERTISER';

/** Backend `Device.Status`. */
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'NO_CONTENT' | 'UNREGISTERED';

/** Backend `Priority` — shared across events and incidents. */
export type EventPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** Backend `Incident.Status`. */
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

/** Backend `ContentFile.Status`. */
export type ContentStatus = 'UPLOADED' | 'TRANSCODING' | 'READY' | 'FAILED' | 'INVALID';

/** Backend `DeviceActionType`. */
export type DeviceActionType =
  | 'REBOOT'
  | 'SYNC_CONTENT'
  | 'VOLUME_SET'
  | 'PLAYBACK_PAUSE'
  | 'PLAYBACK_RESUME'
  | 'GET_DIAGNOSTICS';

/** Backend `RemoteAction.Status` — operator-facing history view. */
export type RemoteActionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CONFIRMED_LATE'
  | 'EXPIRED'
  | 'FAILED';

/** Backend `Assignment.Status`. */
export type AssignmentStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

/** Backend `Schedule.RepeatType`. */
export type ScheduleRepeatType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** Backend `TargetType` — the three valid assignment scoping levels. */
export type TargetType = 'REGION' | 'FACILITY' | 'DEVICE_GROUP';
