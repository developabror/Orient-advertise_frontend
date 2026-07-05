// Vitest unit tests for src/api/criticalAlerts.ts.
//
// Includes the INCIDENT_UPDATED dismissal/acknowledge wiring exposed
// via `handleIncidentUpdated`. The handler is a pure function so tests
// can simulate event arrival without driving the wsClient internals.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criticalAlerts, handleIncidentUpdated } from '../criticalAlerts';
import type { IncidentUpdatedEvent } from '../wsClient';

// Seed id matches `String(updatedEvent().incidentId)` so handleIncidentUpdated
// (which stringifies the wire `number` at the boundary) lands on the right row.
const seedAlert = (id = '1'): void => {
  criticalAlerts.add({
    id,
    incidentId: id,
    deviceId: '7',
    message: 'Device 7 went offline',
    occurredAt: '2026-05-08T10:00:00Z',
  });
};

const updatedEvent = (over: Partial<IncidentUpdatedEvent> = {}): IncidentUpdatedEvent => ({
  type: 'INCIDENT_UPDATED',
  // IncidentPayload carries numeric ids — handler stringifies at the
  // criticalAlerts boundary. Test fixtures use 1 + 7 here so the
  // stringified key matches the seeded `'1'` / `'1'` aliases below.
  incidentId: 1,
  deviceId: 7,
  eventType: 'DEVICE_OFFLINE',
  status: 'RESOLVED',
  priority: 'CRITICAL',
  description: 'Device 7 went offline',
  openedAt: '2026-05-08T10:00:00Z',
  updatedAt: '2026-05-08T10:05:00Z',
  actor: 'operator@orient',
  ...over,
});

beforeEach(() => {
  criticalAlerts.clear();
});

afterEach(() => {
  criticalAlerts.clear();
});

describe('criticalAlerts.add', () => {
  it('adds a new alert with default null ack fields', () => {
    seedAlert();
    const all = criticalAlerts.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.acknowledgedAt).toBeNull();
    expect(all[0]!.acknowledgedBy).toBeNull();
  });

  it('preserves existing ack state when re-adding the same id (WS reconnect replay)', () => {
    seedAlert();
    criticalAlerts.acknowledge('1', '2026-05-08T10:01:00Z', 'op@orient');

    // Server replays INCIDENT_CRITICAL on WS reconnect; calling add()
    // again with the same id must NOT clobber the ack state.
    seedAlert();

    const all = criticalAlerts.getAll();
    expect(all[0]!.acknowledgedAt).toBe('2026-05-08T10:01:00Z');
    expect(all[0]!.acknowledgedBy).toBe('op@orient');
  });
});

describe('criticalAlerts.acknowledge', () => {
  it('updates the alert in place, leaving it visible', () => {
    seedAlert();
    criticalAlerts.acknowledge('1', '2026-05-08T10:01:00Z', 'op@orient');

    const all = criticalAlerts.getAll();
    // Alert is still in the bar — ACKNOWLEDGED transitions don't dismiss.
    expect(all).toHaveLength(1);
    expect(all[0]!.acknowledgedAt).toBe('2026-05-08T10:01:00Z');
    expect(all[0]!.acknowledgedBy).toBe('op@orient');
  });

  it('is a no-op when the id is not in the store', () => {
    const sub = vi.fn();
    const unsub = criticalAlerts.subscribe(sub);
    sub.mockClear(); // ignore the initial-value broadcast on subscribe
    try {
      criticalAlerts.acknowledge('not-in-store', '2026-05-08T10:01:00Z', 'op');
      expect(sub).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });

  it('does not double-broadcast when called twice with the same values', () => {
    seedAlert();
    const sub = vi.fn();
    const unsub = criticalAlerts.subscribe(sub);
    sub.mockClear();
    try {
      criticalAlerts.acknowledge('1', '2026-05-08T10:01:00Z', 'op');
      criticalAlerts.acknowledge('1', '2026-05-08T10:01:00Z', 'op');
      expect(sub).toHaveBeenCalledTimes(1); // first call only
    } finally {
      unsub();
    }
  });

  it('accepts a null actor (system-driven acknowledge)', () => {
    seedAlert();
    criticalAlerts.acknowledge('1', '2026-05-08T10:01:00Z', null);
    const all = criticalAlerts.getAll();
    expect(all[0]!.acknowledgedBy).toBeNull();
    expect(all[0]!.acknowledgedAt).toBe('2026-05-08T10:01:00Z');
  });
});

describe('handleIncidentUpdated', () => {
  it('dismisses the alert when status === RESOLVED (the headline contract)', () => {
    seedAlert();
    expect(criticalAlerts.getAll()).toHaveLength(1);

    handleIncidentUpdated(updatedEvent({ status: 'RESOLVED' }));

    expect(criticalAlerts.getAll()).toHaveLength(0);
  });

  it('keeps the alert and marks it acknowledged when status === ACKNOWLEDGED', () => {
    seedAlert();
    handleIncidentUpdated(
      updatedEvent({
        status: 'ACKNOWLEDGED',
        updatedAt: '2026-05-08T10:01:00Z',
        actor: 'op@orient',
      }),
    );

    const all = criticalAlerts.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.acknowledgedAt).toBe('2026-05-08T10:01:00Z');
    expect(all[0]!.acknowledgedBy).toBe('op@orient');
  });

  it('forwards a null actor on system-driven ACKNOWLEDGED transitions', () => {
    seedAlert();
    handleIncidentUpdated(
      updatedEvent({
        status: 'ACKNOWLEDGED',
        updatedAt: '2026-05-08T10:01:00Z',
        actor: null,
      }),
    );

    const all = criticalAlerts.getAll();
    expect(all[0]!.acknowledgedBy).toBeNull();
  });

  it('is a no-op for status === OPEN (fresh OPEN comes via INCIDENT_CRITICAL, not here)', () => {
    seedAlert();
    const sub = vi.fn();
    const unsub = criticalAlerts.subscribe(sub);
    sub.mockClear();
    try {
      handleIncidentUpdated(updatedEvent({ status: 'OPEN' }));
      // Alert untouched — same store, no broadcast.
      expect(criticalAlerts.getAll()).toHaveLength(1);
      expect(sub).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });

  it('RESOLVED for an unknown id is a silent no-op (no throw)', () => {
    // Operator's tab missed the original INCIDENT_CRITICAL — the
    // RESOLVED arrives anyway. Must not blow up.
    expect(() =>
      handleIncidentUpdated(updatedEvent({ incidentId: 9999, status: 'RESOLVED' })),
    ).not.toThrow();
    expect(criticalAlerts.getAll()).toHaveLength(0);
  });
});
