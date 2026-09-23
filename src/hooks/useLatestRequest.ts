import { useCallback, useRef } from 'react';

/**
 * Guards against a slow response overwriting a newer one (VG-16 / FE-15).
 *
 * <p>Every list page here fires a fetch per drawer open and per filter change and applies whatever
 * comes back. Responses do not arrive in the order they were sent: open row A, then row B while A is
 * still loading, and A's late response paints A's name, facility and device count into a drawer
 * whose id is B's. The rename and delete buttons act on the **id**, so the operator reads one record
 * and edits another. The same race reorders list results while someone types in a filter.
 *
 * <p>Usage: call {@link claim} when a request starts and keep the returned predicate; it answers
 * "am I still the newest request?". Anything that makes an in-flight response irrelevant — closing
 * the drawer, starting the next fetch — claims again, which retires every earlier ticket.
 *
 * <pre>
 *   const claim = useLatestRequest();
 *   const openDrawer = (id: number) => {
 *     const isCurrent = claim();
 *     getFacility(id).then((d) => { if (isCurrent()) setDrawerData(d); });
 *   };
 * </pre>
 *
 * <p>Deliberately not an `AbortController`: aborting would also be correct for the network, but the
 * bug is about which response is allowed to reach React state, and these resource helpers do not all
 * take a signal. One rule, applied identically at every call site, is easier to keep true.
 */
export const useLatestRequest = (): (() => () => boolean) => {
  const latest = useRef(0);
  return useCallback(() => {
    const ticket = (latest.current += 1);
    return () => ticket === latest.current;
  }, []);
};
