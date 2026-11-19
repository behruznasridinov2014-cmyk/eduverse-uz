/**
 * Small toolkit for EDUVERSE's own 3D scenes.
 *  - Stage3D: a real CSS-3D stage. Drag (mouse / finger) to turn the scene;
 *    it springs back gently. Layers sit at different depths (translateZ), so
 *    turning shows true parallax. No WebGL, no downloads, light on phones.
 *  - Layer: one depth plane of the stage.
 *  - SceneSlider / SceneModes / SceneNote: shared controls.
 *  - useFrame: a requestAnimationFrame loop that pauses off-screen.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const REST = { x: 14, y: -16 };

export function Stage3D({ children, height = 320, className = '', rest = REST }: { children: ReactNode; height?: number; className?: string; rest?: { x: number; y: number } }) {
  const [angle, setAngle] = useState(rest);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; ax: number; ay: number; id: number } | null>(null);
  const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest('input, button, select, [data-interactive]')) return;
    start.current = { px: event.clientX, py: event.clientY, ax: angle.x, ay: angle.y, id: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* released */ }
    setDragging(true);
  };
  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    setAngle({
      x: Math.max(-10, Math.min(55, s.ax - (event.clientY - s.py) * 0.35)),
      y: Math.max(-60, Math.min(60, s.ay + (event.clientX - s.px) * 0.35)),
    });
  };
  const onUp = () => { start.current = null; setDragging(false); };
  // spring back to the resting view after a while, so the scene never stays skewed
  useEffect(() => {
    if (dragging) return;
    const timer = window.setTimeout(() => setAngle(rest), 2600);
    return () => window.clearTimeout(timer);
  }, [dragging, angle, rest]);
  return (
    <div
      className={`stage3d ${dragging ? 'is-dragging' : ''} ${className}`}
      style={{ height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => setAngle(rest)}
    >
      <div className="stage3d-world" style={{ transform: `rotateX(${angle.x}deg) rotateY(${angle.y}deg)` }}>
        <div className="stage3d-floor" />
        {children}
      </div>
      <span className="stage3d-hint">↻</span>
    </div>
  );
}

export function Layer({ z = 0, children, className = '', style }: { z?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`stage3d-layer ${className}`} style={{ transform: `translateZ(${z}px)`, ...style }}>{children}</div>;
}

export function SceneSlider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <label className="lab-slider scene-slider">
      <span>{label}<b>{Number.isInteger(step) ? value : value.toFixed(String(step).split('.')[1]?.length ?? 1)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function SceneModes<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div className="scene-modes" role="group">
      {options.map(([key, label]) => (
        <button key={key} type="button" className={`tag ${value === key ? 'gold' : ''}`} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  );
}

export function SceneNote({ children }: { children: ReactNode }) {
  return <p className="scene-note">{children}</p>;
}

export function SceneFrame({ stage, controls }: { stage: ReactNode; controls: ReactNode }) {
  return (
    <div className="chem-grid scene-frame">
      <div className="panel chem-stage scene-stage">{stage}</div>
      <div className="stack">{controls}</div>
    </div>
  );
}

/** Animation loop with real time step in seconds; pauses when the element is off-screen or the tab is hidden. */
export function useFrame(callback: (dt: number, time: number) => void, active = true) {
  const latest = useRef(callback);
  latest.current = callback;
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    let visible = true;
    const observer = typeof IntersectionObserver !== 'undefined' && host.current
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; })
      : null;
    if (observer && host.current) observer.observe(host.current);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) latest.current(dt, now / 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [active]);
  return host;
}

/** Fit a 2D canvas to its CSS size (device pixel ratio aware). Returns [context, width, height]. */
export function fitCanvas(element: HTMLCanvasElement): [CanvasRenderingContext2D | null, number, number] {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = element.clientWidth, h = element.clientHeight;
  if (element.width !== Math.round(w * ratio) || element.height !== Math.round(h * ratio)) {
    element.width = Math.round(w * ratio);
    element.height = Math.round(h * ratio);
  }
  const context = element.getContext('2d');
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return [context, w, h];
}
