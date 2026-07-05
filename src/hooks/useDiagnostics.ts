import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDiagnostics,
  type ActionEntry,
  type DeviceDiagnostics,
  type EventEntry,
} from '@api/resources/deviceDiagnostics';

export type DiagnosticsActionStatus = 'pending' | 'completed' | 'failed';

export interface DiagnosticsAction {
  readonly id: string;
  readonly type: string;
  readonly status: DiagnosticsActionStatus;
  readonly requestedAt: string;
  readonly requestedBy: string;
}

export interface DiagnosticsEvent {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface Diagnostics {
  readonly lastHeartbeat: string | null;
  readonly contentVersion: string;
  readonly ipAddress: string;
  readonly recentEvents: readonly DiagnosticsEvent[];
  readonly recentActions: readonly DiagnosticsAction[];
}

export type DiagnosticsState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: Diagnostics }
  | { readonly kind: 'error' };

export interface DiagnosticsControls {
  readonly state: DiagnosticsState;
  readonly fetch: () => void;
  readonly close: () => void;
}

// Map the backend `RemoteAction.Status` enum (verbatim string from the
// resource layer) onto the three-bucket UI vocabulary the modal renders
// today. CONFIRMED_LATE is bucketed with CONFIRMED — it's still a
// successful execution, just past the soft deadline.
const mapActionStatus = (raw: string): DiagnosticsActionStatus => {
  switch (raw) {
    case 'PENDING':
      return 'pending';
    case 'CONFIRMED':
    case 'CONFIRMED_LATE':
      return 'completed';
    case 'EXPIRED':
    case 'FAILED':
    default:
      return 'failed';
  }
};

const eventToUi = (e: EventEntry): DiagnosticsEvent => ({
  id: String(e.id),
  type: e.eventType,
  // EventSummary carries an opaque `payload` string; render that when
  // present, else fall back to the type so the row is never blank.
  message: e.payload ?? e.eventType,
  occurredAt: e.occurredAt,
});

const actionToUi = (a: ActionEntry): DiagnosticsAction => ({
  id: String(a.id),
  type: a.actionType,
  status: mapActionStatus(a.status),
  requestedAt: a.issuedAt,
  requestedBy: a.issuedBy,
});

const toUi = (data: DeviceDiagnostics): Diagnostics => ({
  lastHeartbeat: data.lastHeartbeatAt,
  contentVersion: data.currentContentVersion ?? '—',
  ipAddress: data.lastKnownIp ?? '—',
  // Take the leading slice so the modal stays scannable even if the
  // server expands the cap on history depth.
  recentEvents: data.recentEvents.map(eventToUi).slice(0, 10),
  recentActions: data.recentActions.map(actionToUi).slice(0, 5),
});

export const useDiagnostics = (deviceId: string): DiagnosticsControls => {
  const [state, setState] = useState<DiagnosticsState>({ kind: 'closed' });
  const controllerRef = useRef<AbortController | null>(null);

  const fetch = useCallback((): void => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: 'loading' });

    const numericId = Number.parseInt(deviceId, 10);
    if (!Number.isFinite(numericId)) {
      setState({ kind: 'error' });
      return;
    }

    void (async () => {
      try {
        const data = await getDiagnostics(numericId);
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', data: toUi(data) });
      } catch (err: unknown) {
        if (controller.signal.aborted || axios.isCancel(err)) return;
        setState({ kind: 'error' });
      }
    })();
  }, [deviceId]);

  const close = useCallback((): void => {
    controllerRef.current?.abort();
    setState({ kind: 'closed' });
  }, []);

  // Cancel any outstanding request when the consumer unmounts so the modal
  // can't be left in 'loading' against a discarded component.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { state, fetch, close };
};
