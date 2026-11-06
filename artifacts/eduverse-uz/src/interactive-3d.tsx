import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Move3d, RotateCcw, TouchpadOff, ZoomIn, ZoomOut } from 'lucide-react';
import type { Visual3d } from '@workspace/api-client-react';

type Part = Visual3d['parts'][number];

/**
 * A dependency-free pseudo-3D object renderer.
 *
 * The object is a CSS `transform-style: preserve-3d` stage the user can:
 *   - rotate by dragging on empty space (or one finger),
 *   - pinch / scroll to zoom,
 *   - drag individual parts marked `draggable`,
 *   - reset and auto-rotate.
 *
 * It intentionally avoids WebGL so it works on low-end phones, tablets, and
 * projectors without a GPU context, matching "трогать и использовать" while
 * staying fast and offline-capable. Every part is a labelled primitive.
 */

export type Scene = Visual3d;

type DragState =
  | { mode: 'rotate'; x: number; y: number; rotX: number; rotY: number }
  | { mode: 'part'; id: string; x: number; y: number; offset: [number, number] };

export function Interactive3d({
  scene,
  height = 360,
  compact = false,
}: {
  scene: Scene;
  height?: number;
  compact?: boolean;
}) {
  const [rotX, setRotX] = useState(-18);
  const [rotY, setRotY] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const [offsets, setOffsets] = useState<Record<string, [number, number]>>({});
  const [activePart, setActivePart] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    setOffsets({});
    setRotX(-18);
    setRotY(24);
    setZoom(1);
  }, [scene.kind, scene.label]);

  useEffect(() => {
    if (!autoRotate) return;
    let frame = 0;
    const tick = () => {
      setRotY((value) => value + 0.25);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate]);

  const beginRotate = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      setAutoRotate(false);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      drag.current = { mode: 'rotate', x: event.clientX, y: event.clientY, rotX, rotY };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [rotX, rotY],
  );

  const startPart = useCallback(
    (event: React.PointerEvent, part: Part) => {
      if (!part.draggable) return;
      event.stopPropagation();
      setAutoRotate(false);
      setActivePart(part.id);
      const current = offsets[part.id] ?? [0, 0];
      drag.current = { mode: 'part', id: part.id, x: event.clientX, y: event.clientY, offset: current };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [offsets],
  );

  const move = useCallback((event: React.PointerEvent) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinchStart.current) {
        pinchStart.current = { distance, zoom };
      } else {
        const ratio = distance / pinchStart.current.distance;
        setZoom(clamp(pinchStart.current.zoom * ratio, 0.5, 2.6));
      }
      return;
    }
    const state = drag.current;
    if (!state) return;
    if (state.mode === 'rotate') {
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      setRotY(state.rotY + dx * 0.6);
      setRotX(clamp(state.rotX - dy * 0.6, -85, 85));
    } else {
      const dx = (event.clientX - state.x) / 120;
      const dy = (event.clientY - state.y) / 120;
      setOffsets((current) => ({
        ...current,
        [state.id]: [
          clamp(state.offset[0] + dx, -1.6, 1.6),
          clamp(state.offset[1] + dy, -1.6, 1.6),
        ],
      }));
    }
  }, [zoom]);

  const end = useCallback(() => {
    pointers.current.clear();
    pinchStart.current = null;
    drag.current = null;
  }, []);

  const reset = () => {
    setRotX(-18);
    setRotY(24);
    setZoom(1);
    setOffsets({});
    setActivePart(null);
    setAutoRotate(true);
  };

  return (
    <div className="i3d" data-kind={scene.kind}>
      <div
        ref={stageRef}
        className="i3d-stage"
        style={{ height }}
        onPointerDown={beginRotate}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={(event) => {
          event.preventDefault();
          setAutoRotate(false);
          setZoom((value) => clamp(value - event.deltaY * 0.001, 0.5, 2.6));
        }}
        role="application"
        aria-label={`${scene.label}. Вращайте, приближайте и перетаскивайте части.`}
      >
        <div className="i3d-glow" aria-hidden="true" />
        <div
          className="i3d-object"
          style={{
            transform: `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
          }}
        >
          {scene.parts.map((part) => {
            const off = offsets[part.id] ?? [0, 0];
            const isActive = activePart === part.id;
            return (
              <div
                key={part.id}
                className={`i3d-part shape-${part.shape} ${part.draggable ? 'is-draggable' : ''} ${isActive ? 'is-active' : ''}`}
                style={{
                  background: part.color,
                  width: `${part.scale * 150}px`,
                  height: part.shape === 'ring' || part.shape === 'torus' ? `${part.scale * 150}px` : `${part.scale * 150}px`,
                  transform: `translate3d(${(part.position[0] + off[0]) * 120}px, ${(part.position[1] - off[1]) * 120}px, ${part.position[2] * 120}px)`,
                  zIndex: isActive ? 50 : Math.round(part.position[2] * 10) + 20,
                }}
                onPointerDown={(event) => startPart(event, part)}
                title={part.label}
              >
                <span className="i3d-part-label">{part.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="i3d-toolbar">
        <div className="i3d-hint">
          <Move3d size={14} />
          <span>{compact ? scene.interactions[0] : scene.interactions.join(' · ')}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small" onClick={() => setZoom((v) => clamp(v - 0.2, 0.5, 2.6))} aria-label="Уменьшить">
            <ZoomOut size={14} />
          </button>
          <button type="button" className="btn small" onClick={() => setZoom((v) => clamp(v + 0.2, 0.5, 2.6))} aria-label="Увеличить">
            <ZoomIn size={14} />
          </button>
          <button type="button" className={`btn small ${autoRotate ? 'primary' : ''}`} onClick={() => setAutoRotate((v) => !v)} aria-label="Вращение">
            {autoRotate ? <RotateCcw size={14} /> : <TouchpadOff size={14} />}
          </button>
          <button type="button" className="btn small" onClick={reset} aria-label="Сбросить">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <p className="i3d-caption">{scene.caption}</p>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
