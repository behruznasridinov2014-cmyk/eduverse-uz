import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { LessonTopic } from '@workspace/api-client-react';
import type { Language } from './school-data';
import { TopicModels } from './topic-library';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* -------------------------------------------------------------------------- */
/* Mathematics: 3D solids with live volume and surface area                    */
/* -------------------------------------------------------------------------- */

type Solid = 'cube' | 'prism' | 'pyramid' | 'cylinder' | 'cone' | 'sphere';
type P3 = [number, number, number];

function solidGeometry(solid: Solid, a: number, h: number, segments = 28): { points: P3[]; edges: Array<[number, number]>; faces: number[][] } {
  const points: P3[] = [];
  const edges: Array<[number, number]> = [];
  const faces: number[][] = [];
  const ring = (y: number, r: number, n: number) => {
    const start = points.length;
    for (let i = 0; i < n; i += 1) points.push([Math.cos((i / n) * Math.PI * 2) * r, y, Math.sin((i / n) * Math.PI * 2) * r]);
    for (let i = 0; i < n; i += 1) edges.push([start + i, start + ((i + 1) % n)]);
    return start;
  };
  if (solid === 'cube' || solid === 'prism') {
    const half = a / 2;
    const top = solid === 'cube' ? a / 2 : h / 2;
    const base = [[-half, -half], [half, -half], [half, half], [-half, half]];
    base.forEach(([x, z]) => points.push([x!, -top, z!]));
    base.forEach(([x, z]) => points.push([x!, top, z!]));
    for (let i = 0; i < 4; i += 1) { edges.push([i, (i + 1) % 4], [i + 4, ((i + 1) % 4) + 4], [i, i + 4]); }
    faces.push([0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]);
  } else if (solid === 'pyramid') {
    const half = a / 2;
    [[-half, -half], [half, -half], [half, half], [-half, half]].forEach(([x, z]) => points.push([x!, -h / 2, z!]));
    points.push([0, h / 2, 0]);
    for (let i = 0; i < 4; i += 1) edges.push([i, (i + 1) % 4], [i, 4]);
    faces.push([0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]);
  } else if (solid === 'cylinder') {
    const b = ring(-h / 2, a, segments);
    const tp = ring(h / 2, a, segments);
    for (let i = 0; i < segments; i += 4) edges.push([b + i, tp + i]);
    for (let i = 0; i < segments; i += 1) faces.push([b + i, b + ((i + 1) % segments), tp + ((i + 1) % segments), tp + i]);
  } else if (solid === 'cone') {
    const b = ring(-h / 2, a, segments);
    points.push([0, h / 2, 0]);
    const apex = points.length - 1;
    for (let i = 0; i < segments; i += 4) edges.push([b + i, apex]);
    for (let i = 0; i < segments; i += 1) faces.push([b + i, b + ((i + 1) % segments), apex]);
  } else {
    const rings = 10;
    for (let j = 1; j < rings; j += 1) {
      const phi = (j / rings) * Math.PI;
      ring(Math.cos(phi) * a, Math.sin(phi) * a, segments);
    }
    // meridians
    for (let i = 0; i < segments; i += 4) {
      for (let j = 0; j < rings - 2; j += 1) edges.push([j * segments + i, (j + 1) * segments + i]);
    }
    for (let j = 0; j < rings - 2; j += 1) {
      for (let i = 0; i < segments; i += 1) faces.push([j * segments + i, j * segments + ((i + 1) % segments), (j + 1) * segments + ((i + 1) % segments), (j + 1) * segments + i]);
    }
  }
  return { points, edges, faces };
}

function solidMath(solid: Solid, a: number, h: number): { volume: number; area: number; v: string; s: string } {
  const PI = Math.PI;
  switch (solid) {
    case 'cube': return { volume: a ** 3, area: 6 * a * a, v: 'V = a³', s: 'S = 6a²' };
    case 'prism': return { volume: a * a * h, area: 2 * a * a + 4 * a * h, v: 'V = a²·h', s: 'S = 2a² + 4ah' };
    case 'pyramid': {
      const slant = Math.sqrt(h * h + (a / 2) ** 2);
      return { volume: (a * a * h) / 3, area: a * a + 2 * a * slant, v: 'V = ⅓·a²·h', s: 'S = a² + 2a·l' };
    }
    case 'cylinder': return { volume: PI * a * a * h, area: 2 * PI * a * (a + h), v: 'V = πr²h', s: 'S = 2πr(r + h)' };
    case 'cone': {
      const l = Math.sqrt(a * a + h * h);
      return { volume: (PI * a * a * h) / 3, area: PI * a * (a + l), v: 'V = ⅓πr²h', s: 'S = πr(r + l)' };
    }
    default: return { volume: (4 / 3) * PI * a ** 3, area: 4 * PI * a * a, v: 'V = ⁴⁄₃πr³', s: 'S = 4πr²' };
  }
}

export function MathLab({ language }: { language: Language }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [solid, setSolid] = useState<Solid>('cube');
  const [a, setA] = useState(2);
  const [h, setH] = useState(3);
  const [filled, setFilled] = useState(true);
  const rot = useRef({ x: -0.45, y: 0.6, drag: null as null | { x: number; y: number }, auto: true });
  const usesH = solid !== 'cube' && solid !== 'sphere';
  const round = solid === 'cylinder' || solid === 'cone' || solid === 'sphere';
  const math = solidMath(solid, a, h);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    const geo = solidGeometry(solid, a, h);
    const size = Math.max(a * (round ? 2 : 1.5), usesH ? h : a);
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = element.clientWidth, hh = element.clientHeight;
      if (element.width !== w * ratio) { element.width = w * ratio; element.height = hh * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, w, hh);
      if (rot.current.auto && !rot.current.drag) rot.current.y += 0.006;
      const { x: ax, y: ay } = rot.current;
      const scale = (Math.min(w, hh) * 0.58) / size;
      const proj = geo.points.map(([x, y, z]) => {
        let X = x, Y = -y, Z = z;
        [X, Z] = [X * Math.cos(ay) + Z * Math.sin(ay), -X * Math.sin(ay) + Z * Math.cos(ay)];
        [Y, Z] = [Y * Math.cos(ax) - Z * Math.sin(ax), Y * Math.sin(ax) + Z * Math.cos(ax)];
        const p = 6 / (6 + Z * 0.4);
        return { x: w / 2 + X * scale * p, y: hh / 2 + Y * scale * p, z: Z };
      });
      if (filled) {
        const faces = geo.faces.map((face) => ({ face, z: face.reduce((sum, i) => sum + proj[i]!.z, 0) / face.length })).sort((p, q) => q.z - p.z);
        for (const { face, z } of faces) {
          context.beginPath();
          face.forEach((i, k) => (k ? context.lineTo(proj[i]!.x, proj[i]!.y) : context.moveTo(proj[i]!.x, proj[i]!.y)));
          context.closePath();
          const light = Math.max(0.15, Math.min(0.55, 0.38 - z * 0.06));
          context.fillStyle = `rgba(184, 149, 90, ${light})`;
          context.fill();
        }
      }
      context.strokeStyle = '#D6C9B5';
      context.lineWidth = 1.6;
      for (const [p, q] of geo.edges) {
        context.beginPath();
        context.moveTo(proj[p]!.x, proj[p]!.y);
        context.lineTo(proj[q]!.x, proj[q]!.y);
        context.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [solid, a, h, filled, usesH, round]);

  const names: Record<Solid, [string, string, string]> = {
    cube: ['Kub', 'Куб', 'Cube'], prism: ['Prizma', 'Призма', 'Prism'], pyramid: ['Piramida', 'Пирамида', 'Pyramid'],
    cylinder: ['Silindr', 'Цилиндр', 'Cylinder'], cone: ['Konus', 'Конус', 'Cone'], sphere: ['Shar', 'Шар', 'Sphere'],
  };
  const nameOf = (key: Solid) => t(language, ...names[key]);
  return (
    <div className="chem-grid">
      <div className="panel chem-stage">
        <canvas
          ref={canvas}
          className="chem-canvas"
          style={{ height: 360 }}
          onPointerDown={(event) => { rot.current.drag = { x: event.clientX, y: event.clientY }; rot.current.auto = false; (event.target as HTMLElement).setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { const d = rot.current.drag; if (!d) return; rot.current.y += (event.clientX - d.x) * 0.01; rot.current.x += (event.clientY - d.y) * 0.01; rot.current.drag = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={() => { rot.current.drag = null; }}
        />
        <div className="chem-caption"><b>{nameOf(solid)}</b><span className="muted"> · {t(language, 'aylantirish uchun torting', 'потяните, чтобы вращать', 'drag to rotate')}</span></div>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="chem-presets" style={{ marginBottom: 14 }}>
            {(Object.keys(names) as Solid[]).map((key) => (
              <button type="button" key={key} className={`tag ${solid === key ? 'gold' : ''}`} onClick={() => setSolid(key)}>{nameOf(key)}</button>
            ))}
          </div>
          <label className="lab-slider"><span>{round ? t(language, 'Radius r', 'Радиус r', 'Radius r') : t(language, 'Tomon a', 'Сторона a', 'Side a')}<b>{a} {t(language, 'sm', 'см', 'cm')}</b></span>
            <input type="range" min={0.5} max={5} step={0.5} value={a} onChange={(event) => setA(Number(event.target.value))} /></label>
          {usesH && <label className="lab-slider"><span>{t(language, 'Balandlik h', 'Высота h', 'Height h')}<b>{h} {t(language, 'sm', 'см', 'cm')}</b></span>
            <input type="range" min={0.5} max={8} step={0.5} value={h} onChange={(event) => setH(Number(event.target.value))} /></label>}
          <button type="button" className="btn small" onClick={() => setFilled((value) => !value)}>{filled ? t(language, 'Faqat qirralar', 'Только рёбра', 'Edges only') : t(language, 'Yuzalar bilan', 'С гранями', 'With faces')}</button>
        </section>
        <section className="panel lab-result">
          <div className="lab-formula">{math.v}</div>
          <div className="lab-value">V = <b>{math.volume.toFixed(2)}</b> {t(language, 'sm³', 'см³', 'cm³')}</div>
          <div className="lab-formula" style={{ marginTop: 10 }}>{math.s}</div>
          <div className="lab-value">S = <b>{math.area.toFixed(2)}</b> {t(language, 'sm²', 'см²', 'cm²')}</div>
          <p className="muted">{t(language,
            'O‘lchamni 2 marta oshiring — hajm 8 marta oshadi. Buni slayder bilan tekshiring.',
            'Увеличьте размер в 2 раза — объём вырастет в 8 раз. Проверьте ползунком.',
            'Double the size — the volume grows 8 times. Check it with the slider.')}</p>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Biology, geography, any topic: real 3D models from the internet            */
/* -------------------------------------------------------------------------- */

type Preset = { query: string; label: [string, string, string] };
export const WEB_PRESETS: Record<'bio' | 'geo' | 'any', Preset[]> = {
  bio: [
    { query: 'animal cell biology', label: ['Hayvon hujayrasi', 'Животная клетка', 'Animal cell'] },
    { query: 'plant cell', label: ['O‘simlik hujayrasi', 'Растительная клетка', 'Plant cell'] },
    { query: 'human heart anatomy', label: ['Yurak', 'Сердце', 'Heart'] },
    { query: 'dna double helix', label: ['DNK', 'ДНК', 'DNA'] },
    { query: 'human skeleton', label: ['Skelet', 'Скелет', 'Skeleton'] },
    { query: 'human eye anatomy', label: ['Ko‘z', 'Глаз', 'Eye'] },
    { query: 'human brain anatomy', label: ['Miya', 'Мозг', 'Brain'] },
    { query: 'flower anatomy', label: ['Gul tuzilishi', 'Строение цветка', 'Flower'] },
  ],
  geo: [
    { query: 'earth globe planet', label: ['Yer', 'Земля', 'Earth'] },
    { query: 'volcano cross section', label: ['Vulqon', 'Вулкан', 'Volcano'] },
    { query: 'solar system planets', label: ['Quyosh tizimi', 'Солнечная система', 'Solar system'] },
    { query: 'earth layers core mantle', label: ['Yer qatlamlari', 'Слои Земли', 'Earth layers'] },
    { query: 'mountain terrain', label: ['Tog‘lar', 'Горы', 'Mountains'] },
    { query: 'moon planet', label: ['Oy', 'Луна', 'Moon'] },
  ],
  any: [
    { query: 'registan samarkand', label: ['Registon', 'Регистан', 'Registan'] },
    { query: 'ancient egypt pyramid', label: ['Misr piramidasi', 'Пирамида Египта', 'Egypt pyramid'] },
    { query: 'dinosaur skeleton', label: ['Dinozavr', 'Динозавр', 'Dinosaur'] },
    { query: 'jet engine', label: ['Reaktiv dvigatel', 'Реактивный двигатель', 'Jet engine'] },
  ],
};

export function WebModelsLab({ language, group }: { language: Language; group: 'bio' | 'geo' | 'any' }) {
  const presets = WEB_PRESETS[group];
  const [query, setQuery] = useState(presets[0]!.query);
  const [title, setTitle] = useState(t(language, ...presets[0]!.label));
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setQuery(presets[0]!.query);
    setTitle(t(language, ...presets[0]!.label));
  }, [group]); // eslint-disable-line react-hooks/exhaustive-deps

  // TopicModels searches by the 3D "kind" first, then by subject + title.
  const topic = { id: `studio-${query}`, subject: '', title: query, visual3d: { kind: query, parts: [] } } as unknown as LessonTopic;
  return (
    <div className="stack">
      <section className="panel">
        <div className="chem-presets">
          {presets.map((preset) => (
            <button type="button" key={preset.query} className={`tag ${query === preset.query ? 'gold' : ''}`} onClick={() => { setQuery(preset.query); setTitle(t(language, ...preset.label)); }}>
              {t(language, ...preset.label)}
            </button>
          ))}
        </div>
        <form className="studio-search" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { setQuery(draft.trim()); setTitle(draft.trim()); } }}>
          <input className="input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t(language, 'Har qanday mavzu: masalan, “Amir Temur”, “yurak”, “atom”', 'Любая тема: например, «Амир Темур», «сердце», «атом»', 'Any topic: e.g. “heart”, “atom”, “castle”')} />
          <button type="submit" className="btn primary"><Search size={15} /> {t(language, 'Qidirish', 'Найти 3D', 'Find 3D')}</button>
        </form>
      </section>
      <div className="studio-title">{title}</div>
      <TopicModels key={query} topic={topic} language={language} />
    </div>
  );
}
