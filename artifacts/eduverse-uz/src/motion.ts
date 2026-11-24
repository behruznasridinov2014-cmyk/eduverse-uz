/**
 * EDUVERSE motion utilities.
 *
 * The visual side (spring curves, press feedback, page / modal transitions)
 * lives in motion.css. This file has the small pieces that need JavaScript:
 *  - useReducedMotion: follow the system "reduce motion" setting;
 *  - useClosable: play the closing animation before a dialog is removed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia(QUERY).matches; } catch { return false; }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let media: MediaQueryList;
    try { media = window.matchMedia(QUERY); } catch { return; }
    const onChange = () => setReduced(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Closing time of dialogs; matches `--dur-close` in motion.css. */
export const CLOSE_MS = 200;

/**
 * Returns [closing, requestClose]. Put `is-closing` on the dialog while
 * `closing` is true; `onClose` runs after the exit animation. Clicks are
 * never blocked: a second request closes at once.
 */
export function useClosable(onClose: () => void, duration = CLOSE_MS): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const timer = useRef(0);
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const requestClose = useCallback(() => {
    if (closing || prefersReducedMotion()) { window.clearTimeout(timer.current); latest.current(); setClosing(false); return; }
    setClosing(true);
    timer.current = window.setTimeout(() => { latest.current(); setClosing(false); }, duration);
  }, [closing, duration]);
  return [closing, requestClose];
}
