// Vitest unit tests for the assignment-preview sanitizer.
//
// `sanitizePreviewResult` is the boundary between the raw backend
// `/api/assignments/preview` payload and the picker's view model. These
// tests pin the contract documented in src/api/resources/assignments.ts
// (`PreviewDevice` + `PreviewResult`): the picker must accept the real
// payload shape, expose `offline` so rows stay selectable regardless of
// status, and surface the `truncated` flag so the UI can show the cap.

import { describe, expect, it } from 'vitest';
import { sanitizePreviewResult } from '../useAssignmentPreview';

describe('sanitizePreviewResult', () => {
  it('parses a real PreviewResult payload into non-empty rows', () => {
    const payload = {
      devices: [
        {
          deviceId: 42,
          serialNumber: 'SN-001',
          name: 'Lobby A',
          status: 'online',
          offline: false,
          currentAssignmentId: 12,
          currentPlaylistId: 7,
        },
        {
          deviceId: 43,
          serialNumber: 'SN-002',
          name: 'Lobby B',
          status: 'OFFLINE',
          offline: true,
          currentAssignmentId: null,
          currentPlaylistId: null,
        },
      ],
      totalDevices: 2,
      returnedCount: 2,
      truncated: false,
    };

    const result = sanitizePreviewResult(payload);

    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toEqual({
      id: '42',
      name: 'Lobby A',
      serialNumber: 'SN-001',
      status: 'online',
      offline: false,
      currentAssignmentId: 12,
      currentPlaylistId: 7,
    });
    expect(result.totalDevices).toBe(2);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('preserves offline devices in the result (they are selectable downstream)', () => {
    const payload = {
      devices: [
        { deviceId: 1, name: 'D1', serialNumber: 'S1', status: 'online', offline: false },
        { deviceId: 2, name: 'D2', serialNumber: 'S2', status: 'offline', offline: true },
        { deviceId: 3, name: 'D3', serialNumber: 'S3', status: 'offline', offline: true },
      ],
      totalDevices: 3,
      returnedCount: 3,
      truncated: false,
    };

    const result = sanitizePreviewResult(payload);

    // Offline devices must round-trip — the assignment is by target scope
    // and offline devices sync on reconnect; the picker must not drop them.
    expect(result.devices).toHaveLength(3);
    const offlineIds = result.devices.filter((d) => d.offline).map((d) => d.id);
    expect(offlineIds).toEqual(['2', '3']);
  });

  it('surfaces truncation when returnedCount < totalDevices', () => {
    const payload = {
      devices: Array.from({ length: 200 }, (_, i) => ({
        deviceId: i + 1,
        name: `D${String(i + 1)}`,
        serialNumber: `S${String(i + 1)}`,
        status: 'online',
        offline: false,
      })),
      totalDevices: 537,
      returnedCount: 200,
      truncated: true,
    };

    const result = sanitizePreviewResult(payload);

    expect(result.devices).toHaveLength(200);
    expect(result.totalDevices).toBe(537);
    expect(result.returnedCount).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('derives truncated from counts when the flag is missing', () => {
    const payload = {
      devices: [
        { deviceId: 1, name: 'D1', serialNumber: 'S1', status: 'online', offline: false },
      ],
      totalDevices: 500,
      returnedCount: 1,
    };

    const result = sanitizePreviewResult(payload);

    expect(result.truncated).toBe(true);
  });

  it('liberally accepts unknown status strings without dropping the row', () => {
    const payload = {
      devices: [
        { deviceId: 1, name: 'D1', serialNumber: 'S1', status: 'PENDING_REVIEW', offline: false },
      ],
      totalDevices: 1,
      returnedCount: 1,
      truncated: false,
    };

    const result = sanitizePreviewResult(payload);

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.status).toBe('PENDING_REVIEW');
  });

  it('drops rows whose deviceId is missing or non-numeric', () => {
    const payload = {
      devices: [
        { deviceId: 1, name: 'ok', serialNumber: 'S1', status: 'online', offline: false },
        { deviceId: 'not-a-number', name: 'bad', serialNumber: 'S?', status: 'online', offline: false },
        { name: 'no-id', serialNumber: 'S?', status: 'online', offline: false },
      ],
      totalDevices: 3,
      returnedCount: 3,
      truncated: false,
    };

    const result = sanitizePreviewResult(payload);

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.id).toBe('1');
  });

  it('returns an empty result for completely malformed input', () => {
    expect(sanitizePreviewResult(null)).toEqual({
      devices: [],
      totalDevices: 0,
      returnedCount: 0,
      truncated: false,
    });
    expect(sanitizePreviewResult('not-an-object')).toEqual({
      devices: [],
      totalDevices: 0,
      returnedCount: 0,
      truncated: false,
    });
  });
});
