/** Own 3D scenes for physics topics (and the shared lab scenes). */
import { useMemo, useRef, useState } from 'react';
import { Layer, SceneFrame, SceneModes, SceneNote, SceneSlider, Stage3D, useFrame } from './scene-kit';

/* ------------------------------------------------------------------ */
/* Lab: research method, equipment, safety signs                        */
/* ------------------------------------------------------------------ */

const STEPS: Array<[string, string]> = [
  ['Вопрос', 'Замечаем явление и задаём проблемный вопрос: «Почему сахар в горячем чае растворяется быстрее?»'],
  ['Гипотеза', 'Предполагаем ответ, который можно проверить: «Чем выше температура, тем быстрее растворение».'],
  ['Переменные', 'Меняем одну величину (температуру), измеряем другую (время), остальное оставляем одинаковым.'],
  ['Опыт', 'Проводим опыт несколько раз, записываем результаты в таблицу.'],
  ['Вывод', 'Сравниваем результаты с гипотезой: подтвердилась она или нет. Делимся выводом с другими.'],
];
const EQUIPMENT: Array<[string, string, string]> = [
  ['beaker', 'Химический стакан', 'Для жидкостей, растворения и смешивания.'],
  ['flask', 'Колба', 'Для смешивания и нагревания; узкое горло меньше расплёскивает.'],
  ['tube', 'Пробирка', 'Для опытов с малым количеством вещества.'],
  ['cylinder', 'Мерный цилиндр', 'Точно измеряет объём жидкости по шкале.'],
  ['dynamometer', 'Динамометр', 'Измеряет силу в ньютонах благодаря пружине.'],
  ['stopwatch', 'Секундомер', 'Измеряет время: механический ±0,1 s, электронный ±0,01 s.'],
  ['microscope', 'Микроскоп', 'Увеличивает мелкие объекты в сотни раз.'],
  ['burner', 'Спиртовка', 'Нагревает вещества. Гасят колпачком, не задувают.'],
];
const HAZARDS: Array<[string, string, string]> = [
  ['flame', 'Легковоспламеняющееся', 'Бензин, спирт. Хранить вдали от огня и тепла.'],
  ['skull', 'Ядовитое', 'Ртуть, хлор. Не пробовать на вкус, работать в перчатках.'],
  ['bolt', 'Высокое напряжение', 'Не прикасаться к проводам и щитам руками.'],
  ['corrosive', 'Едкое', 'Кислоты и щёлочи. Попало на кожу — смыть большим количеством воды.'],
  ['exclaim', 'Вредное, удушающее', 'Хлороформ, пары брома. Работать в вытяжном шкафу.'],
  ['explosive', 'Взрывоопасное', 'Смесь водорода и воздуха. Не нагревать без указания учителя.'],
];

function EquipmentGlyph({ id }: { id: string }) {
  const s = { fill: 'rgba(143,200,238,.35)', stroke: '#1E3A55', strokeWidth: 2.4, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'beaker': return <svg viewBox="0 0 60 70"><path d="M14 6h32v52a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" {...s} /><path d="M16 36h28v22a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4z" fill="#4BA3DB" opacity=".55" /></svg>;
    case 'flask': return <svg viewBox="0 0 60 70"><path d="M24 4h12v20l16 34a6 6 0 0 1-5 8H13a6 6 0 0 1-5-8l16-34z" {...s} /><path d="M12 52h36l3 7a4 4 0 0 1-4 5H13a4 4 0 0 1-4-5z" fill="#3FA77A" opacity=".6" /></svg>;
    case 'tube': return <svg viewBox="0 0 60 70"><path d="M24 4h12v54a6 6 0 0 1-12 0z" {...s} /><path d="M24 38h12v20a6 6 0 0 1-12 0z" fill="#D2475A" opacity=".55" /></svg>;
    case 'cylinder': return <svg viewBox="0 0 60 70"><path d="M22 4h16v58H22z" {...s} /><path d="M14 62h32v5H14z" fill="#1E3A55" />{[14, 24, 34, 44, 54].map((y) => <path key={y} d={`M22 ${y}h7`} stroke="#1E3A55" strokeWidth="1.6" />)}<path d="M22.5 30h15v31.5h-15z" fill="#4BA3DB" opacity=".5" /></svg>;
    case 'dynamometer': return <svg viewBox="0 0 60 70"><rect x="20" y="4" width="20" height="52" rx="4" {...s} /><path d="M30 10l-5 4 10 4-10 4 10 4-10 4 10 4-5 4" stroke="#B8955A" strokeWidth="2" fill="none" /><path d="M30 56v8M26 64h8" stroke="#1E3A55" strokeWidth="2.4" /></svg>;
    case 'stopwatch': return <svg viewBox="0 0 60 70"><circle cx="30" cy="40" r="22" {...s} /><rect x="26" y="8" width="8" height="8" rx="2" fill="#1E3A55" /><path d="M30 40V24M30 40l9 6" stroke="#D2475A" strokeWidth="2.6" strokeLinecap="round" /></svg>;
    case 'microscope': return <svg viewBox="0 0 60 70"><path d="M14 64h34M22 64c0-10 6-16 14-18" {...s} fill="none" /><rect x="26" y="6" width="10" height="28" rx="3" transform="rotate(-20 31 20)" {...s} /><path d="M20 46h22" stroke="#1E3A55" strokeWidth="3" /></svg>;
    default: return <svg viewBox="0 0 60 70"><path d="M16 40h28l-4 24H20z" {...s} /><path d="M30 40V30" stroke="#1E3A55" strokeWidth="3" /><path d="M30 28c-6-6 2-14 0-22 6 6 8 16 0 22z" fill="#F2A33A" /></svg>;
  }
}

function HazardGlyph({ id }: { id: string }) {
  const g = (() => {
    switch (id) {
      case 'flame': return <path d="M30 46c-9 0-13-7-10-15 2 4 5 5 6 2-1-8 4-14 10-17-3 8 7 12 7 21 0 6-5 9-13 9z" fill="#111" />;
      case 'skull': return <g fill="#111"><circle cx="30" cy="27" r="10" /><rect x="24" y="33" width="12" height="8" rx="2" /><path d="M14 46l32-8M14 38l32 8" stroke="#111" strokeWidth="4" strokeLinecap="round" /></g>;
      case 'bolt': return <path d="M33 12L19 34h10l-4 16 16-24H31z" fill="#111" />;
      case 'corrosive': return <g fill="#111"><path d="M16 22l6-4 3 8-6 4zM36 18l6 4-3 8-6-4z" /><path d="M14 44h32v6H14z" /><circle cx="22" cy="36" r="2.5" /><circle cx="40" cy="34" r="2.5" /></g>;
      case 'exclaim': return <g fill="#111"><rect x="27" y="14" width="6" height="22" rx="3" /><circle cx="30" cy="44" r="3.5" /></g>;
      default: return <g fill="#111"><circle cx="30" cy="32" r="8" /><path d="M30 12v8M30 44v8M12 32h8M40 32h8M17 19l6 6M37 39l6 6M43 19l-6 6M23 39l-6 6" stroke="#111" strokeWidth="3" strokeLinecap="round" /></g>;
    }
  })();
  return <svg viewBox="0 0 60 60"><rect x="12" y="12" width="36" height="36" rx="3" transform="rotate(45 30 30)" fill="#fff" stroke="#D2263A" strokeWidth="4" />{g}</svg>;
}

export function LabScene({ mode = 'method' }: { mode?: string }) {
  const [view, setView] = useState(mode === 'safety' ? 'safety' : mode === 'equipment' ? 'equipment' : 'method');
  const [step, setStep] = useState(0);
  const [item, setItem] = useState(0);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const stage = (
    <Stage3D height={320}>
      {view === 'method' && (
        <Layer>
          <div className="lab-steps">
            {STEPS.map(([title], index) => (
              <button key={title} type="button" data-interactive className={`lab-step ${index === step ? 'on' : ''} ${index < step ? 'done' : ''}`} style={{ transform: `translateZ(${index === step ? 60 : 10}px)` }} onClick={() => setStep(index)}>
                <b>{index + 1}</b><span>{title}</span>
              </button>
            ))}
          </div>
        </Layer>
      )}
      {view === 'equipment' && (
        <Layer>
          <div className="lab-shelf">
            {EQUIPMENT.map(([id, name], index) => (
              <button key={id} type="button" data-interactive className={`lab-item ${index === item ? 'on' : ''}`} style={{ transform: `translateZ(${index === item ? 70 : (index % 2) * 18}px)` }} onClick={() => setItem(index)} aria-label={name}>
                <EquipmentGlyph id={id} />
              </button>
            ))}
          </div>
        </Layer>
      )}
      {view === 'safety' && (
        <Layer>
          <div className="lab-hazards">
            {HAZARDS.map(([id, name, rule]) => (
              <button key={id} type="button" data-interactive className={`hazard-card ${flipped[id] ? 'flipped' : ''}`} onClick={() => setFlipped((value) => ({ ...value, [id]: !value[id] }))} aria-label={name}>
                <span className="hazard-front"><HazardGlyph id={id} /><small>{name}</small></span>
                <span className="hazard-back">{rule}</span>
              </button>
            ))}
          </div>
        </Layer>
      )}
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['method', 'Этапы исследования'], ['equipment', 'Оборудование'], ['safety', 'Знаки опасности']]} />
          {view === 'method' && (<><h3>{step + 1}. {STEPS[step][0]}</h3><SceneNote>{STEPS[step][1]}</SceneNote><button type="button" className="btn" onClick={() => setStep((value) => (value + 1) % STEPS.length)}>{step === STEPS.length - 1 ? 'Сначала' : 'Следующий шаг →'}</button></>)}
          {view === 'equipment' && (<><h3>{EQUIPMENT[item][1]}</h3><SceneNote>{EQUIPMENT[item][2]}</SceneNote></>)}
          {view === 'safety' && <SceneNote>Нажмите на знак, чтобы перевернуть карточку и узнать правило. Проверьте себя: сначала скажите ответ вслух.</SceneNote>}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Measurements: length (parallax), units, area, mass, volume           */
/* ------------------------------------------------------------------ */

const PREFIX: Array<[string, number]> = [['km', 1000], ['m', 1], ['dm', 0.1], ['cm', 0.01], ['mm', 0.001]];

export function MeasureScene({ mode = 'length' }: { mode?: string }) {
  const [view, setView] = useState(['length', 'units', 'area', 'mass', 'volume'].includes(mode) ? mode : 'length');
  const [object, setObject] = useState(7.4);
  const [eye, setEye] = useState(0);
  const [readings, setReadings] = useState<number[]>([]);
  const [value, setValue] = useState(2.5);
  const [unit, setUnit] = useState('km');
  const [a, setA] = useState(6);
  const [b, setB] = useState(4);
  const [target] = useState(() => 150 + Math.round(Math.random() * 30) * 10);
  const [weights, setWeights] = useState<number[]>([]);
  const [stone, setStone] = useState(35);
  const read = Math.round((object + eye * 0.04) * 10) / 10;
  const placed = weights.reduce((sum, w) => sum + w, 0);
  const tilt = Math.max(-14, Math.min(14, (target - placed) / 12));
  const metres = value * (PREFIX.find(([name]) => name === unit)?.[1] ?? 1);
  const stage = (
    <Stage3D height={300}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        {view === 'length' && (
          <svg viewBox="0 0 420 220" className="scene-svg">
            <rect x="20" y="96" width={object * 36} height="18" rx="4" fill="#F2C14E" stroke="#8A6A1E" />
            <path d={`M${20 + object * 36} 96l26 9-26 9z`} fill="#E8B07A" stroke="#8A6A1E" />
            <rect x="20" y="120" width="380" height="44" rx="4" fill="#FFFDF8" stroke="#1E3A55" />
            {Array.from({ length: 101 }, (_, i) => <path key={i} d={`M${20 + i * 3.6} 120v${i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 7}`} stroke="#1E3A55" strokeWidth={i % 10 === 0 ? 1.4 : 0.8} />)}
            {Array.from({ length: 11 }, (_, i) => <text key={i} x={20 + i * 36} y="154" fontSize="11" textAnchor="middle" fill="#1E3A55">{i}</text>)}
            <path d={`M${20 + object * 36 + 26} 70 L${20 + object * 36 + 26 + eye * 1.4} 170`} stroke="#D2475A" strokeDasharray="4 4" />
            <circle cx={20 + object * 36 + 26 + eye * 1.6 * -1} cy="40" r="10" fill="#fff" stroke="#1E3A55" /><circle cx={20 + object * 36 + 26 + eye * -1.6} cy="40" r="4" fill="#1E3A55" />
            <text x="210" y="200" textAnchor="middle" fontSize="13" fill="#1E3A55">Показание: {read.toFixed(1)} cm {eye !== 0 ? '(ошибка параллакса!)' : ''}</text>
          </svg>
        )}
        {view === 'units' && (
          <div className="units-board">
            {PREFIX.map(([name, factor]) => <div key={name} className={name === unit ? 'on' : ''}><b>{(metres / factor).toLocaleString('ru-RU', { maximumFractionDigits: 6 })}</b><span>{name}</span></div>)}
          </div>
        )}
        {view === 'area' && (
          <div className="area-grid" style={{ gridTemplateColumns: `repeat(${a}, 1fr)`, aspectRatio: `${a} / ${b}` }}>
            {Array.from({ length: a * b }, (_, i) => <i key={i} style={{ animationDelay: `${(i % a) * 25 + Math.floor(i / a) * 25}ms` }} />)}
          </div>
        )}
        {view === 'mass' && (
          <svg viewBox="0 0 420 230" className="scene-svg">
            <path d="M210 200V70M170 210h80" stroke="#5B4A2E" strokeWidth="8" strokeLinecap="round" />
            <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '210px 70px', transition: 'transform .9s cubic-bezier(.34,1.4,.64,1)' }}>
              <path d="M80 70h260" stroke="#B8955A" strokeWidth="7" strokeLinecap="round" />
              <path d="M80 70v50M340 70v50" stroke="#8A7350" strokeWidth="2" />
              <path d="M45 120h70l-10 14H55z" fill="#C9B48A" /><path d="M305 120h70l-10 14h-50z" fill="#C9B48A" />
              <rect x="62" y="92" width="36" height="28" rx="6" fill="#4BA3DB" /><text x="80" y="111" fontSize="11" textAnchor="middle" fill="#fff">?</text>
              {weights.map((w, i) => <rect key={i} x={312 + (i % 4) * 14} y={108 - Math.floor(i / 4) * 12} width="12" height={w >= 50 ? 12 : 8} rx="2" fill="#7A6A4A" />)}
            </g>
            <circle cx="210" cy="70" r="7" fill="#5B4A2E" />
            <text x="210" y="28" textAnchor="middle" fontSize="13" fill="#1E3A55">{placed === target ? '✓ Равновесие!' : placed < target ? 'Тело тяжелее гирь' : 'Гири тяжелее тела'}</text>
          </svg>
        )}
        {view === 'volume' && (
          <svg viewBox="0 0 420 230" className="scene-svg">
            <rect x="170" y="20" width="80" height="190" rx="6" fill="rgba(143,200,238,.18)" stroke="#1E3A55" strokeWidth="2" />
            {Array.from({ length: 11 }, (_, i) => <g key={i}><path d={`M170 ${200 - i * 17}h${i % 2 ? 10 : 18}`} stroke="#1E3A55" /><text x="256" y={204 - i * 17} fontSize="10" fill="#1E3A55">{i * 20}</text></g>)}
            <rect x="172" y={200 - (120 + stone) * 0.85} width="76" height={(120 + stone) * 0.85 + 8} fill="#4BA3DB" opacity=".55" style={{ transition: 'y .8s cubic-bezier(.34,1.3,.64,1), height .8s cubic-bezier(.34,1.3,.64,1)' }} />
            <ellipse cx="210" cy={196 - Math.sqrt(stone) * 2} rx={8 + Math.sqrt(stone) * 2.2} ry={6 + Math.sqrt(stone) * 1.8} fill="#7D756A" />
            <text x="60" y="110" fontSize="13" fill="#1E3A55">Было: 120 ml</text><text x="60" y="130" fontSize="13" fill="#1E3A55">Стало: {120 + stone} ml</text>
          </svg>
        )}
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['length', 'Длина'], ['units', 'Единицы СИ'], ['area', 'Площадь'], ['mass', 'Масса'], ['volume', 'Объём']]} />
          {view === 'length' && (<>
            <SceneSlider label="Взгляд сбоку" value={eye} min={-10} max={10} unit="" onChange={setEye} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn small" onClick={() => setReadings((list) => [...list.slice(-5), Math.round((object + (Math.random() - 0.5) * 0.2) * 10) / 10])}>Измерить</button>
              <button type="button" className="btn small" onClick={() => { setObject(Math.round((3 + Math.random() * 6) * 10) / 10); setReadings([]); }}>Новый предмет</button>
            </div>
            <SceneNote>Цена деления 1 mm, погрешность ±0,5 mm. {readings.length ? `Измерения: ${readings.join('; ')} → среднее ${(readings.reduce((s, r) => s + r, 0) / readings.length).toFixed(2)} cm.` : 'Нажмите «Измерить» несколько раз и найдите среднее.'}</SceneNote>
          </>)}
          {view === 'units' && (<>
            <SceneSlider label="Значение" value={value} min={0.1} max={10} step={0.1} unit={` ${unit}`} onChange={setValue} />
            <SceneModes value={unit} onChange={setUnit} options={PREFIX.map(([name]) => [name, name])} />
            <SceneNote>кило = ×1000, деци = ×0,1, санти = ×0,01, милли = ×0,001. Одна и та же длина — разные числа.</SceneNote>
          </>)}
          {view === 'area' && (<>
            <SceneSlider label="Длина a" value={a} min={1} max={12} unit=" m" onChange={setA} />
            <SceneSlider label="Ширина b" value={b} min={1} max={8} unit=" m" onChange={setB} />
            <SceneNote>S = a · b = {a} · {b} = <b>{a * b} m²</b> — столько квадратиков 1 × 1 m поместилось.</SceneNote>
          </>)}
          {view === 'mass' && (<>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {[100, 50, 20, 10].map((w) => <button key={w} type="button" className="btn small" onClick={() => setWeights((list) => [...list, w])}>+{w} g</button>)}
              <button type="button" className="btn small" onClick={() => setWeights((list) => list.slice(0, -1))}>Снять</button>
            </div>
            <SceneNote>На правой чаше {placed} g. Подберите гири до равновесия — так работают рычажные весы.</SceneNote>
          </>)}
          {view === 'volume' && (<>
            <SceneSlider label="Объём камня" value={stone} min={5} max={60} unit=" cm³" onChange={setStone} />
            <SceneNote>Объём тела = подъём уровня воды: {120 + stone} − 120 = <b>{stone} ml = {stone} cm³</b>.</SceneNote>
          </>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Motion: speed, distance-time graph, relative motion                  */
/* ------------------------------------------------------------------ */

export function MotionScene({ mode = 'speed' }: { mode?: string }) {
  const [view, setView] = useState(['speed', 'graph', 'relative'].includes(mode) ? mode : 'speed');
  const [speed, setSpeed] = useState(54);
  const [moving, setMoving] = useState(true);
  const [frame, setFrame] = useState<'road' | 'bus'>('road');
  const sim = useRef({ x: 0, t: 0, points: [[0, 0]] as Array<[number, number]> });
  const [, tick] = useState(0);
  const host = useFrame((dt) => {
    const s = sim.current;
    const v = moving ? speed / 3.6 : 0;
    s.t += dt;
    s.x += v * dt;
    if (view === 'graph') {
      s.points.push([s.t, s.x]);
      if (s.t > 20) { s.t = 0; s.x = 0; s.points = [[0, 0]]; }
    } else if (s.x > 200) s.x = 0;
    tick((n) => (n + 1) % 1000000);
  });
  const s = sim.current;
  const maxX = Math.max(60, ...s.points.map(([, x]) => x));
  const carX = view === 'relative' && frame === 'bus' ? 190 : 20 + (s.x % 200) * 1.9;
  const scenery = view === 'relative' && frame === 'bus' ? -((s.x * 1.9) % 400) : 0;
  const stage = (
    <Stage3D height={300} rest={{ x: 18, y: -10 }}>
      <Layer z={-40}><svg viewBox="0 0 420 220" className="scene-svg"><g transform={`translate(${scenery} 0)`}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <g key={i} transform={`translate(${i * 110} 0)`}><rect x="10" y="70" width="46" height="62" fill="#E8DCC4" /><path d="M6 72l27-24 27 24z" fill="#C97B5A" /><circle cx="86" cy="104" r="20" fill="#8DBB9F" /><rect x="84" y="116" width="5" height="20" fill="#6B5B3E" /></g>)}</g></svg></Layer>
      <Layer>
        <svg viewBox="0 0 420 220" className="scene-svg">
          <rect x="0" y="136" width="420" height="40" fill="#5E6470" /><path d="M0 156h420" stroke="#fff" strokeDasharray="16 14" strokeWidth="3" />
          <g transform={`translate(${carX} 104)`}>
            <rect x="0" y="10" width={view === 'relative' ? 120 : 64} height="24" rx="6" fill={view === 'relative' ? '#D2B26E' : '#4BA3DB'} />
            <rect x="12" y="0" width={view === 'relative' ? 90 : 34} height="14" rx="4" fill="#CFE8F8" />
            {view === 'relative' && <circle cx="58" cy="6" r="5" fill="#1E3A55" />}
            <circle cx="14" cy="36" r="7" fill="#1E2633" /><circle cx={view === 'relative' ? 104 : 50} cy="36" r="7" fill="#1E2633" />
          </g>
        </svg>
      </Layer>
      {view === 'graph' && (
        <Layer z={40} className="graph-layer">
          <svg viewBox="0 0 200 120" className="mini-graph">
            <path d="M24 100H192M24 100V8" stroke="#1E3A55" strokeWidth="1.2" />
            <text x="190" y="114" fontSize="8" textAnchor="end">t, s</text><text x="6" y="12" fontSize="8">s, m</text>
            <polyline fill="none" stroke="#D2475A" strokeWidth="2" points={s.points.map(([t, x]) => `${24 + t * 8.4},${100 - (x / maxX) * 88}`).join(' ')} />
          </svg>
        </Layer>
      )}
    </Stage3D>
  );
  const v = speed / 3.6;
  return (
    <div ref={host}>
      <SceneFrame
        stage={stage}
        controls={(
          <section className="panel">
            <SceneModes value={view} onChange={(next) => { setView(next); sim.current = { x: 0, t: 0, points: [[0, 0]] }; }} options={[['speed', 'Скорость'], ['graph', 'График пути'], ['relative', 'Относительность']]} />
            <SceneSlider label="Скорость" value={speed} min={0} max={120} step={6} unit=" km/h" onChange={setSpeed} />
            {view !== 'relative' && <button type="button" className="btn small" onClick={() => setMoving((m) => !m)}>{moving ? 'Остановиться' : 'Поехать'}</button>}
            {view === 'relative' && <SceneModes value={frame} onChange={(value) => setFrame(value as 'road' | 'bus')} options={[['road', 'Смотрим с дороги'], ['bus', 'Смотрим из автобуса']]} />}
            <SceneNote>
              {view === 'speed' && <>v = {speed} km/h = {speed} : 3,6 = <b>{v.toFixed(1)} m/s</b>. За 10 s машина проедет s = v·t = <b>{(v * 10).toFixed(0)} m</b>.</>}
              {view === 'graph' && <>Чем круче линия, тем больше скорость. Остановитесь — линия станет горизонтальной. Сейчас s = {s.x.toFixed(0)} m за {s.t.toFixed(1)} s.</>}
              {view === 'relative' && (frame === 'road' ? 'С дороги: автобус и пассажир движутся, дома стоят.' : 'Из автобуса: пассажир неподвижен, а дома «уезжают» назад. Движение относительно!')}
            </SceneNote>
          </section>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forces: arrows (resultant), spring, friction, air, work and power     */
/* ------------------------------------------------------------------ */

export function ForcesScene({ mode = 'arrows' }: { mode?: string }) {
  const [view, setView] = useState(['arrows', 'spring', 'friction', 'air', 'work'].includes(mode) ? mode : 'arrows');
  const [f1, setF1] = useState(30);
  const [f2, setF2] = useState(-20);
  const [k, setK] = useState(50);
  const [mass, setMass] = useState(0.4);
  const [pull, setPull] = useState(2);
  const [mu, setMu] = useState(0.3);
  const [air, setAir] = useState(true);
  const [dist, setDist] = useState(4);
  const [time, setTime] = useState(8);
  const [force, setForce] = useState(50);
  const sim = useRef({ x: 0, v: 0, y: 0, vy: 0, ball: 0, paper: 0, vb: 0, vp: 0, t: 0 });
  const [, tick] = useState(0);
  const weight = mass * 9.8;
  const stretch = weight / k;
  const frictionMax = mu * 10; // block 1 kg → N = 10 N
  const host = useFrame((dt) => {
    const s = sim.current;
    s.t += dt;
    if (view === 'arrows') {
      s.v += ((f1 + f2) / 20) * dt; s.x += s.v * dt;
      if (Math.abs(s.x) > 7) { s.x = 0; s.v = 0; }
    } else if (view === 'spring') {
      // real mass–spring motion (semi-implicit Euler) with light damping
      s.vy += ((k / mass) * (stretch - s.y) - 1.8 * s.vy) * dt; s.y += s.vy * dt;
    } else if (view === 'friction') {
      const net = pull > frictionMax ? pull - frictionMax * 0.9 : 0;
      s.v = net > 0 ? s.v + net * dt : Math.max(0, s.v - 6 * dt); s.x += s.v * dt;
      if (s.x > 6) s.x = 0;
    } else if (view === 'air') {
      const drag = (v: number, area: number) => (air ? area * v * Math.abs(v) : 0);
      s.vb += (9.8 - drag(s.vb, 0.02)) * dt; s.vp += (9.8 - drag(s.vp, 1.6)) * dt;
      s.ball = Math.min(10, s.ball + s.vb * dt); s.paper = Math.min(10, s.paper + s.vp * dt);
      if (s.ball >= 10 && s.paper >= 10) { s.ball = 0; s.paper = 0; s.vb = 0; s.vp = 0; }
    } else if (view === 'work') {
      s.x += (dist / time) * dt; if (s.x > dist) s.x = 0;
    }
    tick((n) => (n + 1) % 1000000);
  });
  const s = sim.current;
  const resultant = f1 + f2;
  const arrow = (x: number, y: number, value: number, color: string, label: string) => value === 0 ? null : (
    <g><path d={`M${x} ${y}h${value * 2.4}`} stroke={color} strokeWidth="5" strokeLinecap="round" /><path d={`M${x + value * 2.4} ${y}l${-Math.sign(value) * 10} -7v14z`} fill={color} /><text x={x + value * 1.2} y={y - 10} fontSize="12" textAnchor="middle" fill={color}>{label}</text></g>
  );
  const stage = (
    <Stage3D height={310}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 230" className="scene-svg">
          {view === 'arrows' && (<g>
            <rect x="0" y="170" width="420" height="10" fill="#C9B48A" />
            <g transform={`translate(${190 + s.x * 22} 0)`}><rect x="-30" y="128" width="60" height="36" rx="6" fill="#4BA3DB" /><circle cx="-16" cy="168" r="7" fill="#1E2633" /><circle cx="16" cy="168" r="7" fill="#1E2633" />
              {arrow(0, 110, f1, '#2E9E6E', `F₁ = ${Math.abs(f1)} N`)}{arrow(0, 90, f2, '#D2475A', `F₂ = ${Math.abs(f2)} N`)}{arrow(0, 60, resultant, '#B8955A', `R = ${Math.abs(resultant)} N`)}</g>
          </g>)}
          {view === 'spring' && (<g>
            <rect x="150" y="10" width="120" height="10" fill="#5B4A2E" />
            {(() => { const ext = Math.max(0, Math.min(120, s.y * 90)); return (<>
              <path d={`M210 20 ${Array.from({ length: 14 }, (_, i) => `L${i % 2 ? 196 : 224} ${26 + (i + 1) * (60 + ext) / 15}`).join(' ')} L210 ${30 + 60 + ext}`} fill="none" stroke="#1E3A55" strokeWidth="2.4" />
              <rect x="186" y={30 + 60 + ext} width="48" height={20 + mass * 20} rx="5" fill="#B8955A" />
              <text x="250" y={50 + 60 + ext} fontSize="12" fill="#1E3A55">{mass.toFixed(1)} kg</text>
            </>); })()}
            <text x="300" y="214" fontSize="12" fill="#1E3A55">Δl = {(stretch * 100).toFixed(1)} cm</text>
          </g>)}
          {view === 'friction' && (<g>
            <rect x="0" y="160" width="420" height="16" fill={mu < 0.1 ? '#CFE8F8' : mu > 0.6 ? '#3A3A42' : '#C9A26E'} />
            <g transform={`translate(${60 + s.x * 45} 0)`}><rect x="0" y="118" width="70" height="42" rx="4" fill="#4BA3DB" />
              <path d="M70 139h30" stroke="#1E3A55" strokeWidth="2" /><rect x="100" y="132" width="44" height="14" rx="4" fill="#fff" stroke="#1E3A55" /><text x="122" y="143" fontSize="9" textAnchor="middle">{Math.min(pull, frictionMax).toFixed(1)} N</text>
              {arrow(150, 112, pull * 6, '#2E9E6E', 'F тяги')}{arrow(0, 100, -Math.min(pull, frictionMax) * 6, '#D2475A', 'F трения')}</g>
          </g>)}
          {view === 'air' && (<g>
            <path d="M80 20V210M300 20V210" stroke="#1E3A55" strokeDasharray="3 5" opacity=".4" />
            <circle cx="80" cy={24 + s.ball * 18} r="12" fill="#4F5867" />
            <g transform={`translate(300 ${24 + s.paper * 18}) rotate(${Math.sin(s.t * 6) * 18 * (air ? 1 : 0)})`}><rect x="-22" y="-3" width="44" height="6" fill="#FFFDF8" stroke="#1E3A55" /></g>
            <text x="80" y="226" fontSize="11" textAnchor="middle">шар</text><text x="300" y="226" fontSize="11" textAnchor="middle">лист</text>
            <text x="190" y="20" fontSize="12" textAnchor="middle" fill="#1E3A55">{air ? 'В воздухе' : 'В вакууме'}</text>
          </g>)}
          {view === 'work' && (<g>
            <rect x="0" y="170" width="420" height="10" fill="#C9B48A" />
            <path d={`M40 196h${dist * 80}`} stroke="#B8955A" strokeWidth="3" /><text x={40 + dist * 40} y="214" fontSize="11" textAnchor="middle">s = {dist} m</text>
            <g transform={`translate(${40 + s.x * 80} 0)`}><rect x="-26" y="124" width="52" height="46" rx="4" fill="#C9A26E" stroke="#8A6A1E" />{arrow(26, 140, force / 4, '#2E9E6E', `F = ${force} N`)}</g>
          </g>)}
        </svg>
      </Layer>
    </Stage3D>
  );
  return (
    <div ref={host}>
      <SceneFrame
        stage={stage}
        controls={(
          <section className="panel">
            <SceneModes value={view} onChange={(next) => { setView(next); sim.current = { x: 0, v: 0, y: 0, vy: 0, ball: 0, paper: 0, vb: 0, vp: 0, t: 0 }; }} options={[['arrows', 'Сложение сил'], ['spring', 'Пружина'], ['friction', 'Трение'], ['air', 'Воздух'], ['work', 'Работа']]} />
            {view === 'arrows' && (<><SceneSlider label="F₁ (вправо +)" value={f1} min={-50} max={50} step={5} unit=" N" onChange={setF1} /><SceneSlider label="F₂ (вправо +)" value={f2} min={-50} max={50} step={5} unit=" N" onChange={setF2} /><SceneNote>Равнодействующая R = F₁ + F₂ = <b>{resultant} N</b>. {resultant === 0 ? 'Силы уравновешены — скорость не меняется.' : 'Тележка разгоняется в сторону R.'}</SceneNote></>)}
            {view === 'spring' && (<><SceneSlider label="Жёсткость k" value={k} min={10} max={200} step={10} unit=" N/m" onChange={setK} /><SceneSlider label="Масса груза" value={mass} min={0.1} max={1.5} step={0.1} unit=" kg" onChange={setMass} /><SceneNote>Закон Гука: Δl = F / k = {weight.toFixed(1)} / {k} = <b>{(stretch * 100).toFixed(1)} cm</b>. Пружина не останавливается — груз качается и успокаивается.</SceneNote></>)}
            {view === 'friction' && (<><SceneSlider label="Сила тяги" value={pull} min={0} max={8} step={0.2} unit=" N" onChange={setPull} /><SceneModes value={String(mu)} onChange={(value) => setMu(Number(value))} options={[['0.05', 'Лёд'], ['0.3', 'Дерево'], ['0.8', 'Резина']]} /><SceneNote>Максимальная сила трения покоя μ·N = {mu} · 10 = <b>{frictionMax.toFixed(1)} N</b>. {pull > frictionMax ? 'Тяга больше — брусок едет.' : 'Тяги не хватает — брусок стоит.'}</SceneNote></>)}
            {view === 'air' && (<><button type="button" className="btn small" onClick={() => { setAir((value) => !value); sim.current = { ...sim.current, ball: 0, paper: 0, vb: 0, vp: 0 }; }}>{air ? 'Откачать воздух' : 'Вернуть воздух'}</button><SceneNote>{air ? 'У листа большая площадь — сопротивление воздуха тормозит его.' : 'Без воздуха шар и лист падают одинаково — как перо и молоток на Луне.'}</SceneNote></>)}
            {view === 'work' && (<><SceneSlider label="Сила" value={force} min={10} max={200} step={10} unit=" N" onChange={setForce} /><SceneSlider label="Путь" value={dist} min={1} max={4} step={0.5} unit=" m" onChange={setDist} /><SceneSlider label="Время" value={time} min={1} max={20} unit=" s" onChange={setTime} /><SceneNote>A = F·s = <b>{force * dist} J</b>; мощность N = A / t = <b>{((force * dist) / time).toFixed(1)} W</b>.</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Space: Solar System, Moon phases, scale of the Universe              */
/* ------------------------------------------------------------------ */

const PLANETS: Array<[string, number, number, string, number]> = [
  // name, orbit radius (px), period (Earth years), colour, size
  ['Меркурий', 34, 0.24, '#A69F95', 3], ['Венера', 48, 0.62, '#E8C27A', 5], ['Земля', 64, 1, '#4BA3DB', 5.4], ['Марс', 80, 1.88, '#D2694A', 4],
  ['Юпитер', 108, 11.9, '#D9B38C', 11], ['Сатурн', 134, 29.5, '#E6D29A', 9.5], ['Уран', 156, 84, '#9FD6E0', 7], ['Нептун', 176, 165, '#5A7FD9', 7],
];

export function SolarScene({ mode = 'system' }: { mode?: string }) {
  const [view, setView] = useState(['system', 'moon', 'stars'].includes(mode) ? mode : 'system');
  const [speed, setSpeed] = useState(1);
  const [geo, setGeo] = useState(false);
  const [day, setDay] = useState(7);
  const [zoom, setZoom] = useState(0);
  const sim = useRef({ years: 0 });
  const [, tick] = useState(0);
  const host = useFrame((dt) => { if (view === 'system') { sim.current.years += dt * speed * 0.25; tick((n) => (n + 1) % 1000000); } });
  const years = sim.current.years;
  const stars = useMemo(() => Array.from({ length: 160 }, (_, i) => [((i * 97) % 400) + 10, ((i * 53) % 220) + 5, (i % 5) / 4 + 0.4] as const), []);
  const moonAngle = (day / 29.5) * Math.PI * 2;
  const lit = (1 - Math.cos(moonAngle)) / 2; // 0 new → 1 full
  const phaseName = day < 1.5 || day > 28 ? 'Новолуние' : day < 6.5 ? 'Растущий серп' : day < 8.5 ? 'Первая четверть' : day < 13.5 ? 'Растущая Луна' : day < 16 ? 'Полнолуние' : day < 21.5 ? 'Убывающая Луна' : day < 23.5 ? 'Последняя четверть' : 'Убывающий серп';
  const levels = ['Солнечная система', 'Ближайшие звёзды', 'Галактика Млечный Путь', 'Скопления галактик'];
  const stage = (
    <Stage3D height={320} rest={{ x: view === 'system' ? 50 : 10, y: -10 }} className="space-stage">
      <Layer z={-60}><svg viewBox="0 0 420 230" className="scene-svg">{stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity=".7" />)}</svg></Layer>
      <Layer>
        {view === 'system' && (
          <svg viewBox="-210 -115 420 230" className="scene-svg">
            {PLANETS.map(([name, r]) => <ellipse key={name} cx="0" cy="0" rx={r} ry={r * 0.62} fill="none" stroke="rgba(255,255,255,.18)" />)}
            {(() => {
              const earth = PLANETS[2];
              const ea = (years / earth[2]) * Math.PI * 2;
              const ex = Math.cos(ea) * earth[1], ey = Math.sin(ea) * earth[1] * 0.62;
              const cx = geo ? -ex : 0, cy = geo ? -ey : 0;
              return (<g transform={`translate(${cx} ${cy})`}>
                <circle cx="0" cy="0" r="14" fill="#FFC94A" /><circle cx="0" cy="0" r="22" fill="#FFC94A" opacity=".15" />
                {PLANETS.map(([name, r, period, color, size]) => { const angle = (years / period) * Math.PI * 2; return <g key={name}><circle cx={Math.cos(angle) * r} cy={Math.sin(angle) * r * 0.62} r={size / 1.6} fill={color} />{name === 'Сатурн' && <ellipse cx={Math.cos(angle) * r} cy={Math.sin(angle) * r * 0.62} rx="9" ry="3" fill="none" stroke="#E6D29A" />}</g>; })}
              </g>);
            })()}
          </svg>
        )}
        {view === 'moon' && (
          <svg viewBox="-210 -115 420 230" className="scene-svg">
            <defs><linearGradient id="sunlight" x1="0" x2="1"><stop offset="0" stopColor="#FFE9A8" stopOpacity=".5" /><stop offset="1" stopColor="#FFE9A8" stopOpacity="0" /></linearGradient></defs>
            <rect x="-210" y="-115" width="120" height="230" fill="url(#sunlight)" /><text x="-200" y="-96" fontSize="11" fill="#FFE9A8">☀ Солнце</text>
            <circle cx="-20" cy="0" r="80" fill="none" stroke="rgba(255,255,255,.2)" strokeDasharray="3 5" />
            <circle cx="-20" cy="0" r="20" fill="#4BA3DB" /><path d="M-20 -20a20 20 0 0 1 0 40z" fill="#0B1424" opacity=".55" />
            <g transform={`translate(${-20 - Math.cos(moonAngle) * 80} ${-Math.sin(moonAngle) * 80})`}><circle r="9" fill="#D9D6CE" /><path d="M0 -9a9 9 0 0 1 0 18z" fill="#0B1424" opacity=".7" /></g>
            <g transform="translate(150 0)">
              <circle r="38" fill="#2A2E38" />
              <path d={`M0 -38 A38 38 0 0 ${day < 14.75 ? 1 : 0} 0 38 A${Math.abs(38 * (1 - 2 * lit))} 38 0 0 ${(day < 14.75) === (lit < 0.5) ? 0 : 1} 0 -38`} fill="#ECE8DD" />
              <text y="56" fontSize="11" textAnchor="middle" fill="#fff">Вид с Земли</text>
            </g>
          </svg>
        )}
        {view === 'stars' && (
          <svg viewBox="-210 -115 420 230" className="scene-svg">
            {zoom === 0 && <g><circle r="8" fill="#FFC94A" />{PLANETS.slice(0, 6).map(([name, r, , color]) => <circle key={name} cx={r * 0.9} cy="0" r="2.5" fill={color} />)}</g>}
            {zoom === 1 && <g><circle r="5" fill="#FFC94A" /><text x="8" y="4" fontSize="9" fill="#fff">Солнце</text><circle cx="90" cy="-30" r="3" fill="#FF8A6A" /><text x="96" y="-27" fontSize="9" fill="#fff">Проксима, 4,2 св. года</text><circle cx="-120" cy="40" r="4" fill="#CFE8F8" /><text x="-114" y="44" fontSize="9" fill="#fff">Сириус, 8,6 св. года</text></g>}
            {zoom === 2 && <g>{Array.from({ length: 420 }, (_, i) => { const a = i * 0.21, r = 6 + (i % 140); return <circle key={i} cx={Math.cos(a + r / 40) * r * 1.3} cy={Math.sin(a + r / 40) * r * 0.5} r=".9" fill="#E8DCC4" opacity=".75" />; })}<circle cx="70" cy="10" r="3" fill="#FFC94A" /><text x="76" y="14" fontSize="9" fill="#FFC94A">мы здесь</text></g>}
            {zoom === 3 && <g>{Array.from({ length: 60 }, (_, i) => <ellipse key={i} cx={((i * 67) % 380) - 190} cy={((i * 41) % 200) - 100} rx={3 + (i % 4)} ry={1.5 + (i % 3)} fill="#E8DCC4" opacity=".6" transform={`rotate(${i * 23} ${((i * 67) % 380) - 190} ${((i * 41) % 200) - 100})`} />)}</g>}
          </svg>
        )}
      </Layer>
    </Stage3D>
  );
  return (
    <div ref={host}>
      <SceneFrame
        stage={stage}
        controls={(
          <section className="panel">
            <SceneModes value={view} onChange={setView} options={[['system', 'Планеты'], ['moon', 'Фазы Луны'], ['stars', 'Масштаб Вселенной']]} />
            {view === 'system' && (<><SceneSlider label="Скорость времени" value={speed} min={0.2} max={8} step={0.2} unit="×" onChange={setSpeed} /><SceneModes value={geo ? 'geo' : 'helio'} onChange={(value) => setGeo(value === 'geo')} options={[['helio', 'В центре Солнце (Коперник)'], ['geo', 'В центре Земля (Птолемей)']]} /><SceneNote>Прошло {years.toFixed(1)} земных лет. Меркурий обегает Солнце за 88 суток, Нептун — за 165 лет.</SceneNote></>)}
            {view === 'moon' && (<><SceneSlider label="День лунного месяца" value={day} min={0} max={29.5} step={0.5} unit="" onChange={setDay} /><SceneNote><b>{phaseName}</b>. Солнце всегда освещает половину Луны, а мы видим разную часть освещённой стороны.</SceneNote></>)}
            {view === 'stars' && (<><SceneSlider label="Масштаб" value={zoom} min={0} max={3} unit="" onChange={setZoom} /><SceneNote><b>{levels[zoom]}</b>. {zoom === 0 ? 'Свет от Солнца до Земли — 8 минут.' : zoom === 1 ? 'До ближайшей звезды свет идёт 4,2 года.' : zoom === 2 ? 'В Млечном Пути 100–400 миллиардов звёзд.' : 'Во Вселенной миллиарды галактик.'}</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}
