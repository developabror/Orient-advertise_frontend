// Pure helpers behind AssignContentDrawer. Lives in its own file so the
// drawer module remains a pure component-only export (react-refresh HMR
// requirement). Tested directly via
// src/components/__tests__/AssignContentDrawer.test.ts.

export type SelectionMode = 'individual' | 'all-across';

export interface DeviceSelection {
  readonly mode: SelectionMode;
  readonly ids: ReadonlySet<string>;
}

export const EMPTY_SELECTION: DeviceSelection = {
  mode: 'individual',
  ids: new Set<string>(),
};

export const isDeviceSelected = (id: string, sel: DeviceSelection): boolean =>
  sel.mode === 'individual' ? sel.ids.has(id) : !sel.ids.has(id);

export const computeSelectedCount = (sel: DeviceSelection, totalItems: number): number =>
  sel.mode === 'individual' ? sel.ids.size : Math.max(0, totalItems - sel.ids.size);

/**
 * The device scope POSTed on confirm. The backend accepts EITHER an inclusion
 * allow-list OR an exclusion deny-list (at most one) — we pick the form that
 * matches the operator's selection so the device-aware overlap check can scope
 * to exactly the chosen devices.
 *
 *  - `included`: an explicit allow-list — used for an `individual` selection so
 *    the operator's chosen subset reaches the backend verbatim.
 *  - `excluded`: target-scope-minus-these — used for `all-across` so a whole
 *    (possibly truncated/huge) target needn't be enumerated id-by-id.
 */
export type ConfirmDeviceScope =
  | { readonly kind: 'included'; readonly deviceIds: readonly number[] }
  | { readonly kind: 'excluded'; readonly deviceIds: readonly number[] };

/**
 * Translate the picker's selection into the confirm-time device scope.
 *
 *  - `all-across` mode: `selection.ids` is already the exclusion set (the
 *    unchecked rows); pass it straight through — does NOT consult
 *    `previewDevices`, so it works even for a zero-row / truncated preview.
 *  - `individual` mode: `selection.ids` is the inclusion set, but it must be
 *    FILTERED against the live `previewDevices` before shipping: `selection.ids`
 *    only resets on target change / close, not on a preview re-fetch, so a
 *    device removed from the region between fetches (e.g. after Retry) could
 *    otherwise leak a phantom id into `includedDeviceIds`. Filtering drops any
 *    id no longer in scope.
 *
 * NOTE: callers MUST still gate individual-mode confirm on `!truncated`; on a
 * truncated page `previewDevices` is only the visible slice, so an individual
 * inclusion list would silently under-assign.
 */
export const deriveConfirmDeviceScope = (
  selection: DeviceSelection,
  previewDevices: readonly { id: string }[],
): ConfirmDeviceScope => {
  if (selection.mode === 'all-across') {
    return { kind: 'excluded', deviceIds: Array.from(selection.ids).map((s) => Number(s)) };
  }
  return {
    kind: 'included',
    deviceIds: previewDevices.filter((d) => selection.ids.has(d.id)).map((d) => Number(d.id)),
  };
};
