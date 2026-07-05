// Unit tests for runBulkGroupActions — specifically the per-group failure path
// added so a bulk action surfaces each group's backend reason in the done-modal
// AND claims the rejection (so the global error-dialog modal does not pop
// mid-bulk for each failing group).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the spy exists when the hoisted vi.mock factory runs.
const { postSpy } = vi.hoisted(() => ({ postSpy: vi.fn() }));
vi.mock('../http', () => ({ http: { post: postSpy } }));

import { planBulkSelection, runBulkGroupActions } from '../bulkDeviceActions';
import { attachErrorClaim } from '../errorDialog';

const make409 = (message: string): Record<string, unknown> => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: {
    status: 409,
    data: {
      status: 409,
      error: 'Conflict',
      message,
      correlationId: 'corr',
      timestamp: 't',
      fieldErrors: null,
    },
  },
  config: {},
  toJSON: () => ({}),
});

const okResponse = {
  data: { totalDevices: 2, succeededCount: 2, failedCount: 0, skippedCount: 0 },
};

beforeEach(() => {
  postSpy.mockReset();
});

describe('runBulkGroupActions — failed-group reason surfacing', () => {
  it('captures the backend message into summary.errors and claims the error', async () => {
    const err = make409('Group is empty — add content before syncing.');
    // Simulate the interceptor having attached a claim + scheduled a modal.
    const claim = attachErrorClaim(err);

    postSpy.mockImplementation((url: string) =>
      url.includes('groupA') ? Promise.reject(err) : Promise.resolve(okResponse),
    );

    const plan = planBulkSelection(
      new Map<string, string | null>([
        ['d1', 'groupA'],
        ['d2', 'groupB'],
      ]),
    );

    const { summary, perGroup } = await runBulkGroupActions({ action: 'SYNC_CONTENT', plan });

    expect(summary.groupsSucceeded).toBe(1);
    expect(summary.groupsFailed).toBe(1);
    expect(summary.errors).toEqual(['Group is empty — add content before syncing.']);

    const failed = perGroup.find((g) => g.errored);
    expect(failed?.groupId).toBe('groupA');
    expect(failed?.message).toBe('Group is empty — add content before syncing.');

    // The per-group catch ran markErrorHandled(err) → the deferred global modal
    // is cancelled, so no per-group popup mid-bulk.
    expect(claim.handled).toBe(true);
  });

  it('omits summary.errors entirely when every group succeeds', async () => {
    postSpy.mockResolvedValue(okResponse);

    const plan = planBulkSelection(
      new Map<string, string | null>([
        ['d1', 'groupA'],
        ['d2', 'groupB'],
      ]),
    );

    const { summary } = await runBulkGroupActions({ action: 'REBOOT', plan });

    expect(summary.groupsSucceeded).toBe(2);
    expect(summary.groupsFailed).toBe(0);
    expect(summary.errors).toBeUndefined();
  });

  it('records a failed group with no envelope message but no error text', async () => {
    postSpy.mockRejectedValue(new Error('network down'));

    const plan = planBulkSelection(new Map<string, string | null>([['d1', 'groupA']]));

    const { summary, perGroup } = await runBulkGroupActions({ action: 'SYNC_CONTENT', plan });

    expect(summary.groupsFailed).toBe(1);
    expect(summary.errors).toBeUndefined();
    expect(perGroup[0]?.errored).toBe(true);
    expect(perGroup[0]?.message).toBeUndefined();
  });
});
