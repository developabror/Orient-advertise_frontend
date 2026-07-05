// Vitest unit tests for the device-scope math that drives the assignment
// confirm body. The backend accepts EITHER an inclusion allow-list OR an
// exclusion deny-list (at most one); `deriveConfirmDeviceScope` picks the form
// that matches the operator's selection so the device-aware overlap check can
// scope to exactly the chosen devices:
//   - individual mode → { kind: 'included', deviceIds } = the checked rows,
//     FILTERED against the live preview so a stale id can't leak.
//   - all-across mode → { kind: 'excluded', deviceIds } = the unchecked rows.

import { describe, expect, it } from 'vitest';
import { deriveConfirmDeviceScope } from '../assignContentDrawer.helpers';

interface PreviewLike {
  readonly id: string;
}

const previewDevices: readonly PreviewLike[] = [
  { id: '1' },
  { id: '2' },
  { id: '3' },
  { id: '4' },
];

describe('deriveConfirmDeviceScope', () => {
  describe('individual mode (inclusion allow-list)', () => {
    it('includes exactly the devices the operator checked', () => {
      const selection = { mode: 'individual' as const, ids: new Set(['2']) };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'included',
        deviceIds: [2],
      });
    });

    it('includes all four when every previewed device is checked (whole previewed scope)', () => {
      const selection = { mode: 'individual' as const, ids: new Set(['1', '2', '3', '4']) };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'included',
        deviceIds: [1, 2, 3, 4],
      });
    });

    it('includes nothing when no device is checked', () => {
      const selection = { mode: 'individual' as const, ids: new Set<string>() };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'included',
        deviceIds: [],
      });
    });

    it('drops a stale selected id no longer in the preview (anti-phantom filter)', () => {
      // Regression: selection.ids survives a preview re-fetch (Retry) but the
      // device population can shrink. Shipping selection.ids verbatim would leak
      // device 9 — a device no longer in scope. The filter against previewDevices
      // drops it, so includedDeviceIds only ever names live, in-scope devices.
      const selection = { mode: 'individual' as const, ids: new Set(['2', '9']) };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'included',
        deviceIds: [2],
      });
    });
  });

  describe('all-across mode (exclusion deny-list)', () => {
    it('passes the unchecked set straight through as the exclusion list', () => {
      const selection = { mode: 'all-across' as const, ids: new Set(['3']) };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'excluded',
        deviceIds: [3],
      });
    });

    it('excludes nothing when the operator left every device checked', () => {
      const selection = { mode: 'all-across' as const, ids: new Set<string>() };
      expect(deriveConfirmDeviceScope(selection, previewDevices)).toEqual({
        kind: 'excluded',
        deviceIds: [],
      });
    });

    it('does not consult previewDevices in all-across mode (works with a zero-row preview)', () => {
      // all-across confirm must work even when the preview hasn't loaded rows
      // (e.g. a zero-device scope we still want to assign so future-added
      // devices inherit the content).
      const selection = { mode: 'all-across' as const, ids: new Set(['99']) };
      expect(deriveConfirmDeviceScope(selection, [])).toEqual({
        kind: 'excluded',
        deviceIds: [99],
      });
    });
  });
});
