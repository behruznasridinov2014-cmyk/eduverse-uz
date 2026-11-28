/**
 * EDUVERSE navigation & gesture system (Apple-style, our own look).
 *
 *  - GlassTabs: a tab bar with a floating glass pill ("lens"). Tap a tab, or
 *    press anywhere on the bar and slide: the pill follows the finger and the
 *    tab under it opens on release. While the page is swiped, the pill moves
 *    with the finger. Arrow keys, Home and End work like in a native tab bar.
 *  - useSwipeTabs: swipe the content left/right (touchscreen) or with two
 *    fingers on a touchpad to move to the next/previous tab. Never starts on
 *    fields, sliders, 3D stages, tables, the book reader or anything that
 *    scrolls sideways by itself, and never changes data.
 *  - LensGroup / LensRow: the same sliding pill for any row (or column) of
 *    buttons or links that marks the chosen one with .active, .on,
 *    aria-selected, aria-pressed or aria-current — chips, filters, the side menu.
 *  - ThemeSwitch + useTheme: day / night mode next to the language switch.
 *
 * Motion: one damped spring (see motion.css), transform/opacity only, and
 * nothing moves when the system asks for reduced motion.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { IconMoon, IconSun } from './nav-icons';

export type GlassTab = { key: string; label: string; icon?: ReactNode };

type Box = { left: number; top: number; width: number; height: number };

const boxOf = (element: HTMLElement): Box => ({ left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight });
const sameBox = (a: Box | null, b: Box | null) => a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** A tiny haptic tick where the device has one (Android); silently nothing elsewhere. */
function tick() {
  try { if ('vibrate' in navigator) navigator.vibrate(6); } catch { /* not supported */ }
}

/**
 * When the pill travels to another item it stretches a little along the way
 * and settles with the spring — the "liquid" feel. Uses the independent
 * `scale` property so it never fights the transform that positions the pill.
 */
function useLiquidTravel(lensRef: React.RefObject<HTMLElement | null>, box: Box | null, vertical = false) {
  const previous = useRef<Box | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = box;
    const lens = lensRef.current;
    if (!lens || !before || !box || prefersReducedMotion() || typeof lens.animate !== 'function') return;
    const distance = vertical ? Math.abs(box.top - before.top) : Math.abs(box.left - before.left);
    if (distance < 4) return;
    const stretch = Math.min(0.12, 0.04 + distance / 2400);
    try {
      lens.animate(
        vertical
          ? [{ scale: '1 1' }, { scale: `${1 - stretch / 3} ${1 + stretch}` }, { scale: '1 1' }]
          : [{ scale: '1 1' }, { scale: `${1 + stretch} ${1 - stretch / 2}` }, { scale: '1 1' }],
        { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    } catch { /* older browser: the pill still slides */ }
  }, [box?.left, box?.top, box?.width, box?.height, lensRef, vertical]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Keeps the chosen item visible when a row scrolls sideways (only the row scrolls, never the page). */
function keepInView(row: HTMLElement | null, item: HTMLElement | null) {
  if (!row || !item || row.scrollWidth <= row.clientWidth + 1) return;
  const left = item.offsetLeft - 12;
  const right = item.offsetLeft + item.offsetWidth + 12;
  if (left < row.scrollLeft) row.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  else if (right > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right - row.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function GlassTabs({
  items,
  activeKey,
  onSelect,
  className = '',
  ariaLabel,
  progress = 0,
}: {
  items: GlassTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
  ariaLabel: string;
  /** While the page below is swiped: -1…1, the share of the way to the previous (−) or next (+) tab. */
  progress?: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const lensRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<{ x: number; hover: number } | null>(null);
  const [pressed, setPressed] = useState(-1);
  const press = useRef<{ id: number; startX: number; startY: number; moved: boolean; hover: number; scroll: boolean } | null>(null);
  const activeIndex = items.findIndex((item) => item.key === activeKey);

  const measure = useCallback(() => {
    const next = itemRefs.current.slice(0, items.length).map((element) => (element ? boxOf(element) : { left: 0, top: 0, width: 0, height: 0 }));
    setBoxes((prev) => (prev.length === next.length && prev.every((box, index) => sameBox(box, next[index])) ? prev : next));
  }, [items.length]);

  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(bar);
    itemRefs.current.forEach((element) => element && observer.observe(element));
    // Web fonts change label widths after the first paint.
    void document.fonts?.ready.then(() => measure()).catch(() => undefined);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => { keepInView(barRef.current, itemRefs.current[activeIndex] ?? null); }, [activeIndex]);

  const activeBox = boxes[activeIndex] ?? null;
  useLiquidTravel(lensRef, drag ? null : activeBox);

  function indexAt(clientX: number): number {
    let best = -1;
    let bestDistance = Infinity;
    itemRefs.current.slice(0, items.length).forEach((element, index) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) { best = index; bestDistance = 0; return; }
      const distance = Math.min(Math.abs(clientX - rect.left), Math.abs(clientX - rect.right));
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    return best;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const hover = indexAt(event.clientX);
    const bar = barRef.current;
    // A bar that scrolls sideways keeps its own scroll; the pill does not chase the finger there.
    const scroll = Boolean(bar && bar.scrollWidth > bar.clientWidth + 1);
    press.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, hover, scroll };
    setPressed(hover);
    if (scroll) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { press.current = null; setPressed(-1); setDrag(null); return; }
    if (Math.abs(dx) > 6) current.moved = true;
    if (current.scroll) { if (current.moved) { press.current = null; setPressed(-1); } return; }
    if (!current.moved) return;
    const hover = indexAt(event.clientX);
    if (hover !== current.hover) { current.hover = hover; tick(); }
    setPressed(-1);
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setDrag({ x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), hover });
  }

  function finish(event: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    press.current = null;
    setDrag(null);
    setPressed(-1);
    if (cancel) return;
    const index = indexAt(event.clientX);
    const item = items[index];
    if (item) onSelect(item.key);
  }

  // Where the pill is: under the finger while dragging, between two tabs while the page is swiped, else on the chosen tab.
  let lensStyle: CSSProperties | undefined;
  const bar = barRef.current;
  if (drag) {
    const width = boxes[drag.hover]?.width ?? activeBox?.width ?? 64;
    const barWidth = bar?.clientWidth ?? 0;
    const left = Math.max(2, Math.min(barWidth - width - 2, drag.x - width / 2));
    lensStyle = { width, transform: `translateX(${left}px)` };
  } else if (activeBox) {
    const neighbour = progress ? boxes[activeIndex + (progress > 0 ? 1 : -1)] : undefined;
    const k = Math.min(1, Math.abs(progress));
    lensStyle = neighbour
      ? { width: mix(activeBox.width, neighbour.width, k), transform: `translateX(${mix(activeBox.left, neighbour.left, k)}px)` }
      : { width: activeBox.width, transform: `translateX(${activeBox.left + (progress ? progress * 10 : 0)}px)` };
  }

  return (
    <div
      ref={barRef}
      className={`glass-tabs ${drag ? 'is-dragging' : ''} ${progress ? 'is-tracking' : ''} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      {lensStyle && <span ref={lensRef} className="glass-lens" aria-hidden="true" style={lensStyle} />}
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(element) => { itemRefs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={item.key === activeKey}
          tabIndex={item.key === activeKey || (activeIndex < 0 && index === 0) ? 0 : -1}
          onKeyDown={(event) => {
            const last = items.length - 1;
            const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
              : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
                : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
            if (next < 0) return;
            event.preventDefault();
            itemRefs.current[next]?.focus();
            onSelect(items[next].key);
          }}
          className={`glass-tab ${item.key === activeKey ? 'active' : ''} ${drag && drag.hover === index ? 'hover' : ''} ${pressed === index ? 'is-pressed' : ''}`}
          // Pointer taps are handled by the bar; the keyboard still uses click.
          onClick={(event) => { if (event.detail === 0) onSelect(item.key); }}
        >
          {item.icon ? <span className="glass-tab-icon">{item.icon}</span> : null}
          <span className="glass-tab-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Swipe between tabs                                                           */
/* -------------------------------------------------------------------------- */

/** Places where a sideways gesture belongs to the thing under the finger, not to the tabs. */
const NO_SWIPE = [
  'input', 'textarea', 'select', 'canvas', 'video', 'iframe', '[contenteditable="true"]', '[draggable="true"]',
  '[role="slider"]', '[data-no-swipe]', '.glass-tabs', '.lens-host', '.chem-stage', '.scene-stage', '.pdfv', '.table-wrap', 'table',
  '.ev-modal', '.modal', '.journal-marks', '.board-canvas', '.lesson-board', '.ls-match-item',
].join(', ');

/** True when the element or one of its parents can scroll sideways itself (a wide table, a chip row). */
function scrollsSideways(target: Element, stop: Element | null): boolean {
  for (let node: Element | null = target; node && node !== stop && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 2) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

function swipeBlocked(target: EventTarget | null, pane: Element | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(NO_SWIPE)) return true;
  return scrollsSideways(target, pane);
}

/**
 * Swipe the content left or right to switch tabs (like modern iOS apps).
 * Touch: the page follows the finger, the tab bar pill moves with it, and the
 * next tab opens after a long or fast enough swipe. Touchpad: a two-finger
 * sideways swipe. Vertical scrolling always wins over a mostly vertical move.
 */
export function useSwipeTabs<T extends string>(keys: T[], active: T, setActive: (key: T) => void) {
  const start = useRef<{ x: number; y: number; t: number; locked: boolean | null; width: number } | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const wheel = useRef<{ dx: number; timer: number; done: boolean }>({ dx: 0, timer: 0, done: false });
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const index = keys.indexOf(active);
  const latest = useRef({ keys, index, setActive });
  latest.current = { keys, index, setActive };

  const go = useCallback((step: 1 | -1) => {
    const { keys: list, index: at, setActive: set } = latest.current;
    const next = at + step;
    if (next < 0 || next >= list.length) return false;
    setDirection(step > 0 ? 'left' : 'right');
    set(list[next]);
    tick();
    return true;
  }, []);

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    // Leave the screen edges to the system back gesture.
    if (event.touches.length !== 1 || !touch || touch.clientX < 18 || touch.clientX > window.innerWidth - 18 || swipeBlocked(event.target, event.currentTarget)) { start.current = null; return; }
    start.current = { x: touch.clientX, y: touch.clientY, t: Date.now(), locked: null, width: (event.currentTarget as HTMLElement).clientWidth || window.innerWidth };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const current = start.current;
    if (!current) return;
    if (event.touches.length !== 1) { start.current = null; setOffset(0); return; }
    const touch = event.touches[0];
    const dx = touch.clientX - current.x;
    const dy = touch.clientY - current.y;
    if (current.locked === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) current.locked = Math.abs(dx) > Math.abs(dy) * 1.4;
    if (!current.locked) return;
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === keys.length - 1);
    // Rubber band at the first and last tab, like iOS.
    setOffset(atEdge ? Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.18) : dx * 0.85);
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const current = start.current;
    start.current = null;
    setOffset(0);
    if (!current?.locked) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - current.x;
    const fast = Math.abs(dx) > 40 && Date.now() - current.t < 280;
    if (Math.abs(dx) < Math.min(90, current.width * 0.22) && !fast) return;
    go(dx < 0 ? 1 : -1);
  };

  // Two-finger sideways swipe on a touchpad (mostly horizontal wheel deltas).
  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.6 || swipeBlocked(event.target, event.currentTarget)) return;
    const state = wheel.current;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => { state.dx = 0; state.done = false; }, 220);
    if (state.done) return;
    state.dx += event.deltaX;
    if (Math.abs(state.dx) > 110) { state.done = true; go(state.dx > 0 ? 1 : -1); }
  };

  // While swipe tabs are on the page, a sideways touchpad swipe must not also go "Back" in the browser.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('swipe-tabs-on');
    return () => root.classList.remove('swipe-tabs-on');
  }, []);
  useEffect(() => () => window.clearTimeout(wheel.current.timer), []);

  const select = (key: T) => {
    const next = keys.indexOf(key);
    if (next !== index) setDirection(next > index ? 'left' : 'right');
    setActive(key);
  };
  const width = paneRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 400);
  const progress = offset ? Math.max(-1, Math.min(1, -offset / Math.max(240, width * 0.85))) : 0;
  return {
    select,
    progress,
    handlers: {
      ref: (element: HTMLElement | null) => { paneRef.current = element; },
      onTouchStart, onTouchMove, onTouchEnd, onWheel,
      onTouchCancel: () => { start.current = null; setOffset(0); },
    },
    style: offset ? { transform: `translateX(${offset}px)`, opacity: 1 - Math.min(0.35, Math.abs(progress) * 0.35), transition: 'none' } as CSSProperties : undefined,
    slideClass: direction ? `slide-from-${direction === 'left' ? 'right' : 'left'}` : '',
  };
}

/* -------------------------------------------------------------------------- */
/* Day / night theme                                                           */
/* -------------------------------------------------------------------------- */

export type Theme = 'day' | 'night';
const THEME_KEY = 'eduverse:theme';

export function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'day'; } catch { return 'day'; }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#0E1726' : '#F6F1E7');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  const change = useCallback((next: Theme) => {
    if (next === theme) return;
    const root = document.documentElement;
    root.classList.add('theme-changing');
    window.setTimeout(() => setTheme(next), 10);
    window.setTimeout(() => root.classList.remove('theme-changing'), 900);
  }, [theme]);
  return [theme, change] as const;
}

export function ThemeSwitch({ theme, onChange, language }: { theme: Theme; onChange: (theme: Theme) => void; language: string }) {
  const day = language === 'Русский' ? 'Дневной режим' : language === 'Uzbek' ? 'Kunduzgi rejim' : 'Day mode';
  const night = language === 'Русский' ? 'Ночной режим' : language === 'Uzbek' ? 'Tungi rejim' : 'Night mode';
  return (
    <div className="glass-seg theme-switch" role="group" aria-label={`${day} / ${night}`}>
      <span className="glass-seg-thumb" aria-hidden="true" style={{ transform: theme === 'night' ? 'translateX(var(--seg-w))' : 'none' }} />
      <button type="button" className={theme === 'day' ? 'active' : ''} onClick={() => onChange('day')} aria-label={day} title={day}><IconSun size={17} /></button>
      <button type="button" className={theme === 'night' ? 'active' : ''} onClick={() => onChange('night')} aria-label={night} title={night}><IconMoon size={16} /></button>
    </div>
  );
}

/** Liquid-glass switch with a spring knob (keyboard: Space / Enter). */
export function GlassSwitch({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`glass-switch-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="glass-switch-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`glass-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="glass-switch-knob" />
      </button>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Sliding pill for any row or column of choices                               */
/* -------------------------------------------------------------------------- */

const CHOSEN = ':scope > [aria-selected="true"], :scope > [aria-pressed="true"], :scope > [aria-current="page"], :scope > .on, :scope > .active';
const FOCUSABLE = ':scope > button:not(:disabled), :scope > a[href]';

/**
 * Wraps an existing row (or column) of buttons/links and gives it the EDUVERSE
 * sliding pill: the chosen item is found by .active / .on / aria-selected /
 * aria-pressed / aria-current, and the pill springs to it (also across wrapped
 * lines). The children stay exactly as they are, so every click handler,
 * permission check and route keeps working. Arrow keys move between items.
 *
 * variant "glass" — soft translucent pill (tab rows, side menu);
 * variant "solid" — the brand gold pill for chip rows whose chosen chip is gold.
 */
export function LensGroup({
  as = 'div',
  className = '',
  variant = 'glass',
  vertical = false,
  activateOnArrow = false,
  role,
  children,
  ...rest
}: {
  as?: 'div' | 'nav' | 'span';
  className?: string;
  variant?: 'glass' | 'solid';
  vertical?: boolean;
  /** Arrow keys also choose the item (tab rows); otherwise they only move focus. */
  activateOnArrow?: boolean;
  role?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const hostRef = useRef<HTMLElement | null>(null);
  const lensRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const measure = useCallback(() => {
    const host = hostRef.current;
    const chosen = host?.querySelector<HTMLElement>(CHOSEN) ?? null;
    const next = chosen && chosen.offsetWidth > 0 ? boxOf(chosen) : null;
    // Only a real change updates state: a new object on every render would loop forever.
    setBox((prev) => (sameBox(prev, next) ? prev : next));
    return chosen;
  }, []);
  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    void document.fonts?.ready.then(() => measure()).catch(() => undefined);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    if (vertical) return;
    const host = hostRef.current;
    keepInView(host, host?.querySelector<HTMLElement>(CHOSEN) ?? null);
  }, [box?.left, vertical]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiquidTravel(lensRef, box, vertical);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    const forward = vertical ? 'ArrowDown' : 'ArrowRight';
    if (![back, forward, 'Home', 'End'].includes(event.key)) return;
    const host = hostRef.current;
    if (!host || !(event.target instanceof HTMLElement) || event.target.parentElement !== host) return;
    const items = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE));
    const at = items.indexOf(event.target);
    if (at < 0 || items.length < 2) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === forward ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
    if (activateOnArrow) items[next].click();
  }

  return createElement(as, {
    ref: hostRef,
    className: `lens-host lens-${variant} ${vertical ? 'is-vertical' : ''} ${className}`,
    role,
    'aria-label': rest['aria-label'],
    onKeyDown,
  },
  box && <span ref={lensRef} className="lens-host-lens" aria-hidden="true" style={{ width: box.width, height: box.height, transform: `translate(${box.left}px, ${box.top}px)` }} />,
  children);
}

/** A compact glass row of small tabs with the sliding pill (kept for existing screens). */
export function LensRow({ className = '', children, role = 'tablist', ...rest }: { className?: string; children: ReactNode; role?: string; 'aria-label'?: string }) {
  return <LensGroup className={`lens-row ${className}`} role={role} activateOnArrow aria-label={rest['aria-label']}>{children}</LensGroup>;
}
