import { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool, Trash2 } from 'lucide-react';
import type { Language } from './school-data';

export type BoardStroke = { id: string; by: string; color: string; width: number; points: Array<[number, number]> };

const COLORS = ['#1E2633', '#B8955A', '#4BA3DB', '#D2475A', '#3FA77A'];
const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/**
 * Shared lesson board. Strokes are normalised to 0..1 so every screen size
 * shows the same picture. The teacher always draws; a student draws only
 * after the teacher hands them the pen.
 */
export function LessonBoard({
  strokes,
  canDraw,
  isHost,
  penHolder,
  language,
  onStroke,
  onClear,
}: {
  strokes: BoardStroke[];
  canDraw: boolean;
  isHost: boolean;
  penHolder: string | null;
  language: Language;
  onStroke: (stroke: BoardStroke) => void;
  onClear: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(COLORS[0]!);
  const [eraser, setEraser] = useState(false);
  const current = useRef<BoardStroke | null>(null);

  const paint = (context: CanvasRenderingContext2D, stroke: BoardStroke, w: number, h: number) => {
    if (stroke.points.length === 0) return;
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width * (w / 900);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    stroke.points.forEach(([x, y], index) => (index ? context.lineTo(x * w, y * h) : context.moveTo(x * w, y * h)));
    if (stroke.points.length === 1) context.lineTo(stroke.points[0]![0] * w + 0.1, stroke.points[0]![1] * h);
    context.stroke();
  };

  const redraw = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const w = element.clientWidth, h = element.clientHeight;
    if (element.width !== Math.round(w * ratio)) { element.width = Math.round(w * ratio); element.height = Math.round(h * ratio); }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, w, h);
    context.strokeStyle = 'rgba(143, 200, 238, 0.25)';
    context.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke(); }
    for (let y = 0; y < h; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke(); }
    for (const stroke of strokes) paint(context, stroke, w, h);
    if (current.current) paint(context, current.current, w, h);
  };

  useEffect(redraw); // every render: new strokes from the lesson or resize
  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };

  return (
    <section className="panel lesson-board">
      <div className="section-head">
        <h2><PenTool size={16} /> {t(language, 'Umumiy doska', 'Общая доска', 'Shared board')}</h2>
        <span className={`tag ${canDraw ? 'green' : ''}`}>
          {canDraw ? t(language, 'Siz yozishingiz mumkin', 'Вы можете писать', 'You can draw') : penHolder ? t(language, 'Hozir boshqa o‘quvchi yozmoqda', 'Сейчас пишет другой ученик', 'Another student is drawing') : t(language, 'O‘qituvchi yozadi', 'Пишет учитель', 'Teacher draws')}
        </span>
      </div>
      {canDraw && (
        <div className="board-toolbar">
          {COLORS.map((value) => (
            <button type="button" key={value} className={`board-color ${!eraser && color === value ? 'active' : ''}`} style={{ background: value }} onClick={() => { setColor(value); setEraser(false); }} aria-label={value} />
          ))}
          <button type="button" className={`btn small ${eraser ? 'primary' : ''}`} onClick={() => setEraser((value) => !value)}><Eraser size={14} /></button>
          {isHost && <button type="button" className="btn small" onClick={onClear}><Trash2 size={14} /> {t(language, 'Tozalash', 'Очистить', 'Clear')}</button>}
        </div>
      )}
      <canvas
        ref={canvas}
        className={`board-canvas ${canDraw ? 'can-draw' : ''}`}
        onPointerDown={(event) => {
          if (!canDraw) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          current.current = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, by: '', color: eraser ? '#FFFFFF' : color, width: eraser ? 26 : 4, points: [point(event)] };
          redraw();
        }}
        onPointerMove={(event) => {
          const stroke = current.current;
          if (!stroke) return;
          const next = point(event);
          const last = stroke.points[stroke.points.length - 1]!;
          if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 0.003) return;
          stroke.points.push(next);
          redraw();
        }}
        onPointerUp={() => {
          const stroke = current.current;
          current.current = null;
          if (!stroke) return;
          // keep the message small: at most 240 points per stroke
          const step = Math.ceil(stroke.points.length / 240);
          const points = stroke.points.filter((_, index) => index % step === 0 || index === stroke.points.length - 1)
            .map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]);
          onStroke({ ...stroke, points });
        }}
      />
    </section>
  );
}
