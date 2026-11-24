/** Own 3D scenes for chemistry topics. */
import { useMemo, useRef, useState } from 'react';
import { Layer, SceneFrame, SceneModes, SceneNote, SceneSlider, Stage3D, fitCanvas, useFrame } from './scene-kit';

/* ------------------------------------------------------------------ */
/* Particles: states of matter, dissolving, density, metals, atoms      */
/* ------------------------------------------------------------------ */

type Dot = { x: number; y: number; vx: number; vy: number; hx: number; hy: number; kind: number; free: boolean };

const ELEMENTS: Array<[string, string, number]> = [
  ['H', 'Водород', 1], ['He', 'Гелий', 2], ['Li', 'Литий', 3], ['C', 'Углерод', 6], ['N', 'Азот', 7], ['O', 'Кислород', 8],
  ['Na', 'Натрий', 11], ['Mg', 'Магний', 12], ['Al', 'Алюминий', 13], ['S', 'Сера', 16], ['Cl', 'Хлор', 17], ['Ca', 'Кальций', 20],
];
const shellsOf = (n: number) => { const out: number[] = []; let left = n; for (const cap of [2, 8, 8, 2]) { if (left <= 0) break; out.push(Math.min(cap, left)); left -= cap; } return out; };

const SOLIDS: Array<[string, number, string]> = [['Пробка', 0.24, '#C9A26E'], ['Дерево', 0.6, '#A87B4E'], ['Лёд', 0.92, '#DDF1FB'], ['Пластик', 1.05, '#D2475A'], ['Алюминий', 2.7, '#B9C0CA'], ['Железо', 7.8, '#5E6470']];

export function ParticlesScene({ mode = 'states' }: { mode?: string }) {
  const [view, setView] = useState(mode === 'heat' ? 'states' : ['states', 'dissolve', 'density', 'metals', 'atoms'].includes(mode) ? mode : 'states');
  const [temp, setTemp] = useState(mode === 'heat' ? -10 : 20);
  const [current, setCurrent] = useState(false);
  const [element, setElement] = useState(5);
  const [dropped, setDropped] = useState<number[]>([1, 4]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dots = useRef<Dot[]>([]);
  const seeded = useRef('');
  const host = useFrame((dt, time) => {
    const node = canvas.current;
    if (!node || view === 'density') return;
    const [ctx, w, h] = fitCanvas(node);
    if (!ctx) return;
    if (seeded.current !== `${view}:${w}`) {
      seeded.current = `${view}:${w}`;
      const list: Dot[] = [];
      if (view === 'states') {
        for (let r = 0; r < 6; r += 1) for (let c = 0; c < 8; c += 1) { const hx = w / 2 - 98 + c * 28, hy = h - 40 - r * 26; list.push({ x: hx, y: hy, vx: 0, vy: 0, hx, hy, kind: 0, free: false }); }
      } else if (view === 'dissolve') {
        for (let i = 0; i < 70; i += 1) list.push({ x: Math.random() * w, y: 40 + Math.random() * (h - 60), vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, hx: 0, hy: 0, kind: 0, free: true });
        for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) { const hx = w / 2 - 30 + c * 20, hy = h - 30 - r * 20; list.push({ x: hx, y: hy, vx: 0, vy: 0, hx, hy, kind: 1, free: false }); }
      } else if (view === 'metals') {
        for (let r = 0; r < 4; r += 1) for (let c = 0; c < 8; c += 1) { const hx = 40 + c * ((w - 80) / 7), hy = 50 + r * ((h - 100) / 3); list.push({ x: hx, y: hy, vx: 0, vy: 0, hx, hy, kind: 0, free: false }); }
        for (let i = 0; i < 40; i += 1) list.push({ x: Math.random() * w, y: 30 + Math.random() * (h - 60), vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, hx: 0, hy: 0, kind: 2, free: true });
      }
      dots.current = list;
    }
    ctx.clearRect(0, 0, w, h);
    if (view === 'atoms') {
      const [symbol, , z] = ELEMENTS[element];
      const cx = w / 2, cy = h / 2;
      shellsOf(z).forEach((count, shell) => {
        const r = 46 + shell * 34;
        ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < count; i += 1) { const a = time * (1.6 - shell * 0.35) + (i / count) * Math.PI * 2; ctx.fillStyle = '#8FC8EE'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 5, 0, Math.PI * 2); ctx.fill(); }
      });
      for (let i = 0; i < Math.min(z * 2, 40); i += 1) { const a = i * 2.4, r = Math.sqrt(i) * 3.2; ctx.fillStyle = i % 2 ? '#D2475A' : '#C9C9CE'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.font = '700 18px DM Sans, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(symbol, cx, h - 14);
      return;
    }
    const heat = view === 'dissolve' ? 0.6 + temp / 100 : 0;
    for (const d of dots.current) {
      if (view === 'states') {
        const phase = temp < 0 ? 0 : temp < 100 ? 1 : 2;
        const energy = 20 + (temp + 60) * 1.4;
        if (phase === 0) { d.x += (d.hx - d.x) * 0.2 + (Math.random() - 0.5) * (2 + (temp + 60) / 12); d.y += (d.hy - d.y) * 0.2 + (Math.random() - 0.5) * (2 + (temp + 60) / 12); d.vx = 0; d.vy = 0; }
        else {
          d.vx += (Math.random() - 0.5) * energy * dt * 6; d.vy += (Math.random() - 0.5) * energy * dt * 6 + (phase === 1 ? 160 * dt : 0);
          const cap = phase === 1 ? energy * 0.9 : energy * 2.2;
          const speed = Math.hypot(d.vx, d.vy); if (speed > cap) { d.vx *= cap / speed; d.vy *= cap / speed; }
          d.x += d.vx * dt; d.y += d.vy * dt;
          const top = phase === 1 ? h - 170 : 12;
          if (d.x < 12 || d.x > w - 12) { d.vx *= -1; d.x = Math.max(12, Math.min(w - 12, d.x)); }
          if (d.y < top || d.y > h - 14) { d.vy *= -0.9; d.y = Math.max(top, Math.min(h - 14, d.y)); }
        }
        ctx.fillStyle = temp < 0 ? '#BFE3F7' : temp < 100 ? '#4BA3DB' : '#9CC9E8';
        ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, Math.PI * 2); ctx.fill();
      } else if (view === 'dissolve') {
        if (!d.free && Math.random() < dt * 0.08 * heat * heat) d.free = true;
        if (d.free) {
          d.vx += (Math.random() - 0.5) * 300 * dt * heat; d.vy += (Math.random() - 0.5) * 300 * dt * heat;
          d.vx *= 0.98; d.vy *= 0.98; d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.x < 10 || d.x > w - 10) d.vx *= -1; if (d.y < 36 || d.y > h - 10) d.vy *= -1;
          d.x = Math.max(10, Math.min(w - 10, d.x)); d.y = Math.max(36, Math.min(h - 10, d.y));
        }
        ctx.fillStyle = d.kind ? '#FFFFFF' : 'rgba(75,163,219,.75)';
        ctx.strokeStyle = 'rgba(30,58,85,.35)';
        ctx.beginPath(); ctx.arc(d.x, d.y, d.kind ? 7 : 5, 0, Math.PI * 2); ctx.fill(); if (d.kind) ctx.stroke();
      } else if (view === 'metals') {
        if (d.kind === 0) { ctx.fillStyle = '#C9C9CE'; ctx.beginPath(); ctx.arc(d.hx + Math.sin(time * 4 + d.hy) * 1.5, d.hy, 13, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1E2633'; ctx.font = '700 11px DM Sans'; ctx.textAlign = 'center'; ctx.fillText('+', d.hx, d.hy + 4); }
        else {
          d.vx += (Math.random() - 0.5) * 400 * dt + (current ? 160 * dt : 0); d.vy += (Math.random() - 0.5) * 400 * dt;
          d.vx *= 0.97; d.vy *= 0.97; d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.x > w) d.x = 0; if (d.x < 0) d.x = w; if (d.y < 20 || d.y > h - 20) d.vy *= -1;
          ctx.fillStyle = '#F2C14E'; ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (view === 'dissolve') { ctx.fillStyle = 'rgba(75,163,219,.08)'; ctx.fillRect(0, 30, w, h - 30); }
  }, view !== 'density');
  const state = temp < 0 ? 'Твёрдое (лёд): частицы колеблются на местах' : temp < 100 ? 'Жидкое (вода): частицы рядом, но скользят друг по другу' : 'Газ (пар): частицы далеко и летят быстро';
  const stage = (
    <Stage3D height={320} className="dark-stage">
      <Layer z={-20}><div className="scene-glass-box" /></Layer>
      <Layer>
        {view === 'density' ? (
          <svg viewBox="0 0 420 230" className="scene-svg">
            <rect x="60" y="40" width="300" height="180" rx="8" fill="rgba(143,200,238,.12)" stroke="rgba(255,255,255,.5)" />
            <rect x="62" y="80" width="296" height="138" fill="#4BA3DB" opacity=".4" />
            {dropped.map((index, order) => { const [name, rho, color] = SOLIDS[index]; const sub = Math.min(1, rho); const y = rho < 1 ? 80 - 26 * (1 - sub) : 190; return <g key={index} style={{ transition: 'transform 1.2s cubic-bezier(.34,1.3,.64,1)', transform: `translate(${80 + order * 46}px, ${y}px)` }}><rect width="36" height="26" rx="4" fill={color} stroke="#1E2633" strokeOpacity=".3" /><text x="18" y="42" fontSize="9" textAnchor="middle" fill="#fff">{name}</text></g>; })}
          </svg>
        ) : <canvas ref={canvas} className="scene-canvas" />}
      </Layer>
    </Stage3D>
  );
  return (
    <div ref={host}>
      <SceneFrame
        stage={stage}
        controls={(
          <section className="panel">
            <SceneModes value={view} onChange={(next) => { setView(next); seeded.current = ''; }} options={[['states', 'Состояния'], ['dissolve', 'Растворение'], ['density', 'Плотность'], ['metals', 'Металлы'], ['atoms', 'Атом']]} />
            {(view === 'states' || view === 'dissolve') && <SceneSlider label="Температура" value={temp} min={view === 'states' ? -50 : 0} max={view === 'states' ? 150 : 100} step={5} unit=" °C" onChange={setTemp} />}
            {view === 'states' && <SceneNote><b>{state}</b>. При 0 °C лёд плавится, при 100 °C вода кипит.</SceneNote>}
            {view === 'dissolve' && <SceneNote>Молекулы воды «отрывают» частицы сахара от кристалла. Чем горячее вода, тем быстрее частицы и тем быстрее растворение.</SceneNote>}
            {view === 'density' && (<><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{SOLIDS.map(([name, rho], index) => <button key={name} type="button" className={`tag ${dropped.includes(index) ? 'gold' : ''}`} onClick={() => setDropped((list) => list.includes(index) ? list.filter((i) => i !== index) : [...list, index].slice(-6))}>{name} · {rho}</button>)}</div><SceneNote>Плотность воды 1 g/cm³. Тело плавает, если его плотность меньше, и тонет, если больше.</SceneNote></>)}
            {view === 'metals' && (<><button type="button" className="btn small" onClick={() => setCurrent((value) => !value)}>{current ? 'Выключить ток' : 'Включить ток'}</button><SceneNote>В металле положительные ионы стоят на местах, а электроны свободно движутся. {current ? 'Под напряжением электроны дрейфуют в одну сторону — это электрический ток.' : 'Без напряжения электроны движутся хаотично.'}</SceneNote></>)}
            {view === 'atoms' && (<><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{ELEMENTS.map(([symbol], index) => <button key={symbol} type="button" className={`tag ${index === element ? 'gold' : ''}`} onClick={() => setElement(index)}>{symbol}</button>)}</div><SceneNote><b>{ELEMENTS[element][1]} ({ELEMENTS[element][0]}), № {ELEMENTS[element][2]}</b>: в ядре {ELEMENTS[element][2]} протонов, вокруг {ELEMENTS[element][2]} электронов по слоям {shellsOf(ELEMENTS[element][2]).join(', ')}.</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* pH: scale, indicators, neutralisation                                */
/* ------------------------------------------------------------------ */

const SUBSTANCES: Array<[string, number]> = [['Лимонный сок', 2], ['Уксус', 3], ['Газировка', 4], ['Кофе', 5], ['Молоко', 6.5], ['Вода', 7], ['Кровь', 7.4], ['Сода', 8.5], ['Мыло', 10], ['Нашатырь', 11], ['Отбеливатель', 12.5]];
const phColor = (ph: number) => {
  const stops = ['#D7263D', '#E8492E', '#F2782B', '#F4A62A', '#F2CF2E', '#C9DA3B', '#7DC24B', '#3FA77A', '#2E9E9E', '#2F80C9', '#3557C9', '#4A3FB8', '#5B2E9E', '#5E2A84', '#4A2266'];
  return stops[Math.max(0, Math.min(14, Math.round(ph)))];
};
const INDICATORS: Record<string, [string, string, string, string]> = {
  litmus: ['Лакмус', '#D2263A', '#8E5BB0', '#2F6FD0'],
  phenol: ['Фенолфталеин', 'rgba(255,255,255,.15)', 'rgba(255,255,255,.15)', '#D62D8F'],
  methyl: ['Метилоранж', '#E0312E', '#F28C28', '#F2CF2E'],
  cabbage: ['Капустный сок', '#E0457B', '#7A4FB0', '#3FA77A'],
};

export function PhScene({ mode = 'scale' }: { mode?: string }) {
  const [view, setView] = useState(['scale', 'indicators', 'neutral'].includes(mode) ? mode : 'scale');
  const [substance, setSubstance] = useState(1);
  const [indicator, setIndicator] = useState('litmus');
  const [drops, setDrops] = useState(0);
  const ph = SUBSTANCES[substance][1];
  const neutralPh = drops < 20 ? 1 + Math.log10(1 + drops / (20.001 - drops)) * 0.9 + drops * 0.04 : drops === 20 ? 7 : Math.min(13, 12 - Math.log10(1 + 20 / (drops - 19.999)) * 0.7);
  const tube = (label: string, color: string, x: number) => (
    <g transform={`translate(${x} 30)`}>
      <path d="M0 0h40v140a20 20 0 0 1-40 0z" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.7)" strokeWidth="2" />
      <path d="M2 60h36v80a18 18 0 0 1-36 0z" fill={color} style={{ transition: 'fill .8s ease' }} />
      <text x="20" y="190" fontSize="11" textAnchor="middle" fill="#fff">{label}</text>
    </g>
  );
  const stage = (
    <Stage3D height={300} className="dark-stage">
      <Layer>
        <svg viewBox="0 0 420 230" className="scene-svg">
          {view === 'scale' && (<g>
            {Array.from({ length: 15 }, (_, i) => <g key={i}><rect x={20 + i * 25} y="170" width="25" height="22" fill={phColor(i)} /><text x={32 + i * 25} y="208" fontSize="10" textAnchor="middle" fill="#fff">{i}</text></g>)}
            <path d={`M${32 + ph * 25} 164l-7 -12h14z`} fill="#fff" style={{ transition: 'transform .6s' }} />
            <path d="M160 20h100v110a20 20 0 0 1-20 20h-60a20 20 0 0 1-20-20z" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.7)" strokeWidth="2" />
            <path d="M162 70h96v60a18 18 0 0 1-18 18h-60a18 18 0 0 1-18-18z" fill={phColor(ph)} style={{ transition: 'fill .8s ease' }} />
            <text x="210" y="112" fontSize="16" fontWeight="700" textAnchor="middle" fill="#fff">pH {ph}</text>
          </g>)}
          {view === 'indicators' && (<g>{tube('Кислота', INDICATORS[indicator][1], 90)}{tube('Вода', INDICATORS[indicator][2], 190)}{tube('Щёлочь', INDICATORS[indicator][3], 290)}</g>)}
          {view === 'neutral' && (<g>
            <path d="M40 200H390M40 200V20" stroke="rgba(255,255,255,.6)" /><path d="M40 110H390" stroke="rgba(255,255,255,.25)" strokeDasharray="4 4" /><text x="44" y="106" fontSize="9" fill="#fff">pH 7</text>
            <polyline fill="none" stroke="#F2C14E" strokeWidth="2.4" points={Array.from({ length: drops + 1 }, (_, d) => { const p = d < 20 ? 1 + Math.log10(1 + d / (20.001 - d)) * 0.9 + d * 0.04 : d === 20 ? 7 : Math.min(13, 12 - Math.log10(1 + 20 / (d - 19.999)) * 0.7); return `${40 + d * 8.5},${200 - p * 13}`; }).join(' ')} />
            <circle cx={40 + drops * 8.5} cy={200 - neutralPh * 13} r="6" fill={phColor(neutralPh)} stroke="#fff" />
            <text x="215" y="226" fontSize="10" textAnchor="middle" fill="#fff">капли NaOH →</text>
          </g>)}
        </svg>
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['scale', 'Шкала pH'], ['indicators', 'Индикаторы'], ['neutral', 'Нейтрализация']]} />
          {view === 'scale' && (<><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{SUBSTANCES.map(([name], index) => <button key={name} type="button" className={`tag ${index === substance ? 'gold' : ''}`} onClick={() => setSubstance(index)}>{name}</button>)}</div><SceneNote><b>{SUBSTANCES[substance][0]}: pH {ph}</b> — {ph < 7 ? 'кислая среда' : ph === 7 ? 'нейтральная среда' : 'щелочная среда'}.</SceneNote></>)}
          {view === 'indicators' && (<><SceneModes value={indicator} onChange={setIndicator} options={Object.entries(INDICATORS).map(([key, value]) => [key, value[0]])} /><SceneNote>Капните индикатор в три пробирки и сравните цвета. Фенолфталеин «молчит» в кислоте, но становится малиновым в щёлочи.</SceneNote></>)}
          {view === 'neutral' && (<><SceneSlider label="Капли щёлочи в кислоту" value={drops} min={0} max={40} unit="" onChange={setDrops} /><SceneNote>HCl + NaOH → NaCl + H₂O. Сейчас pH ≈ <b>{neutralPh.toFixed(1)}</b>. {drops === 20 ? 'Точка нейтрализации: получились соль и вода.' : drops < 20 ? 'Кислоты ещё больше.' : 'Щёлочь в избытке.'}</SceneNote></>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Mixtures: kinds, pure vs mixture, separation, solubility             */
/* ------------------------------------------------------------------ */

const PAIRS: Array<[string, boolean, string, string]> = [
  ['Вода + соль', true, '#4BA3DB', '#FFFFFF'], ['Вода + песок', false, '#4BA3DB', '#C9A26E'], ['Вода + масло', false, '#4BA3DB', '#F2C14E'], ['Воздух', true, '#CFE8F8', '#8FC8EE'],
];
const CURVES: Record<string, [string, (t: number) => number]> = {
  sugar: ['Сахар', (t) => 179 + 3.1 * t],
  salt: ['Соль', (t) => 35.7 + 0.034 * t],
  nitrate: ['Селитра', (t) => 13 + 0.6 * t + 0.017 * t * t],
};

export function MixturesScene({ mode = 'mix' }: { mode?: string }) {
  const [view, setView] = useState(['mix', 'compare', 'separate', 'solubility'].includes(mode) ? mode : 'mix');
  const [pair, setPair] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [left, setLeft] = useState<string[]>(['iron', 'sand', 'salt', 'water']);
  const [log, setLog] = useState<string[]>([]);
  const [temp, setTemp] = useState(20);
  const [grams, setGrams] = useState(30);
  const [curve, setCurve] = useState('salt');
  const grains = useMemo(() => Array.from({ length: 70 }, (_, i) => [((i * 53) % 150) + 135, ((i * 37) % 110) + 85, i] as const), []);
  const solubility = CURVES[curve][1](temp);
  const saturated = grams >= solubility;
  const act = (step: 'magnet' | 'dissolve' | 'filter' | 'evaporate') => {
    const has = (x: string) => left.includes(x);
    if (step === 'magnet' && has('iron')) { setLeft((l) => l.filter((x) => x !== 'iron')); setLog((l) => [...l, 'Магнит забрал железные опилки.']); }
    else if (step === 'dissolve' && has('salt') && !has('solution')) { setLeft((l) => [...l.filter((x) => x !== 'salt'), 'solution']); setLog((l) => [...l, 'Соль растворилась в воде, песок — нет.']); }
    else if (step === 'filter' && has('sand') && has('solution')) { setLeft((l) => l.filter((x) => x !== 'sand')); setLog((l) => [...l, 'Фильтр задержал песок, раствор прошёл.']); }
    else if (step === 'evaporate' && has('solution') && !has('sand')) { setLeft(['crystals']); setLog((l) => [...l, 'Вода испарилась — остались кристаллы соли. Готово!']); }
    else setLog((l) => [...l, 'Этот способ сейчас не поможет — подумайте о порядке.']);
  };
  const boxes: Array<[string, string, string]> = [['Кислород O₂', 'простое', 'pure'], ['Вода H₂O', 'сложное', 'compound'], ['Воздух', 'смесь', 'mix']];
  const stage = (
    <Stage3D height={300}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 230" className="scene-svg">
          {view === 'mix' && (<g>
            <path d="M130 40h160v150a16 16 0 0 1-16 16H146a16 16 0 0 1-16-16z" fill="rgba(143,200,238,.12)" stroke="#1E3A55" strokeWidth="2" />
            <path d="M132 80h156v110a14 14 0 0 1-14 14H146a14 14 0 0 1-14-14z" fill={PAIRS[pair][2]} opacity={pair === 3 ? 0.15 : 0.35} />
            {grains.map(([x, y, i]) => { const [, uniform, , color] = PAIRS[pair]; const yy = uniform ? y : pair === 2 ? 84 + (i % 5) * 4 : 186 + (i % 4) * 4; return <circle key={i} cx={x} cy={yy} r={uniform ? 2.4 : 3.4} fill={color} stroke="rgba(30,58,85,.4)" strokeWidth=".5" />; })}
            <text x="210" y="226" fontSize="13" textAnchor="middle" fill="#1E3A55">{PAIRS[pair][1] ? 'Однородная смесь' : 'Неоднородная смесь'}</text>
          </g>)}
          {view === 'compare' && (<g>
            {boxes.map(([name], index) => (
              <g key={name} transform={`translate(${20 + index * 135} 30)`}>
                <rect width="120" height="130" rx="10" fill="rgba(255,255,255,.6)" stroke="#1E3A55" />
                {Array.from({ length: 9 }, (_, i) => { const x = 18 + (i % 3) * 38, y = 22 + Math.floor(i / 3) * 38; if (index === 0) return <g key={i}><circle cx={x} cy={y} r="7" fill="#D2475A" /><circle cx={x + 11} cy={y} r="7" fill="#D2475A" /></g>; if (index === 1) return <g key={i}><circle cx={x + 5} cy={y} r="8" fill="#D2475A" /><circle cx={x - 4} cy={y + 8} r="4.5" fill="#fff" stroke="#999" /><circle cx={x + 14} cy={y + 8} r="4.5" fill="#fff" stroke="#999" /></g>; return i % 3 === 0 ? <g key={i}><circle cx={x} cy={y} r="7" fill="#D2475A" /><circle cx={x + 11} cy={y} r="7" fill="#D2475A" /></g> : <g key={i}><circle cx={x} cy={y} r="7" fill="#4BA3DB" /><circle cx={x + 11} cy={y} r="7" fill="#4BA3DB" /></g>; })}
                <text x="60" y="150" fontSize="11" textAnchor="middle" fill="#1E3A55">{name}</text>
                {answers[index] && <text x="60" y="168" fontSize="11" textAnchor="middle" fill={answers[index] === boxes[index][2] ? '#2E9E6E' : '#D2475A'}>{answers[index] === boxes[index][2] ? '✓ верно' : '✗ ещё раз'}</text>}
              </g>
            ))}
          </g>)}
          {view === 'separate' && (<g>
            {['iron', 'sand', 'salt', 'water', 'solution', 'crystals'].filter((x) => left.includes(x)).map((x, i) => {
              const label = { iron: 'Железные опилки', sand: 'Песок', salt: 'Соль', water: 'Вода', solution: 'Солёная вода', crystals: 'Кристаллы соли ✓' }[x] ?? x;
              const color = { iron: '#5E6470', sand: '#C9A26E', salt: '#FFFFFF', water: '#4BA3DB', solution: '#8FC8EE', crystals: '#FFFFFF' }[x] ?? '#ccc';
              return <g key={x} style={{ transform: `translate(${40 + i * 92}px, 70px)`, transition: 'transform .7s cubic-bezier(.34,1.3,.64,1)' }}><rect width="80" height="80" rx="12" fill={color} stroke="#1E3A55" opacity=".9" /><text x="40" y="100" fontSize="10" textAnchor="middle" fill="#1E3A55">{label}</text></g>;
            })}
          </g>)}
          {view === 'solubility' && (<g>
            <path d="M40 200H400M40 200V20" stroke="#1E3A55" />
            {Object.entries(CURVES).map(([key, [, f]]) => <polyline key={key} fill="none" stroke={key === curve ? '#D2475A' : 'rgba(30,58,85,.25)'} strokeWidth={key === curve ? 2.6 : 1.4} points={Array.from({ length: 21 }, (_, i) => `${40 + i * 18},${200 - Math.min(180, f(i * 5) * 0.36)}`).join(' ')} />)}
            <circle cx={40 + temp * 3.6} cy={200 - Math.min(180, grams * 0.36)} r="6" fill={saturated ? '#D2475A' : '#2E9E6E'} stroke="#fff" />
            <text x="400" y="216" fontSize="10" textAnchor="end">t, °C</text><text x="44" y="16" fontSize="10">g на 100 g воды</text>
          </g>)}
        </svg>
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['mix', 'Смеси'], ['compare', 'Вещество или смесь'], ['separate', 'Разделение'], ['solubility', 'Растворимость']]} />
          {view === 'mix' && (<><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{PAIRS.map(([name], index) => <button key={name} type="button" className={`tag ${index === pair ? 'gold' : ''}`} onClick={() => setPair(index)}>{name}</button>)}</div><SceneNote>В однородной смеси частицы распределены равномерно и не видны глазом. В неоднородной — видны слои или крупинки.</SceneNote></>)}
          {view === 'compare' && boxes.map(([name], index) => (
            <div key={name} className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}><b style={{ minWidth: 110 }}>{name}</b>{[['pure', 'простое'], ['compound', 'сложное'], ['mix', 'смесь']].map(([key, label]) => <button key={key} type="button" className={`tag ${answers[index] === key ? 'gold' : ''}`} onClick={() => setAnswers((value) => ({ ...value, [index]: key }))}>{label}</button>)}</div>
          ))}
          {view === 'separate' && (<><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="btn small" onClick={() => act('magnet')}>🧲 Магнит</button><button type="button" className="btn small" onClick={() => act('dissolve')}>💧 Растворить</button>
            <button type="button" className="btn small" onClick={() => act('filter')}>⏳ Фильтр</button><button type="button" className="btn small" onClick={() => act('evaporate')}>🔥 Выпарить</button>
            <button type="button" className="btn small" onClick={() => { setLeft(['iron', 'sand', 'salt', 'water']); setLog([]); }}>Сначала</button></div>
            <SceneNote>{log.length ? log[log.length - 1] : 'Разделите смесь железа, песка и соли. Выбирайте способы в правильном порядке.'}</SceneNote></>)}
          {view === 'solubility' && (<><SceneModes value={curve} onChange={setCurve} options={Object.entries(CURVES).map(([key, [name]]) => [key, name])} /><SceneSlider label="Температура воды" value={temp} min={0} max={100} step={5} unit=" °C" onChange={setTemp} /><SceneSlider label="Насыпали в 100 g воды" value={grams} min={0} max={400} step={5} unit=" g" onChange={setGrams} /><SceneNote>Растворимость при {temp} °C ≈ <b>{solubility.toFixed(0)} g</b>. {saturated ? 'Раствор насыщенный — лишнее вещество лежит на дне.' : 'Раствор ненасыщенный — можно растворить ещё.'}</SceneNote></>)}
        </section>
      )}
    />
  );
}
