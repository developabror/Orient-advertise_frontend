// Pure helpers behind PlaylistsPage. Lives in its own file so the page module
// stays component-only (react-refresh HMR boundary) and so the reorder math is
// testable without rendering React.
//
// All three reorder entry points (mouse drag, keyboard, move buttons) feed
// into `moveItemByIndex`, then the page calls the same `reorderPlaylistItems`
// path. This keeps "drag built the same `orderedItemIds` as keyboard" true by
// construction.

/**
 * Return a copy of `items` with the element at `fromIndex` relocated to
 * `toIndex`. Indices are clamped silently — out-of-range moves return the
 * input array unchanged (no exception). A no-op move (from === to) also
 * returns the input unchanged so callers can short-circuit cheaply.
 */
export const moveItemByIndex = <T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): readonly T[] => {
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  const clampedTo = Math.max(0, Math.min(items.length - 1, toIndex));
  if (fromIndex === clampedTo) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return items;
  next.splice(clampedTo, 0, moved);
  return next;
};

/**
 * True when `next` is a permutation of `prev` AND has the same id at every
 * position — i.e. nothing actually moved. Callers use this to skip a wasted
 * PUT /reorder round-trip when a drag ends on the same row.
 */
export const isSameOrder = <T extends { readonly id: number }>(
  prev: readonly T[],
  next: readonly T[],
): boolean => {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i]?.id !== next[i]?.id) return false;
  }
  return true;
};

/** Wall-clock timestamp formatter shared by the drawer header. */
export const formatTimestamp = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
