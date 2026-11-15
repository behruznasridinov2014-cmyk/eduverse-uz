/**
 * Liquid-glass controls in the iOS style:
 *  - GlassTabs: a tab bar with a glass "lens". Tap a tab, or press anywhere on
 *    the bar and slide the finger: the lens follows the finger and the tab under
 *    it opens when the finger is lifted. Used for the phone bottom bar and for
 *    the teacher cabinet sections.
 *  - useSwipeTabs: swipe the content left/right to move to the next/previous tab.
 *  - ThemeSwitch + useTheme: day / night mode next to the language switch.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconMoon, IconSun } from './nav-icons';

export type GlassTab = { key: string; label: string; icon: ReactNode };

type Lens = { left: number; width: number };

export function GlassTabs({
  items,
  activeKey,
  onSelect,
  className = '',
  ariaLabel,
}: {
  items: GlassTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [lens, setLens] = useState<Lens | null>(null);
  const [drag, setDrag] = useState<{ x: number; hover: number } | null>(null);
  const press = useRef<{ id: number; startX: number; moved: boolean; hover: number } | null>(null);
  const activeIndex = items.findIndex((item) => item.key === activeKey);

  const measure = useCallback(() => {
    const element = itemRefs.current[activeIndex];
    if (!element) { setLens(null); return; }
    setLens({ left: element.offsetLeft, width: element.offsetWidth });
  }, [activeIndex]);

  useLayoutEffect(() => { measure(); }, [measure, items.length]);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(bar);
    return () => observer.disconnect();
  }, [measure]);

  function indexAt(clientX: number): number {
    let best = -1;
    let bestDistance = Infinity;
    itemRefs.current.forEach((element, index) => {
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
    press.current = { id: event.pointerId, startX: event.clientX, moved: false, hover };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setDrag({ x: event.clientX - rect.left, hover });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    if (Math.abs(event.clientX - current.startX) > 6) current.moved = true;
    const hover = indexAt(event.clientX);
    if (hover !== current.hover) {
      current.hover = hover;
      if (current.moved && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch { /* not supported */ } }
    }
    const rect = barRef.current?.getBoundingClientRect();
    if (rect) setDrag({ x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), hover });
  }

  function finish(event: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    press.current = null;
    setDrag(null);
    if (cancel) return;
    const index = indexAt(event.clientX);
    const item = items[index];
    if (item) onSelect(item.key);
  }

  // While dragging, the lens is centred under the finger with the width of the tab below it.
  let lensStyle: React.CSSProperties | undefined;
  if (drag) {
    const hovered = itemRefs.current[drag.hover];
    const width = hovered?.offsetWidth ?? lens?.width ?? 64;
    const barWidth = barRef.current?.clientWidth ?? 0;
    const left = Math.max(2, Math.min(barWidth - width - 2, drag.x - width / 2));
    lensStyle = { width, transform: `translateX(${left}px) scale(1.14)` };
  } else if (lens) {
    lensStyle = { width: lens.width, transform: `translateX(${lens.left}px)` };
  }

  return (
    <div
      ref={barRef}
      className={`glass-tabs ${drag ? 'is-dragging' : ''} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      {lensStyle && <span className="glass-lens" aria-hidden="true" style={lensStyle} />}
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
          className={`glass-tab ${item.key === activeKey ? 'active' : ''} ${drag && drag.hover === index ? 'hover' : ''}`}
          // Pointer taps are handled by the bar; the keyboard still uses click.
          onClick={(event) => { if (event.detail === 0) onSelect(item.key); }}
        >
          <span className="glass-tab-icon">{item.icon}</span>
          <span className="glass-tab-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Swipe the content left or right to switch tabs (like Instagram on iPhone).
 * Ignores gestures that start on inputs, sliders, canvases, 3D stages, tables and the reader.
 */
export function useSwipeTabs<T extends string>(keys: T[], active: T, setActive: (key: T) => void) {
  const start = useRef<{ x: number; y: number; t: number; locked: boolean | null } | null>(null);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const index = keys.indexOf(active);

  const blocked = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('input, textarea, select, canvas, [data-no-swipe], .chem-stage, .pdfv, .table-wrap, table, .glass-tabs, [contenteditable="true"]'));

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 1 || blocked(event.target)) { start.current = null; return; }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, t: Date.now(), locked: null };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const current = start.current;
    if (!current) return;
    const touch = event.touches[0];
    const dx = touch.clientX - current.x;
    const dy = touch.clientY - current.y;
    if (current.locked === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) current.locked = Math.abs(dx) > Math.abs(dy) * 1.4;
    if (!current.locked) return;
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === keys.length - 1);
    setOffset(atEdge ? dx * 0.15 : dx * 0.45);
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const current = start.current;
    start.current = null;
    setOffset(0);
    if (!current?.locked) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - current.x;
    const fast = Math.abs(dx) > 40 && Date.now() - current.t < 280;
    if (Math.abs(dx) < 70 && !fast) return;
    const next = dx < 0 ? index + 1 : index - 1;
    if (next < 0 || next >= keys.length) return;
    setDirection(dx < 0 ? 'left' : 'right');
    setActive(keys[next]);
  };
  const select = (key: T) => {
    const next = keys.indexOf(key);
    if (next !== index) setDirection(next > index ? 'left' : 'right');
    setActive(key);
  };
  return {
    select,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => { start.current = null; setOffset(0); } },
    style: offset ? { transform: `translateX(${offset}px)`, transition: 'none' } : undefined,
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
