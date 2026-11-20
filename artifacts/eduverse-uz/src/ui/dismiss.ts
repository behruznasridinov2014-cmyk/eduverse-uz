import { useEffect, useRef, type RefObject } from 'react';

/**
 * One shared "close it" behaviour for every popover, dropdown, menu and dialog:
 *  - a click / tap outside the open window closes it,
 *  - a click on the trigger button is ignored here (the trigger toggles it itself),
 *  - Escape closes it,
 *  - listeners are added only while it is open and removed on close / unmount.
 * Pass the window and (optionally) its trigger. Several refs are allowed.
 */
export function useDismiss(open: boolean, onClose: () => void, refs: Array<RefObject<HTMLElement | null>>) {
  const latest = useRef(onClose);
  latest.current = onClose;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && refsRef.current.some((ref) => ref.current?.contains(target));
    const onPointer = (event: PointerEvent) => { if (!inside(event.target)) latest.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); latest.current(); } };
    // Added on the next tick, so the click that opened it does not close it again.
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', onPointer, true), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}
