import type { IncidentUpdatedEvent, SnapshotEvent } from './wsClient';

export interface CriticalAlert {
  readonly id: string;
  readonly incidentId: string;
  readonly deviceId: string;
  readonly message: string;
  readonly occurredAt: string;
  // ACKNOWLEDGED transitions populate these via `handleIncidentUpdated`
  // (wired up to wsClient INCIDENT_UPDATED in AppLayout). Null until the
  // operator acknowledges; stays null forever if the operator resolves
  // directly without an ack step in between.
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
}

type Listener = (alerts: readonly CriticalAlert[]) => void;

const store = new Map<string, CriticalAlert>();
const listeners = new Set<Listener>();

const snapshot = (): readonly CriticalAlert[] => {
  return Array.from(store.values()).sort((a, b) => {
    if (a.occurredAt < b.occurredAt) return 1;
    if (a.occurredAt > b.occurredAt) return -1;
    return 0;
  });
};

const broadcastChange = (): void => {
  const next = snapshot();
  listeners.forEach((fn) => {
    fn(next);
  });
};

/**
 * Shape callers pass to `add` — ack fields are filled in by the store
 * itself (default null on first add; preserved on re-add so that a WS
 * reconnect re-delivering an INCIDENT_CRITICAL doesn't clobber an
 * already-acknowledged state).
 */
type AddInput = Omit<CriticalAlert, 'acknowledgedAt' | 'acknowledgedBy'>;

export const criticalAlerts = {
  getAll: snapshot,

  add: (alert: AddInput): void => {
    // Dedupe by id — server may resend recent incidents on WS reconnect.
    // If the alert was already in the store with an ack state, preserve
    // it: the server replaying a CRITICAL doesn't un-acknowledge it.
    const existing = store.get(alert.id);
    const next: CriticalAlert = {
      ...alert,
      acknowledgedAt: existing?.acknowledgedAt ?? null,
      acknowledgedBy: existing?.acknowledgedBy ?? null,
    };
    store.set(alert.id, next);
    broadcastChange();
  },

  dismiss: (id: string): void => {
    if (store.delete(id)) broadcastChange();
  },

  /**
   * Mark an alert as acknowledged in place. Idempotent — repeated calls
   * with the same `(acknowledgedAt, acknowledgedBy)` pair don't fire
   * an extra broadcast. No-op when the id isn't in the store (the
   * operator already dismissed it locally, or this client never saw
   * the original CRITICAL).
   */
  acknowledge: (id: string, acknowledgedAt: string, acknowledgedBy: string | null): void => {
    const existing = store.get(id);
    if (existing === undefined) return;
    if (
      existing.acknowledgedAt === acknowledgedAt &&
      existing.acknowledgedBy === acknowledgedBy
    ) {
      return;
    }
    store.set(id, { ...existing, acknowledgedAt, acknowledgedBy });
    broadcastChange();
  },

  clear: (): void => {
    if (store.size === 0) return;
    store.clear();
    broadcastChange();
  },

  subscribe: (fn: Listener): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/**
 * Pure handler for WS `INCIDENT_UPDATED` events. Wired into wsClient at
 * a **single subscription point** (AppLayout) so two separate component
 * trees can't race a double-dismiss.
 *
 *   - `RESOLVED` → dismiss the alert (operator no longer needs to see it).
 *   - `ACKNOWLEDGED` → keep the alert visible but mark it acknowledged
 *     so the bar can render a softer style for already-handled rows.
 *   - `OPEN` → no action. A fresh OPEN incident is delivered via
 *     `INCIDENT_CRITICAL`, not via this handler; an OPEN-after-RESOLVED
 *     re-open scenario would also re-fire `INCIDENT_CRITICAL` server-side.
 *
 * Exported as a pure function so unit tests can simulate event arrival
 * without driving the wsClient internals.
 */
export const handleIncidentUpdated = (event: IncidentUpdatedEvent): void => {
  // incidentId on the wire is `number`; criticalAlerts is keyed by string
  // (matches `String(IncidentDto.id)` from REST + the SNAPSHOT path).
  const id = String(event.incidentId);
  if (event.status === 'RESOLVED') {
    criticalAlerts.dismiss(id);
    return;
  }
  if (event.status === 'ACKNOWLEDGED') {
    criticalAlerts.acknowledge(id, event.updatedAt, event.actor);
  }
};

/**
 * Pure handler for WS `SNAPSHOT` events. The server guarantees this is
 * the FIRST frame on every new connection (see {@link SnapshotEvent}),
 * so this handler **clears the local store and repopulates from the
 * snapshot** — that's the canonical state at the moment of connect.
 *
 * Filters to CRITICAL-priority incidents only (the alert bar is for
 * critical events; lower-priority incidents live in their own table).
 *
 * Each row is mapped from the resource-layer IncidentDto shape (numeric
 * ids, `description` field) into the criticalAlerts wire shape (string
 * ids, `message` field) the existing INCIDENT_CRITICAL handler also
 * writes to.
 */
export const handleSnapshot = (event: SnapshotEvent): void => {
  criticalAlerts.clear();
  for (const inc of event.openIncidents) {
    if (inc.priority !== 'CRITICAL') continue;
    criticalAlerts.add({
      id: String(inc.id),
      incidentId: String(inc.id),
      deviceId: String(inc.deviceId),
      message: inc.description,
      occurredAt: inc.openedAt,
    });
  }
};
