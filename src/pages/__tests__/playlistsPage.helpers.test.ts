// Vitest unit tests for the pure reorder helpers behind PlaylistsPage. These
// pin the contract that the page relies on: drag, keyboard, and the Move
// up/down buttons all go through the SAME math, so the `orderedItemIds`
// built for the PUT /reorder request is identical regardless of input
// modality. Tested here in isolation (no React render) — the resource layer
// is exercised through the same helper composition.

import { describe, expect, it } from 'vitest';
import { isSameOrder, moveItemByIndex, formatTimestamp } from '../playlistsPage.helpers';

interface Item {
  readonly id: number;
}

const items: readonly Item[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

const ids = (xs: readonly Item[]): readonly number[] => xs.map((x) => x.id);

describe('moveItemByIndex', () => {
  it('moves an item forward by one slot (drag-style)', () => {
    // Drag id=1 from slot 0 onto slot 1 → [2, 1, 3, 4].
    expect(ids(moveItemByIndex(items, 0, 1))).toEqual([2, 1, 3, 4]);
  });

  it('moves an item backward by one slot (ArrowUp / Move up)', () => {
    // Keyboard ArrowUp on id=3 (index 2) → toIndex 1 → [1, 3, 2, 4].
    expect(ids(moveItemByIndex(items, 2, 1))).toEqual([1, 3, 2, 4]);
  });

  it('moves an item to the start (Home)', () => {
    expect(ids(moveItemByIndex(items, 3, 0))).toEqual([4, 1, 2, 3]);
  });

  it('moves an item to the end (End)', () => {
    expect(ids(moveItemByIndex(items, 0, 3))).toEqual([2, 3, 4, 1]);
  });

  it('clamps toIndex above the last slot rather than dropping the item', () => {
    // Pressing ArrowDown on the last row would compute index+1 = items.length;
    // moveItemByIndex must clamp, not splice past the end.
    const next = moveItemByIndex(items, 3, 99);
    expect(ids(next)).toEqual([1, 2, 3, 4]);
  });

  it('clamps toIndex below 0 rather than wrapping', () => {
    expect(ids(moveItemByIndex(items, 0, -5))).toEqual([1, 2, 3, 4]);
  });

  it('returns the SAME array instance on a no-op (cheap short-circuit)', () => {
    // The page short-circuits the PUT call when moveItemByIndex returns the
    // same array — important for ArrowUp at index 0 / ArrowDown at last.
    expect(moveItemByIndex(items, 1, 1)).toBe(items);
    expect(moveItemByIndex(items, 0, -1)).toBe(items);
    expect(moveItemByIndex(items, 3, 4)).toBe(items);
  });

  it('returns the SAME array on out-of-range fromIndex', () => {
    expect(moveItemByIndex(items, -1, 0)).toBe(items);
    expect(moveItemByIndex(items, 10, 0)).toBe(items);
  });

  it('drag and keyboard produce the same orderedItemIds for an equivalent move', () => {
    // Drag id=1 to slot 2 should produce the same result as keyboarding
    // id=1 down twice (two ArrowDown presses).
    const drag = moveItemByIndex(items, 0, 2);
    const oneKey = moveItemByIndex(items, 0, 1);
    const twoKey = moveItemByIndex(oneKey, 1, 2);
    expect(ids(drag)).toEqual(ids(twoKey));
    expect(ids(drag)).toEqual([2, 3, 1, 4]);
  });
});

describe('isSameOrder', () => {
  it('returns true when the orders match', () => {
    expect(isSameOrder(items, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])).toBe(true);
  });

  it('returns false when any position differs', () => {
    expect(isSameOrder(items, [{ id: 1 }, { id: 3 }, { id: 2 }, { id: 4 }])).toBe(false);
  });

  it('returns false on length mismatch', () => {
    expect(isSameOrder(items, [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('renders an ISO-8601 string in the local locale', () => {
    const out = formatTimestamp('2026-06-01T15:42:00Z');
    // Locale-dependent — assert it changed the format and that the year is
    // still in it. Avoid hard-coding minutes/hours because TZ varies in CI.
    expect(out).not.toBe('2026-06-01T15:42:00Z');
    expect(out).toMatch(/2026/);
  });

  it('returns the raw input when it is not a parseable date', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});
