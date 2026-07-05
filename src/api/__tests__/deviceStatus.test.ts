// Unit tests for the shared FE device-status model. This module is the single
// source of truth that the device list, detail page, and assign-content
// preview all route through — these tests pin the contract those surfaces rely
// on: the real enum maps 1:1 (no invented 'degraded'), a stale heartbeat forces
// offline, and the status filter maps each value to a distinct server enum.

import { describe, expect, it } from 'vitest';
import {
  OFFLINE_THRESHOLD_MS,
  STATUS_FILTER_OPTIONS,
  STATUS_FILTER_TO_API,
  STATUS_LABELS,
  mapStatus,
  reconcileStatus,
} from '../deviceStatus';

describe('mapStatus', () => {
  it('maps each backend enum 1:1 to a distinct FE status', () => {
    expect(mapStatus('ONLINE')).toBe('online');
    expect(mapStatus('OFFLINE')).toBe('offline');
    expect(mapStatus('NO_CONTENT')).toBe('no-content');
    expect(mapStatus('UNREGISTERED')).toBe('unregistered');
  });

  it('is case-insensitive', () => {
    expect(mapStatus('online')).toBe('online');
    expect(mapStatus('No_Content')).toBe('no-content');
  });

  it('falls back to "unknown" (never "degraded") for unexpected or non-string values', () => {
    expect(mapStatus('PROVISIONING')).toBe('unknown');
    expect(mapStatus('')).toBe('unknown');
    expect(mapStatus(null)).toBe('unknown');
    expect(mapStatus(undefined)).toBe('unknown');
    expect(mapStatus(7)).toBe('unknown');
  });

  it('never returns the legacy invented "degraded" value', () => {
    const results = ['ONLINE', 'OFFLINE', 'NO_CONTENT', 'UNREGISTERED', 'WAT', ''].map((s) =>
      mapStatus(s),
    );
    expect(results).not.toContain('degraded');
  });
});

describe('reconcileStatus', () => {
  const NOW = Date.parse('2026-06-02T12:00:00Z');
  const isoAgo = (ms: number): string => new Date(NOW - ms).toISOString();

  it('returns offline when lastHeartbeatAt is null, regardless of a raw ONLINE', () => {
    expect(reconcileStatus('ONLINE', null, NOW)).toBe('offline');
  });

  it('returns offline when the heartbeat is older than the threshold (phantom-ONLINE fix)', () => {
    expect(reconcileStatus('ONLINE', isoAgo(OFFLINE_THRESHOLD_MS + 1), NOW)).toBe('offline');
  });

  it('returns offline when the heartbeat timestamp is unparseable', () => {
    expect(reconcileStatus('ONLINE', 'not-a-date', NOW)).toBe('offline');
  });

  it('trusts the raw status when the heartbeat is fresh', () => {
    expect(reconcileStatus('ONLINE', isoAgo(60_000), NOW)).toBe('online');
    expect(reconcileStatus('NO_CONTENT', isoAgo(60_000), NOW)).toBe('no-content');
  });

  it('treats exactly-at-threshold as still fresh (boundary)', () => {
    expect(reconcileStatus('ONLINE', isoAgo(OFFLINE_THRESHOLD_MS), NOW)).toBe('online');
  });
});

describe('status filter mapping', () => {
  it('maps each filterable FE value 1:1 to a distinct backend enum', () => {
    expect(STATUS_FILTER_TO_API).toEqual({
      online: 'ONLINE',
      offline: 'OFFLINE',
      'no-content': 'NO_CONTENT',
      unregistered: 'UNREGISTERED',
    });
    const apiValues = Object.values(STATUS_FILTER_TO_API);
    expect(new Set(apiValues).size).toBe(apiValues.length); // no collisions → 1:1
  });

  it('never exposes a "degraded" filter (value or option)', () => {
    expect(STATUS_FILTER_TO_API).not.toHaveProperty('degraded');
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).not.toContain('degraded');
  });

  it('offers exactly the four real states plus "All", and never "unknown"', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      '',
      'online',
      'offline',
      'no-content',
      'unregistered',
    ]);
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).not.toContain('unknown');
  });
});

describe('STATUS_LABELS', () => {
  it('has a distinct operator-facing label for every FE status incl. the unknown fallback', () => {
    expect(STATUS_LABELS).toEqual({
      online: 'Online',
      offline: 'Offline',
      'no-content': 'No content',
      unregistered: 'Unregistered',
      unknown: 'Unknown',
    });
  });
});
