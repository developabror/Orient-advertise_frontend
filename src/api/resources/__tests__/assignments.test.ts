// Vitest unit tests for src/api/resources/assignments.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  ASSIGNMENT_TIME_OVERLAP,
  cancelAssignment,
  confirmAssignment,
  createDraft,
  parseOverlapDetails,
  previewAssignment,
  type AssignmentResponse,
  type PreviewResult,
  type TargetType,
} from '../assignments';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const makeAxiosError = (status: number, message = ''): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${String(status)}`,
  response: {
    status,
    statusText: '',
    data: {
      status,
      error: '',
      message,
      correlationId: `corr-${String(status)}`,
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const fixtureAssignment = (over: Partial<AssignmentResponse> = {}): AssignmentResponse => ({
  id: 50,
  playlistId: 7,
  targetType: 'FACILITY',
  targetId: 100,
  priority: 10,
  startTime: '2026-05-08T10:00:00Z',
  endTime: '2026-05-08T18:00:00Z',
  status: 'DRAFT',
  createdAt: '2026-05-08T09:59:00Z',
  ...over,
});

const fixturePreview = (over: Partial<PreviewResult> = {}): PreviewResult => ({
  devices: [
    {
      deviceId: 1,
      serialNumber: 'SN-1',
      name: 'Lobby',
      status: 'ONLINE',
      offline: false,
      currentAssignmentId: null,
      currentPlaylistId: null,
    },
    {
      deviceId: 2,
      serialNumber: 'SN-2',
      name: 'Atrium',
      status: 'OFFLINE',
      offline: true,
      currentAssignmentId: 49,
      currentPlaylistId: 6,
    },
  ],
  totalDevices: 2,
  returnedCount: 2,
  truncated: false,
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('createDraft', () => {
  it('POSTs /api/assignments with the request body verbatim and returns the DTO', async () => {
    const result = fixtureAssignment();
    mockPost.mockResolvedValueOnce({ data: result });

    const body = {
      playlistId: 7,
      targetType: 'FACILITY' as TargetType,
      targetId: 100,
      startTime: '2026-05-08T10:00:00Z',
      endTime: '2026-05-08T18:00:00Z',
    };
    const dto = await createDraft(body);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/assignments', body);
    // Two positional args (url + body) — no third per-request config arg,
    // which would otherwise risk leaking Authorization-header overrides.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
    expect(dto).toBe(result);
  });

  it('passes every TargetType enum value through verbatim', async () => {
    const types: readonly TargetType[] = ['REGION', 'FACILITY', 'DEVICE_GROUP'];
    for (const targetType of types) {
      mockPost.mockResolvedValueOnce({ data: fixtureAssignment({ targetType }) });
      await createDraft({
        playlistId: 1,
        targetType,
        targetId: 1,
        startTime: '2026-05-08T10:00:00Z',
        endTime: '2026-05-08T11:00:00Z',
      });
      const sentBody = mockPost.mock.calls.at(-1)![1] as { targetType: TargetType };
      expect(sentBody.targetType).toBe(targetType);
    }
    expect(mockPost).toHaveBeenCalledTimes(types.length);
  });

  it('lets a 400 (validation) axios error bubble unchanged', async () => {
    const err = makeAxiosError(400, 'startTime must be before endTime');
    mockPost.mockRejectedValueOnce(err);

    await expect(
      createDraft({
        playlistId: 1,
        targetType: 'REGION',
        targetId: 1,
        startTime: '2026-05-08T18:00:00Z',
        endTime: '2026-05-08T10:00:00Z',
      }),
    ).rejects.toBe(err);
  });
});

describe('confirmAssignment', () => {
  it('POSTs /api/assignments/{id}/confirm with the request body and returns the DTO', async () => {
    const confirmed = fixtureAssignment({ status: 'CONFIRMED' });
    mockPost.mockResolvedValueOnce({ data: confirmed });

    const dto = await confirmAssignment(50, {
      excludedDeviceIds: [1, 2],
      reason: 'Skipping kiosks under maintenance',
    });

    expect(mockPost).toHaveBeenCalledWith('/api/assignments/50/confirm', {
      excludedDeviceIds: [1, 2],
      reason: 'Skipping kiosks under maintenance',
    });
    expect(dto).toBe(confirmed);
  });

  it('forwards an empty body when both fields are absent', async () => {
    const confirmed = fixtureAssignment({ status: 'CONFIRMED' });
    mockPost.mockResolvedValueOnce({ data: confirmed });

    await confirmAssignment(50, {});

    expect(mockPost).toHaveBeenCalledWith('/api/assignments/50/confirm', {});
  });

  it('forwards an empty excludedDeviceIds array verbatim (distinct from absent)', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAssignment() });

    await confirmAssignment(50, { excludedDeviceIds: [] });

    expect(mockPost).toHaveBeenCalledWith('/api/assignments/50/confirm', {
      excludedDeviceIds: [],
    });
  });

  it('forwards includedDeviceIds verbatim (the device-aware inclusion allow-list)', async () => {
    mockPost.mockResolvedValueOnce({ data: fixtureAssignment() });

    await confirmAssignment(50, { includedDeviceIds: [1, 2, 3] });

    expect(mockPost).toHaveBeenCalledWith('/api/assignments/50/confirm', {
      includedDeviceIds: [1, 2, 3],
    });
  });

  it('lets a 409 (overlap re-check) axios error bubble unchanged', async () => {
    const err = makeAxiosError(409, 'Assignment overlaps an existing CONFIRMED window');
    mockPost.mockRejectedValueOnce(err);

    await expect(confirmAssignment(50, {})).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('overlaps');
  });

  it('lets a 404 (missing excluded device) axios error bubble unchanged', async () => {
    const err = makeAxiosError(404, 'Excluded device 999 not found under target');
    mockPost.mockRejectedValueOnce(err);

    await expect(confirmAssignment(50, { excludedDeviceIds: [999] })).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(404);
    expect(surface.response?.data?.message).toContain('not found');
  });

  it('does not double-call http.post on failure', async () => {
    mockPost.mockRejectedValueOnce(makeAxiosError(409));
    await expect(confirmAssignment(50, {})).rejects.toBeDefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('cancelAssignment', () => {
  it('issues DELETE /api/assignments/{id}', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await cancelAssignment(50);
    expect(mockDelete).toHaveBeenCalledWith('/api/assignments/50');
  });

  it('lets a 409 (cancel refused) axios error bubble unchanged for verbatim inline surfacing', async () => {
    const err = makeAxiosError(409, 'Assignment is already cancelled');
    mockDelete.mockRejectedValueOnce(err);
    await expect(cancelAssignment(50)).rejects.toBe(err);
    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('cancelled');
  });

  it('lets a 404 (unknown assignment) bubble unchanged', async () => {
    const err = makeAxiosError(404, 'Assignment 99 not found');
    mockDelete.mockRejectedValueOnce(err);
    await expect(cancelAssignment(99)).rejects.toBe(err);
  });
});

describe('previewAssignment', () => {
  it('GETs /api/assignments/preview with the targetType + targetId query params', async () => {
    const preview = fixturePreview();
    mockGet.mockResolvedValueOnce({ data: preview });

    const result = await previewAssignment('FACILITY', 100);

    expect(mockGet).toHaveBeenCalledWith('/api/assignments/preview', {
      params: { targetType: 'FACILITY', targetId: 100 },
    });
    // Verbatim pass-through.
    expect(result).toBe(preview);
  });

  it('passes every TargetType verbatim and preserves the targetId number', async () => {
    const types: readonly TargetType[] = ['REGION', 'FACILITY', 'DEVICE_GROUP'];
    for (const targetType of types) {
      mockGet.mockResolvedValueOnce({ data: fixturePreview() });
      await previewAssignment(targetType, 42);
      expect(mockGet).toHaveBeenLastCalledWith('/api/assignments/preview', {
        params: { targetType, targetId: 42 },
      });
    }
  });

  it('returns truncation flags verbatim so the UI can surface the cap', async () => {
    const truncated = fixturePreview({
      totalDevices: 500,
      returnedCount: 100,
      truncated: true,
    });
    mockGet.mockResolvedValueOnce({ data: truncated });

    const result = await previewAssignment('REGION', 1);

    expect(result.truncated).toBe(true);
    expect(result.totalDevices).toBe(500);
    expect(result.returnedCount).toBe(100);
  });

  it('returns nullable currentAssignmentId / currentPlaylistId per device verbatim', async () => {
    mockGet.mockResolvedValueOnce({ data: fixturePreview() });

    const result = await previewAssignment('FACILITY', 100);

    // First device has no current assignment (null/null); second is mid-window.
    expect(result.devices[0]!.currentAssignmentId).toBeNull();
    expect(result.devices[0]!.currentPlaylistId).toBeNull();
    expect(result.devices[1]!.currentAssignmentId).toBe(49);
    expect(result.devices[1]!.currentPlaylistId).toBe(6);
  });

  it('propagates errors unchanged', async () => {
    const err = new Error('Network Error');
    mockGet.mockRejectedValueOnce(err);
    await expect(previewAssignment('REGION', 1)).rejects.toBe(err);
  });
});

describe('parseOverlapDetails', () => {
  const overlapBody = (over: Record<string, unknown> = {}): unknown => ({
    status: 409,
    error: 'Conflict',
    message: 'Time overlap with existing assignment(s) [3, 4] for REGION:1',
    details: {
      code: ASSIGNMENT_TIME_OVERLAP,
      targetType: 'REGION',
      targetId: 1,
      conflicts: [
        { id: 3, startTime: '2026-06-03T09:00:00Z', endTime: '2026-06-03T13:00:00Z' },
        { id: 4, startTime: '2026-06-03T13:00:00Z', endTime: '2026-06-03T18:00:00Z' },
      ],
      ...over,
    },
  });

  it('parses a well-formed overlap envelope into typed conflicts', () => {
    const result = parseOverlapDetails(overlapBody());
    expect(result).not.toBeNull();
    expect(result!.code).toBe(ASSIGNMENT_TIME_OVERLAP);
    expect(result!.targetType).toBe('REGION');
    expect(result!.targetId).toBe(1);
    expect(result!.conflicts).toHaveLength(2);
    expect(result!.conflicts[1]).toEqual({
      id: 4,
      startTime: '2026-06-03T13:00:00Z',
      endTime: '2026-06-03T18:00:00Z',
    });
  });

  it('parses the enriched conflict fields (playlistId/playlistName/status) when present', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [
          {
            id: 6,
            startTime: '2026-06-04T14:37:00Z',
            endTime: '2100-01-01T00:00:00.000Z',
            playlistId: 9,
            playlistName: 'Korzinka promo',
            status: 'CONFIRMED',
          },
        ],
      }),
    );
    expect(result!.conflicts[0]).toEqual({
      id: 6,
      startTime: '2026-06-04T14:37:00Z',
      endTime: '2100-01-01T00:00:00.000Z',
      playlistId: 9,
      playlistName: 'Korzinka promo',
      status: 'CONFIRMED',
    });
  });

  it('tolerates absent enrichment fields (back-compat) — base fields only, no undefined keys', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [{ id: 6, startTime: '2026-06-04T14:37:00Z', endTime: '2026-06-04T18:00:00Z' }],
      }),
    );
    expect(result!.conflicts[0]).toEqual({
      id: 6,
      startTime: '2026-06-04T14:37:00Z',
      endTime: '2026-06-04T18:00:00Z',
    });
    expect('playlistName' in result!.conflicts[0]!).toBe(false);
  });

  it('drops only a malformed enrichment field, keeping the conflict', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [
          {
            id: 6,
            startTime: '2026-06-04T14:37:00Z',
            endTime: '2026-06-04T18:00:00Z',
            playlistId: 'nope', // wrong type → dropped
            playlistName: 'Korzinka promo',
          },
        ],
      }),
    );
    expect(result!.conflicts[0]!.playlistName).toBe('Korzinka promo');
    expect('playlistId' in result!.conflicts[0]!).toBe(false);
  });

  it('parses conflictingDeviceIds when a number[] is present (device-aware overlap)', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [
          {
            id: 6,
            startTime: '2026-06-04T14:37:00Z',
            endTime: '2026-06-04T18:00:00Z',
            conflictingDeviceIds: [1, 2, 3],
          },
        ],
      }),
    );
    expect(result!.conflicts[0]!.conflictingDeviceIds).toEqual([1, 2, 3]);
  });

  it('omits conflictingDeviceIds when absent (back-compat with the pre-device-aware backend)', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [{ id: 6, startTime: '2026-06-04T14:37:00Z', endTime: '2026-06-04T18:00:00Z' }],
      }),
    );
    expect('conflictingDeviceIds' in result!.conflicts[0]!).toBe(false);
  });

  it('filters non-number elements out of conflictingDeviceIds, dropping the field if none remain', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [
          // Mixed array → keep the numbers.
          { id: 6, startTime: '2026-06-04T14:37:00Z', endTime: '2026-06-04T18:00:00Z', conflictingDeviceIds: ['x', 2, null, 3] },
          // Non-array → field dropped, conflict kept.
          { id: 7, startTime: '2026-06-04T14:37:00Z', endTime: '2026-06-04T18:00:00Z', conflictingDeviceIds: 'nope' },
          // Empty / all-garbage → field dropped.
          { id: 8, startTime: '2026-06-04T14:37:00Z', endTime: '2026-06-04T18:00:00Z', conflictingDeviceIds: ['a', 'b'] },
        ],
      }),
    );
    expect(result!.conflicts).toHaveLength(3);
    expect(result!.conflicts[0]!.conflictingDeviceIds).toEqual([2, 3]);
    expect('conflictingDeviceIds' in result!.conflicts[1]!).toBe(false);
    expect('conflictingDeviceIds' in result!.conflicts[2]!).toBe(false);
  });

  it('returns null for a 409 without the structured details (older backend)', () => {
    expect(parseOverlapDetails({ message: 'Time overlap …', status: 409 })).toBeNull();
  });

  it('returns null when details.code is some other error code', () => {
    expect(parseOverlapDetails(overlapBody({ code: 'SOMETHING_ELSE' }))).toBeNull();
  });

  it('skips malformed conflict rows instead of throwing', () => {
    const result = parseOverlapDetails(
      overlapBody({
        conflicts: [
          { id: 3, startTime: '2026-06-03T09:00:00Z', endTime: '2026-06-03T13:00:00Z' },
          { id: 'oops', startTime: 5, endTime: null }, // dropped
          null, // dropped
        ],
      }),
    );
    expect(result!.conflicts).toHaveLength(1);
    expect(result!.conflicts[0]!.id).toBe(3);
  });

  it('omits an unknown/garbage targetType rather than passing it through', () => {
    const result = parseOverlapDetails(overlapBody({ targetType: 'PLANET' }));
    expect(result!.targetType).toBeUndefined();
    // The rest still parses.
    expect(result!.conflicts).toHaveLength(2);
  });

  it('tolerates non-object / null bodies', () => {
    expect(parseOverlapDetails(null)).toBeNull();
    expect(parseOverlapDetails('nope')).toBeNull();
    expect(parseOverlapDetails(undefined)).toBeNull();
  });
});
