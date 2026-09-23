// VG-16 / FE-15: responses do not come back in the order they were sent, so the newest request has
// to be the only one allowed to touch state.

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestRequest } from '../useLatestRequest';

describe('useLatestRequest', () => {
  it('lets a single request through', () => {
    const { result } = renderHook(() => useLatestRequest());

    const isCurrent = result.current();

    expect(isCurrent()).toBe(true);
  });

  it('retires an earlier request as soon as a newer one starts', () => {
    const { result } = renderHook(() => useLatestRequest());

    const first = result.current();
    const second = result.current();

    // This is the bug in one assertion: the slow first response must not win.
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('stays valid across repeated checks', () => {
    const { result } = renderHook(() => useLatestRequest());

    const only = result.current();

    expect(only()).toBe(true);
    expect(only()).toBe(true);
  });

  it('survives a re-render — the ticket outlives the render, like the request does', () => {
    const { result, rerender } = renderHook(() => useLatestRequest());

    const inFlight = result.current();
    rerender();

    expect(inFlight()).toBe(true);
    const newer = result.current();
    expect(inFlight()).toBe(false);
    expect(newer()).toBe(true);
  });

  it('gives independent counters to independent callers', () => {
    // A page claims separately for its list and its drawer: a filter change must not silence an
    // in-flight drawer load, and vice versa.
    const { result } = renderHook(() => ({ list: useLatestRequest(), drawer: useLatestRequest() }));

    const listTicket = result.current.list();
    const drawerTicket = result.current.drawer();
    result.current.list();

    expect(listTicket()).toBe(false);
    expect(drawerTicket()).toBe(true);
  });
});
