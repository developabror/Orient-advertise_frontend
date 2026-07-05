import { useEffect, useRef, type MutableRefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Stack of active trap containers, innermost last. Every trap attaches a
// document-level keydown listener, so when dialogs stack (e.g. the global error
// modal over a confirm dialog) all listeners fire on each key. Gating on the top
// of this stack means a single Escape/Tab only affects the topmost dialog rather
// than collapsing every layer at once.
const trapStack: HTMLElement[] = [];

export const useFocusTrap = <T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
): MutableRefObject<T | null> => {
  const containerRef = useRef<T | null>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    trapStack.push(container);

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    const initial = focusables();
    const initialFirst = initial[0];
    if (initialFirst) initialFirst.focus();
    else container.focus();

    const onKey = (e: KeyboardEvent): void => {
      // Only the topmost trap reacts — stacked dialogs each have a live listener.
      if (trapStack[trapStack.length - 1] !== container) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      const idx = trapStack.indexOf(container);
      if (idx !== -1) trapStack.splice(idx, 1);
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [active]);

  return containerRef;
};
