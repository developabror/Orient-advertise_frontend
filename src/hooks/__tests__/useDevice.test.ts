// Integration test for useDevice's status reconciliation (Part A / A1). The
// detail endpoint serves the device's RAW persisted status, which is set to
// ONLINE at registration and never moved to OFFLINE — so a long-dead device
// would read "online" on the detail page. useDevice must reconcile against the
// heartbeat so it shows offline, matching the list. The pure reconcile math is
// covered in api/__tests__/deviceStatus.test.ts; this drives it through the hook.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@api/http', () => ({ http: { get: vi.fn() } }));

import { http } from '@api/http';
import { useDevice } from '../useDevice';

const NOW = Date.now();
const isoAgo = (ms: number): string => new Date(NOW - ms).toISOString();

const detail = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  serialNumber: 'SN-7',
  status: 'ONLINE',
  regionId: 1,
  facilityId: 2,
  deviceGroupId: 3,
  lastHeartbeatAt: isoAgo(60_000),
  ...over,
});

// useDevice fetches detail + playlist in parallel; resolve the playlist as
// empty so only the detail status matters.
const mockDetail = (payload: Record<string, unknown>): void => {
  vi.mocked(http.get).mockImplementation((url: string) =>
    url.endsWith('/playlist')
      ? Promise.resolve({ data: null } as never)
      : Promise.resolve({ data: payload } as never),
  );
};

const readyStatus = async (): Promise<string> => {
  const { result } = renderHook(() => useDevice('7'));
  await waitFor(() => {
    expect(result.current.state).toBe('ready');
  });
  const s = result.current;
  if (s.state !== 'ready') throw new Error('expected ready state');
  return s.device.status;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDevice — heartbeat-reconciled status (A1)', () => {
  it('renders offline for a stale heartbeat even when the raw status is ONLINE', async () => {
    mockDetail(detail({ status: 'ONLINE', lastHeartbeatAt: isoAgo(60 * 60 * 1000) }));
    expect(await readyStatus()).toBe('offline');
  });

  it('renders offline when lastHeartbeatAt is null (device never reported)', async () => {
    mockDetail(detail({ status: 'ONLINE', lastHeartbeatAt: null }));
    expect(await readyStatus()).toBe('offline');
  });

  it('renders online for a fresh heartbeat', async () => {
    mockDetail(detail({ status: 'ONLINE', lastHeartbeatAt: isoAgo(30_000) }));
    expect(await readyStatus()).toBe('online');
  });

  it('passes a healthy NO_CONTENT through (no longer folded into a catch-all)', async () => {
    // Forward-compat: when the backend serves computedStatus on detail, a fresh
    // device's real state flows straight through.
    mockDetail(detail({ computedStatus: 'NO_CONTENT', lastHeartbeatAt: isoAgo(30_000) }));
    expect(await readyStatus()).toBe('no-content');
  });
});

describe('useDevice — volume mapping', () => {
  const readyDevice = async () => {
    const { result } = renderHook(() => useDevice('7'));
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    const s = result.current;
    if (s.state !== 'ready') throw new Error('expected ready state');
    return s.device;
  };

  it('maps reportedVolume / effectiveVolume / volumeOverride from the detail DTO', async () => {
    mockDetail(
      detail({
        reportedVolume: 40,
        effectiveVolume: 55,
        volumeOverride: 55,
        lastHeartbeatAt: isoAgo(30_000),
      }),
    );
    const device = await readyDevice();
    expect(device.reportedVolume).toBe(40);
    expect(device.effectiveVolume).toBe(55);
    expect(device.volumeOverride).toBe(55);
  });

  it('falls back effectiveVolume to 100 and nulls reported/override when absent', async () => {
    mockDetail(detail({ lastHeartbeatAt: isoAgo(30_000) }));
    const device = await readyDevice();
    expect(device.effectiveVolume).toBe(100);
    expect(device.reportedVolume).toBeNull();
    expect(device.volumeOverride).toBeNull();
  });
});

describe('useDevice — sync group mapping', () => {
  const readyDevice = async () => {
    const { result } = renderHook(() => useDevice('7'));
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    const s = result.current;
    if (s.state !== 'ready') throw new Error('expected ready state');
    return s.device;
  };

  it('maps syncGroupId and syncGroupName from the detail DTO when present', async () => {
    mockDetail(detail({ syncGroupId: 42, syncGroupName: 'Mall entrance wall' }));
    const device = await readyDevice();
    expect(device.syncGroupId).toBe(42);
    expect(device.syncGroupName).toBe('Mall entrance wall');
  });

  it('nulls both when the device is in no sync group / the fields are absent', async () => {
    mockDetail(detail());
    const device = await readyDevice();
    expect(device.syncGroupId).toBeNull();
    expect(device.syncGroupName).toBeNull();
  });
});
