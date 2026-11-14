import { useEffect, useRef, useState } from 'react';
import type { Language } from './school-data';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/**
 * Physics lab: a pendulum (period, energy) and an electric circuit (Ohm's
 * law). Real formulas drive the animation, so what students change on the
 * sliders is what they would measure in a real experiment.
 */
export function PhysicsLab({ language }: { language: Language }) {
  const [mode, setMode] = useState<'pendulum' | 'circuit'>('pendulum');
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className={`btn ${mode === 'pendulum' ? 'primary' : ''}`} onClick={() => setMode('pendulum')}>{t(language, 'Mayatnik', 'Маятник', 'Pendulum')}</button>
        <button type="button" className={`btn ${mode === 'circuit' ? 'primary' : ''}`} onClick={() => setMode('circuit')}>{t(language, 'Elektr zanjiri', 'Электрическая цепь', 'Electric circuit')}</button>
      </div>
      {mode === 'pendulum' ? <Pendulum language={language} /> : <Circuit language={language} />}
    </div>
  );
}

const PLANETS: Array<{ id: string; g: number; name: [string, string, string] }> = [
  { id: 'earth', g: 9.81, name: ['Yer', 'Земля', 'Earth'] },
  { id: 'moon', g: 1.62, name: ['Oy', 'Луна', 'Moon'] },
  { id: 'mars', g: 3.71, name: ['Mars', 'Марс', 'Mars'] },
  { id: 'jupiter', g: 24.79, name: ['Yupiter', 'Юпитер', 'Jupiter'] },
];

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="lab-slider">
      <span>{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Pendulum({ language }: { language: Language }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [length, setLength] = useState(1.0);
  const [angle, setAngle] = useState(30);
  const [planet, setPlanet] = useState('earth');
  const [running, setRunning] = useState(true);
  const g = PLANETS.find((item) => item.id === planet)!.g;
  const period = 2 * Math.PI * Math.sqrt(length / g);
  const state = useRef({ theta: (30 * Math.PI) / 180, omega: 0, trail: [] as Array<[number, number]>, swings: 0, lastSign: 1, time: 0 });

  useEffect(() => {
    state.current = { theta: (angle * Math.PI) / 180, omega: 0, trail: [], swings: 0, lastSign: 1, time: 0 };
  }, [angle, length, planet]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = state.current;
      if (running) {
        // semi-implicit Euler on the full non-linear equation
        for (let i = 0; i < 4; i += 1) {
          s.omega += (-(g / length) * Math.sin(s.theta)) * (dt / 4);
          s.theta += s.omega * (dt / 4);
        }
        s.time += dt;
      }
      const ratio = window.devicePixelRatio || 1;
      const w = element.clientWidth, h = element.clientHeight;
      if (element.width !== w * ratio) { element.width = w * ratio; element.height = h * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, w, h);
      const pivot = { x: w / 2, y: 36 };
      const px = Math.min(h - 90, w * 0.42) / 2.2; // pixels per metre
      const bob = { x: pivot.x + Math.sin(s.theta) * length * px, y: pivot.y + Math.cos(s.theta) * length * px };
      s.trail.push([bob.x, bob.y]);
      if (s.trail.length > 70) s.trail.shift();
      // ceiling
      context.fillStyle = '#3A3A42';
      context.fillRect(pivot.x - 70, pivot.y - 8, 140, 6);
      // trail
      context.beginPath();
      s.trail.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
      context.strokeStyle = 'rgba(214, 209, 196, 0.35)';
      context.lineWidth = 2;
      context.stroke();
      // string
      context.beginPath();
      context.moveTo(pivot.x, pivot.y);
      context.lineTo(bob.x, bob.y);
      context.strokeStyle = '#C9C9CE';
      context.lineWidth = 2;
      context.stroke();
      // bob with shading (3D look)
      const r = 18;
      const grad = context.createRadialGradient(bob.x - 6, bob.y - 6, 2, bob.x, bob.y, r);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.3, '#E02544');
      grad.addColorStop(1, '#5A0614');
      context.fillStyle = grad;
      context.beginPath();
      context.arc(bob.x, bob.y, r, 0, Math.PI * 2);
      context.fill();
      // energy bars
      const height = length * (1 - Math.cos(s.theta));
      const maxHeight = length * (1 - Math.cos((angle * Math.PI) / 180)) || 1e-6;
      const potential = Math.max(0, Math.min(1, height / maxHeight));
      const bar = (x: number, value: number, color: string, label: string) => {
        context.fillStyle = '#26262C';
        context.fillRect(x, h - 110, 16, 90);
        context.fillStyle = color;
        context.fillRect(x, h - 20 - 90 * value, 16, 90 * value);
        context.fillStyle = '#8E8E96';
        context.font = '600 11px DM Sans, sans-serif';
        context.fillText(label, x - 2, h - 6);
      };
      bar(18, potential, '#D6D1C4', 'Eп');
      bar(46, 1 - potential, '#E02544', 'Eк');
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [g, length, angle, running]);

  return (
    <div className="chem-grid">
      <div className="panel chem-stage"><canvas ref={canvas} className="chem-canvas" style={{ height: 360 }} /></div>
      <div className="stack">
        <section className="panel">
          <Slider label={t(language, 'Ip uzunligi', 'Длина нити', 'Length')} value={length} min={0.2} max={2.5} step={0.1} unit=" m" onChange={setLength} />
          <Slider label={t(language, 'Og‘ish burchagi', 'Угол отклонения', 'Angle')} value={angle} min={5} max={80} step={1} unit="°" onChange={setAngle} />
          <div className="chem-presets">
            {PLANETS.map((item) => (
              <button type="button" key={item.id} className={`tag ${planet === item.id ? 'gold' : ''}`} onClick={() => setPlanet(item.id)}>
                {language === 'Uzbek' ? item.name[0] : language === 'Русский' ? item.name[1] : item.name[2]} · g={item.g}
              </button>
            ))}
          </div>
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setRunning((value) => !value)}>{running ? t(language, 'To‘xtatish', 'Пауза', 'Pause') : t(language, 'Davom etish', 'Продолжить', 'Resume')}</button>
        </section>
        <section className="panel lab-result">
          <div className="lab-formula">T = 2π√(L / g)</div>
          <div className="lab-value">T = <b>{period.toFixed(2)}</b> s</div>
          <p className="muted">{t(language,
            'Davr massaga bog‘liq emas: faqat ip uzunligi va erkin tushish tezlanishiga bog‘liq. Oyda mayatnik ancha sekin tebranadi.',
            'Период не зависит от массы — только от длины нити и ускорения свободного падения. На Луне маятник качается заметно медленнее.',
            'The period does not depend on mass — only on length and gravity. On the Moon the pendulum swings much slower.')}</p>
        </section>
      </div>
    </div>
  );
}

function Circuit({ language }: { language: Language }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [voltage, setVoltage] = useState(6);
  const [resistance, setResistance] = useState(12);
  const [closed, setClosed] = useState(true);
  const current = closed ? voltage / resistance : 0;
  const power = current * voltage;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    let offset = 0;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = element.clientWidth, h = element.clientHeight;
      if (element.width !== w * ratio) { element.width = w * ratio; element.height = h * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, w, h);
      const box = { l: w * 0.15, r: w * 0.85, t: h * 0.22, b: h * 0.78 };
      // wires
      context.strokeStyle = '#8E8E96';
      context.lineWidth = 4;
      context.strokeRect(box.l, box.t, box.r - box.l, box.b - box.t);
      // electrons moving along the loop, speed ∝ current
      offset = (offset + current * 2.2) % 40;
      const perimeter = 2 * (box.r - box.l + box.b - box.t);
      const at = (d: number): [number, number] => {
        const wTop = box.r - box.l, hSide = box.b - box.t;
        d = ((d % perimeter) + perimeter) % perimeter;
        if (d < wTop) return [box.l + d, box.t];
        if (d < wTop + hSide) return [box.r, box.t + (d - wTop)];
        if (d < 2 * wTop + hSide) return [box.r - (d - wTop - hSide), box.b];
        return [box.l, box.b - (d - 2 * wTop - hSide)];
      };
      if (closed) {
        context.fillStyle = '#D6D1C4';
        for (let d = offset; d < perimeter; d += 40) {
          const [x, y] = at(d);
          context.beginPath();
          context.arc(x, y, 3.5, 0, Math.PI * 2);
          context.fill();
        }
      }
      // battery (left)
      const by = (box.t + box.b) / 2;
      context.fillStyle = '#0A0A0B';
      context.fillRect(box.l - 18, by - 34, 36, 68);
      context.fillStyle = '#E8C534';
      context.fillRect(box.l - 16, by - 32, 32, 30);
      context.fillStyle = '#3A3A42';
      context.fillRect(box.l - 16, by - 2, 32, 32);
      context.fillStyle = '#F2F2F3';
      context.font = '700 12px DM Sans, sans-serif';
      context.textAlign = 'center';
      context.fillText(`${voltage} V`, box.l, by + 52);
      // lamp (top), brightness ∝ power
      const lx = (box.l + box.r) / 2;
      const glow = Math.min(1, power / 12);
      if (glow > 0) {
        const halo = context.createRadialGradient(lx, box.t, 4, lx, box.t, 26 + glow * 60);
        halo.addColorStop(0, `rgba(255, 214, 120, ${0.55 * glow + 0.1})`);
        halo.addColorStop(1, 'rgba(255, 214, 120, 0)');
        context.fillStyle = halo;
        context.beginPath();
        context.arc(lx, box.t, 26 + glow * 60, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = glow > 0 ? `rgb(${255}, ${200 + glow * 40}, ${90 + glow * 100})` : '#3A3A42';
      context.beginPath();
      context.arc(lx, box.t, 16, 0, Math.PI * 2);
      context.fill();
      // resistor (right)
      context.fillStyle = '#141417';
      context.fillRect(box.r - 14, by - 30, 28, 60);
      context.strokeStyle = '#D6D1C4';
      context.lineWidth = 2;
      context.strokeRect(box.r - 14, by - 30, 28, 60);
      context.fillStyle = '#F2F2F3';
      context.fillText(`${resistance} Ω`, box.r, by + 48);
      // switch (bottom)
      const sx = (box.l + box.r) / 2;
      context.fillStyle = '#0A0A0B';
      context.fillRect(sx - 30, box.b - 6, 60, 12);
      context.strokeStyle = closed ? '#35C48D' : '#F06A78';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(sx - 26, box.b);
      context.lineTo(sx + 26, closed ? box.b : box.b - 22);
      context.stroke();
      // ammeter
      context.fillStyle = '#F2F2F3';
      context.font = '800 16px DM Sans, sans-serif';
      context.fillText(`I = ${current.toFixed(2)} A`, sx, by + 6);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [voltage, resistance, closed, current, power]);

  return (
    <div className="chem-grid">
      <div className="panel chem-stage"><canvas ref={canvas} className="chem-canvas" style={{ height: 360 }} onClick={() => setClosed((value) => !value)} /></div>
      <div className="stack">
        <section className="panel">
          <Slider label={t(language, 'Kuchlanish', 'Напряжение', 'Voltage')} value={voltage} min={1} max={24} step={1} unit=" V" onChange={setVoltage} />
          <Slider label={t(language, 'Qarshilik', 'Сопротивление', 'Resistance')} value={resistance} min={1} max={60} step={1} unit=" Ω" onChange={setResistance} />
          <button type="button" className={`btn ${closed ? '' : 'primary'}`} onClick={() => setClosed((value) => !value)}>
            {closed ? t(language, 'Kalitni ochish', 'Разомкнуть ключ', 'Open switch') : t(language, 'Kalitni yopish', 'Замкнуть ключ', 'Close switch')}
          </button>
        </section>
        <section className="panel lab-result">
          <div className="lab-formula">I = U / R · P = U · I</div>
          <div className="lab-value">I = <b>{current.toFixed(2)}</b> A · P = <b>{power.toFixed(1)}</b> W</div>
          <p className="muted">{t(language,
            'Qarshilikni oshiring — tok kamayadi va lampa xiralashadi. Kuchlanishni oshiring — lampa yorqinroq.',
            'Увеличьте сопротивление — ток уменьшится и лампа потускнеет. Увеличьте напряжение — лампа станет ярче.',
            'Raise the resistance — the current drops and the lamp dims. Raise the voltage — it gets brighter.')}</p>
        </section>
      </div>
    </div>
  );
}
