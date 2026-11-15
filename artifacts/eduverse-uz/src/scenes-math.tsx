/** Own 3D scenes for mathematics topics. */
import { useMemo, useRef, useState } from 'react';
import { Layer, SceneFrame, SceneModes, SceneNote, SceneSlider, Stage3D, useFrame } from './scene-kit';

const primeFactors = (n: number) => { const out: number[] = []; let x = n; for (let p = 2; p * p <= x; p += 1) while (x % p === 0) { out.push(p); x /= p; } if (x > 1) out.push(x); return out; };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const powers = (list: number[]) => { const map = new Map<number, number>(); list.forEach((p) => map.set(p, (map.get(p) ?? 0) + 1)); return [...map.entries()].map(([p, k]) => (k > 1 ? `${p}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[k] ?? `^${k}`}` : `${p}`)).join(' · '); };

/* ------------------------------------------------------------------ */
/* Factors: factor tree, GCD, LCM (buses)                               */
/* ------------------------------------------------------------------ */

function FactorTree({ n, x, highlight }: { n: number; x: number; highlight: number[] }) {
  const nodes: Array<{ value: number; x: number; y: number; prime: boolean; parent?: [number, number] }> = [];
  let value = n, cx = x, y = 26;
  const pool = [...highlight];
  while (value > 1) {
    const p = primeFactors(value)[0];
    if (p === value) { nodes.push({ value, x: cx, y, prime: true }); break; }
    nodes.push({ value, x: cx, y, prime: false });
    nodes.push({ value: p, x: cx - 26, y: y + 32, prime: true, parent: [cx, y] });
    value /= p; nodes.push({ value, x: cx + 26, y: y + 32, prime: primeFactors(value).length === 1, parent: [cx, y] });
    nodes.pop(); cx += 26; y += 32;
    if (y > 200) break;
  }
  return (
    <g>
      {nodes.map((node, i) => node.parent ? <path key={`l${i}`} d={`M${node.parent[0]} ${node.parent[1] + 9}L${node.x} ${node.y - 9}`} stroke="#B8955A" strokeWidth="1.5" /> : null)}
      {nodes.map((node, i) => {
        const used = node.prime && pool.includes(node.value) && (pool.splice(pool.indexOf(node.value), 1), true);
        return <g key={i}><circle cx={node.x} cy={node.y} r="12" fill={node.prime ? (used ? '#F2C14E' : '#FFFDF8') : '#CFE8F8'} stroke="#1E3A55" /><text x={node.x} y={node.y + 4} fontSize={node.value > 99 ? 8 : 10} textAnchor="middle">{node.value}</text></g>;
      })}
    </g>
  );
}

export function FactorsScene({ mode = 'gcd' }: { mode?: string }) {
  const [view, setView] = useState(['gcd', 'lcm', 'primes'].includes(mode) ? mode : 'gcd');
  const [a, setA] = useState(72);
  const [b, setB] = useState(96);
  const [buses, setBuses] = useState<[number, number, number]>([20, 30, 45]);
  const fa = primeFactors(a), fb = primeFactors(b);
  const common: number[] = []; const rest = [...fb]; fa.forEach((p) => { const i = rest.indexOf(p); if (i >= 0) { common.push(p); rest.splice(i, 1); } });
  const g = gcd(a, b);
  const lcm3 = buses.reduce((acc, value) => (acc * value) / gcd(acc, value), 1);
  const sim = useRef({ t: 0 });
  const [, tick] = useState(0);
  const host = useFrame((dt) => { if (view === 'lcm') { sim.current.t = (sim.current.t + dt * 30) % (lcm3 + 30); tick((n) => (n + 1) % 1000000); } });
  const minutes = Math.floor(sim.current.t);
  const at = (period: number) => minutes % period < 4;
  const stage = (
    <Stage3D height={310}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 240" className="scene-svg">
          {view !== 'lcm' && (<g><FactorTree n={a} x={110} highlight={view === 'gcd' ? common : []} /><FactorTree n={b} x={290} highlight={view === 'gcd' ? common : []} /></g>)}
          {view === 'lcm' && (<g>
            <rect x="0" y="150" width="420" height="40" fill="#5E6470" /><rect x="180" y="110" width="60" height="40" rx="4" fill="#FFFDF8" stroke="#B8955A" /><text x="210" y="134" fontSize="10" textAnchor="middle">Остановка</text>
            {buses.map((period, i) => <g key={period + i} transform={`translate(${at(period) ? 120 + i * 60 : 20 + i * 140} ${158 + (i % 2) * 2})`} style={{ transition: 'transform .5s cubic-bezier(.34,1.3,.64,1)' }}><rect width="54" height="24" rx="5" fill={['#4BA3DB', '#D2B26E', '#3FA77A'][i]} /><text x="27" y="16" fontSize="10" textAnchor="middle" fill="#fff">{'ABC'[i]} · {period}</text></g>)}
            <text x="210" y="40" fontSize="16" textAnchor="middle" fill="#1E3A55">{String(8 + Math.floor((30 + minutes) / 60)).padStart(2, '0')}:{String((30 + minutes) % 60).padStart(2, '0')}</text>
            {buses.every((period) => at(period)) && <text x="210" y="70" fontSize="13" textAnchor="middle" fill="#2E9E6E">Все три встретились!</text>}
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
            <SceneModes value={view} onChange={setView} options={[['gcd', 'НОД'], ['primes', 'Разложение'], ['lcm', 'НОК: автобусы']]} />
            {view !== 'lcm' && (<><SceneSlider label="Первое число" value={a} min={4} max={200} unit="" onChange={setA} /><SceneSlider label="Второе число" value={b} min={4} max={200} unit="" onChange={setB} />
              <SceneNote>{a} = {powers(fa)}; {b} = {powers(fb)}.{view === 'gcd' ? <> Общие множители (жёлтые): {common.length ? common.join(' · ') : 'нет'} → <b>НОД = {g}</b>, НОК = {(a * b) / g}.</> : ' Делим на наименьшее простое число, пока не останутся только простые.'}</SceneNote></>)}
            {view === 'lcm' && (<>{buses.map((period, i) => <SceneSlider key={i} label={`Автобус ${'ABC'[i]}: каждые`} value={period} min={5} max={60} step={5} unit=" min" onChange={(value) => setBuses((list) => list.map((p, j) => (j === i ? value : p)) as [number, number, number])} />)}<SceneNote>Встретились в 08:30. Снова встретятся через НОК({buses.join(', ')}) = <b>{lcm3} min</b>.</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Number line: integers, addition, multiplication, reals, rounding      */
/* ------------------------------------------------------------------ */

export function NumberLineScene({ mode = 'integers' }: { mode?: string }) {
  const [view, setView] = useState(['integers', 'add', 'multiply', 'real', 'rounding', 'estimate'].includes(mode) ? mode : 'integers');
  const [x, setX] = useState(-3);
  const [y, setY] = useState(5);
  const [value, setValue] = useState(4.37);
  const [place, setPlace] = useState(1);
  const range = view === 'rounding' || view === 'estimate' ? [0, 10] : [-12, 12];
  const px = (n: number) => 30 + ((n - range[0]) / (range[1] - range[0])) * 360;
  const sum = view === 'multiply' ? x * y : x + y;
  const step = 10 ** -place;
  const rounded = Math.round(value / step) * step;
  const reals: Array<[string, number]> = [['−π', -Math.PI], ['−√1331 = −11', -11], ['−8/3', -8 / 3], ['√2', Math.SQRT2], ['2/3', 2 / 3], ['π + 1', Math.PI + 1]];
  const ticks = useMemo(() => Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i), [range]);
  const stage = (
    <Stage3D height={280} rest={{ x: 22, y: -12 }}>
      <Layer z={-20}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 220" className="scene-svg">
          <path d="M20 140H400" stroke="#1E3A55" strokeWidth="2" /><path d="M400 140l-8 -5v10z" fill="#1E3A55" />
          {ticks.map((n) => <g key={n}><path d={`M${px(n)} 134v12`} stroke="#1E3A55" /><text x={px(n)} y="162" fontSize="9" textAnchor="middle" fill={n < 0 ? '#D2475A' : n > 0 ? '#2E9E6E' : '#1E3A55'}>{n}</text></g>)}
          {view === 'integers' && (<g><circle cx={px(x)} cy="140" r="8" fill="#D2475A" /><circle cx={px(y)} cy="140" r="8" fill="#2E9E6E" /><path d={`M${px(0)} 110H${px(x)}`} stroke="#D2475A" strokeWidth="3" /><text x={(px(0) + px(x)) / 2} y="104" fontSize="10" textAnchor="middle">|{x}| = {Math.abs(x)}</text></g>)}
          {view === 'add' && (<g><circle cx={px(x)} cy="140" r="7" fill="#1E3A55" /><path d={`M${px(x)} 130Q${(px(x) + px(sum)) / 2} ${70} ${px(sum)} 130`} fill="none" stroke={y >= 0 ? '#2E9E6E' : '#D2475A'} strokeWidth="3" /><circle cx={px(sum)} cy="140" r="8" fill="#F2C14E" stroke="#1E3A55" /><text x={px(sum)} y="190" fontSize="12" textAnchor="middle">{x} + ({y}) = {sum}</text></g>)}
          {view === 'multiply' && (<g>{Array.from({ length: Math.abs(x) }, (_, i) => { const from = Math.sign(x) * i * y, to = Math.sign(x) * (i + 1) * y; return Math.abs(to) <= 12 ? <path key={i} d={`M${px(from)} 130Q${(px(from) + px(to)) / 2} 90 ${px(to)} 130`} fill="none" stroke="#4BA3DB" strokeWidth="2.4" /> : null; })}<text x="210" y="190" fontSize="12" textAnchor="middle">{x} · {y} = {sum}{Math.abs(sum) > 12 ? ' (за пределами оси)' : ''}</text></g>)}
          {view === 'real' && reals.map(([label, n], i) => <g key={label}><circle cx={px(n)} cy="140" r="5" fill={['#D2475A', '#8E6BBE', '#F2A33A', '#2E9E6E', '#4BA3DB', '#B8955A'][i]} /><text x={px(n)} y={i % 2 ? 120 : 108} fontSize="9" textAnchor="middle">{label}</text></g>)}
          {(view === 'rounding' || view === 'estimate') && (<g><circle cx={px(value)} cy="140" r="7" fill="#D2475A" /><path d={`M${px(value)} 128Q${(px(value) + px(rounded)) / 2} 100 ${px(rounded)} 128`} fill="none" stroke="#F2C14E" strokeWidth="2.4" /><circle cx={px(rounded)} cy="140" r="6" fill="#F2C14E" stroke="#1E3A55" /><text x="210" y="190" fontSize="12" textAnchor="middle">{value.toFixed(2)} ≈ {rounded.toFixed(Math.max(0, place))}</text></g>)}
        </svg>
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['integers', 'Числовая ось'], ['add', 'Сложение'], ['multiply', 'Умножение'], ['real', 'Действительные'], ['rounding', 'Округление']]} />
          {(view === 'integers' || view === 'add' || view === 'multiply') && (<><SceneSlider label={view === 'multiply' ? 'Сколько прыжков' : 'Первое число'} value={x} min={-12} max={12} unit="" onChange={setX} /><SceneSlider label={view === 'multiply' ? 'Длина прыжка' : 'Второе число'} value={y} min={-12} max={12} unit="" onChange={setY} /></>)}
          <SceneNote>
            {view === 'integers' && <>Правее — больше: {x} {x < y ? '<' : x > y ? '>' : '='} {y}. Модуль — расстояние до нуля.</>}
            {view === 'add' && <>Прибавить положительное — шаг вправо, отрицательное — влево. a − b = a + (−b).</>}
            {view === 'multiply' && <>Минус на плюс даёт минус, минус на минус — плюс: прыжки в обратную сторону.</>}
            {view === 'real' && <>Рациональные (дроби) и иррациональные (π, √2) числа вместе заполняют всю ось.</>}
            {(view === 'rounding' || view === 'estimate') && <>Смотрим на следующую цифру: 0–4 — вниз, 5–9 — вверх.</>}
          </SceneNote>
          {(view === 'rounding' || view === 'estimate') && (<><SceneSlider label="Число" value={value} min={0} max={10} step={0.01} unit="" onChange={setValue} /><SceneModes value={String(place)} onChange={(next) => setPlace(Number(next))} options={[['0', 'до целых'], ['1', 'до десятых'], ['2', 'до сотых']]} /></>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Balance: like terms, brackets, factoring, equations                  */
/* ------------------------------------------------------------------ */

export function BalanceScene({ mode = 'equation' }: { mode?: string }) {
  const [view, setView] = useState(['simplify', 'brackets', 'factor'].includes(mode) ? 'tiles' : 'equation');
  const [left, setLeft] = useState({ x: 3, n: 4 });
  const [right, setRight] = useState({ x: 1, n: 10 });
  const [tiles, setTiles] = useState({ a: 4, b: 3 });
  const solved = left.x - right.x !== 0 ? (right.n - left.n) / (left.x - right.x) : null;
  const xValue = solved ?? 0;
  const diff = (left.x * xValue + left.n) - (right.x * xValue + right.n);
  const tilt = left.x === 1 && right.x === 0 ? 0 : Math.max(-10, Math.min(10, (left.x - right.x) * 2 + (left.n - right.n) * 0.3));
  const both = (dx: number, dn: number) => { setLeft((l) => ({ x: Math.max(0, l.x + dx), n: l.n + dn })); setRight((r) => ({ x: Math.max(0, r.x + dx), n: r.n + dn })); };
  const pan = (side: { x: number; n: number }, cx: number) => (
    <g>
      {Array.from({ length: side.x }, (_, i) => <rect key={`x${i}`} x={cx - 40 + (i % 4) * 21} y={98 - Math.floor(i / 4) * 21} width="19" height="19" rx="4" fill="#4BA3DB" />)}
      {Array.from({ length: Math.min(Math.abs(side.n), 16) }, (_, i) => <circle key={`n${i}`} cx={cx - 34 + (i % 6) * 13} cy={74 - Math.floor(i / 6) * 13 - Math.ceil(side.x / 4) * 21 + 21} r="5.5" fill={side.n < 0 ? '#D2475A' : '#F2C14E'} />)}
      <text x={cx} y="150" fontSize="13" textAnchor="middle" fill="#1E3A55">{side.x ? `${side.x === 1 ? '' : side.x}x` : ''}{side.x && side.n ? (side.n > 0 ? ' + ' : ' − ') : ''}{side.n || !side.x ? Math.abs(side.n) : ''}</text>
    </g>
  );
  const stage = (
    <Stage3D height={300}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 240" className="scene-svg">
          {view === 'equation' ? (<g>
            <path d="M210 220V60M170 226h80" stroke="#5B4A2E" strokeWidth="7" strokeLinecap="round" />
            <g style={{ transform: `rotate(${diff === 0 && left.x === 1 && right.x === 0 ? 0 : tilt}deg)`, transformOrigin: '210px 60px', transition: 'transform .8s cubic-bezier(.34,1.4,.64,1)' }}>
              <path d="M70 60h280" stroke="#B8955A" strokeWidth="6" strokeLinecap="round" /><path d="M110 60v60M310 60v60" stroke="#8A7350" />
              <path d="M60 120h100l-8 12H68z" fill="#C9B48A" /><path d="M260 120h100l-8 12h-84z" fill="#C9B48A" />
              {pan(left, 110)}{pan(right, 310)}
            </g>
          </g>) : (<g>
            {Array.from({ length: tiles.a }, (_, r) => Array.from({ length: tiles.b + 2 }, (_, c) => <rect key={`${r}-${c}`} x={60 + c * 34} y={40 + r * 34} width="32" height="32" rx="4" fill={c < tiles.b ? '#4BA3DB' : '#F2C14E'} opacity=".9" />))}
            <text x={60 + ((tiles.b + 2) * 34) / 2} y="30" fontSize="12" textAnchor="middle">b + 2</text><text x="44" y={40 + tiles.a * 17} fontSize="12" textAnchor="middle">a</text>
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
          <SceneModes value={view} onChange={setView} options={[['equation', 'Уравнение на весах'], ['tiles', 'Плитки: скобки и множители']]} />
          {view === 'equation' ? (<>
            <SceneNote>Уравнение: <b>{left.x}x {left.n >= 0 ? '+' : '−'} {Math.abs(left.n)} = {right.x}x {right.n >= 0 ? '+' : '−'} {Math.abs(right.n)}</b>. Делайте одно и то же с обеими чашами.</SceneNote>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn small" onClick={() => both(-1, 0)}>−x с обеих</button>
              <button type="button" className="btn small" onClick={() => both(0, -1)}>−1 с обеих</button>
              <button type="button" className="btn small" onClick={() => both(0, 1)}>+1 к обеим</button>
              <button type="button" className="btn small" onClick={() => { if (left.x > 1 && right.x === 0 && left.n === 0 && right.n % left.x === 0) { setRight({ x: 0, n: right.n / left.x }); setLeft({ x: 1, n: 0 }); } }}>÷ на число x</button>
              <button type="button" className="btn small" onClick={() => { setLeft({ x: 2 + Math.floor(Math.random() * 3), n: Math.floor(Math.random() * 8) }); setRight({ x: Math.floor(Math.random() * 2), n: 8 + Math.floor(Math.random() * 12) }); }}>Новое</button>
            </div>
            <SceneNote>{left.x === 1 && right.x === 0 && left.n === 0 ? <b>Ответ: x = {right.n}</b> : solved !== null ? `Цель: оставить x один на левой чаше. (Корень ${Number.isInteger(solved) ? solved : solved.toFixed(2)})` : 'x сократились — проверьте, есть ли корни.'}</SceneNote>
          </>) : (<>
            <SceneSlider label="a (строки)" value={tiles.a} min={1} max={5} unit="" onChange={(value) => setTiles((t) => ({ ...t, a: value }))} />
            <SceneSlider label="b (синие столбцы)" value={tiles.b} min={1} max={6} unit="" onChange={(value) => setTiles((t) => ({ ...t, b: value }))} />
            <SceneNote>Площадь прямоугольника a(b + 2) = ab + 2a = {tiles.a}·{tiles.b} + 2·{tiles.a} = <b>{tiles.a * tiles.b + 2 * tiles.a}</b>. Раскрыть скобки — разрезать на синюю и жёлтую части; вынести множитель — собрать обратно.</SceneNote>
          </>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Geometry: points/lines, angles, parallel lines, triangle, polygons    */
/* ------------------------------------------------------------------ */

export function GeometryScene({ mode = 'triangle' }: { mode?: string }) {
  const [view, setView] = useState(['basics', 'angles', 'parallel', 'triangle', 'quad', 'polygon', 'build'].includes(mode) ? (mode === 'build' ? 'triangle' : mode === 'basics' ? 'angles' : mode) : 'triangle');
  const [angle, setAngle] = useState(55);
  const [apex, setApex] = useState({ x: 170, y: 50 });
  const [sides, setSides] = useState(6);
  const [skew, setSkew] = useState(30);
  const [square, setSquare] = useState(false);
  const drag = useRef(false);
  const A = { x: 70, y: 200 }, B = { x: 350, y: 200 }, C = apex;
  const ang = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => {
    const v1 = [q.x - p.x, q.y - p.y], v2 = [r.x - p.x, r.y - p.y];
    return (Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]))) * 180) / Math.PI;
  };
  const a1 = ang(A, B, C), a2 = ang(B, A, C), a3 = 180 - a1 - a2;
  const rad = (angle * Math.PI) / 180;
  const poly = Array.from({ length: sides }, (_, i) => { const t = (i / sides) * Math.PI * 2 - Math.PI / 2; return `${210 + Math.cos(t) * 90},${120 + Math.sin(t) * 90}`; }).join(' ');
  const quadSkew = square ? 0 : skew;
  const stage = (
    <Stage3D height={310}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg
          viewBox="0 0 420 240"
          className="scene-svg"
          onPointerMove={(event) => { if (!drag.current || view !== 'triangle') return; const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); setApex({ x: Math.max(20, Math.min(400, ((event.clientX - box.left) / box.width) * 420)), y: Math.max(10, Math.min(185, ((event.clientY - box.top) / box.height) * 240)) }); }}
          onPointerUp={() => { drag.current = false; }}
        >
          {view === 'triangle' && (<g>
            <polygon points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`} fill="rgba(75,163,219,.18)" stroke="#1E3A55" strokeWidth="2" />
            <text x={A.x + 18} y={A.y - 6} fontSize="12" fill="#D2475A">{a2.toFixed(0)}°</text><text x={B.x - 38} y={B.y - 6} fontSize="12" fill="#2E9E6E">{a1.toFixed(0)}°</text><text x={C.x - 14} y={C.y + 26} fontSize="12" fill="#B8955A">{a3.toFixed(0)}°</text>
            <circle cx={C.x} cy={C.y} r="11" fill="#F2C14E" stroke="#1E3A55" data-interactive style={{ cursor: 'grab' }} onPointerDown={(event) => { event.stopPropagation(); drag.current = true; }} />
          </g>)}
          {view === 'angles' && (<g>
            <path d="M210 160H380" stroke="#1E3A55" strokeWidth="3" /><path d="M210 160H40" stroke="#1E3A55" strokeWidth="1.5" strokeDasharray="5 5" />
            <path d={`M210 160L${210 + Math.cos(rad) * 150} ${160 - Math.sin(rad) * 150}`} stroke="#D2475A" strokeWidth="3" />
            <path d={`M250 160A40 40 0 0 0 ${210 + Math.cos(rad) * 40} ${160 - Math.sin(rad) * 40}`} fill="none" stroke="#F2A33A" strokeWidth="2" />
            <path d={`M${210 + Math.cos(rad) * 28} ${160 - Math.sin(rad) * 28}A28 28 0 0 0 182 160`} fill="none" stroke="#4BA3DB" strokeWidth="2" />
            <text x="262" y="150" fontSize="13" fill="#F2A33A">{angle}°</text><text x="150" y="150" fontSize="13" fill="#4BA3DB">{180 - angle}°</text>
          </g>)}
          {view === 'parallel' && (<g>
            <path d="M20 80H400M20 170H400" stroke="#1E3A55" strokeWidth="2.4" />
            <path d={`M${210 - 120 / Math.tan(rad)} 230L${210 + 120 / Math.tan(rad)} 10`} stroke="#D2475A" strokeWidth="2.4" />
            {[80, 170].map((yy, k) => { const cx = 210 + (125 - yy) / Math.tan(rad); return <g key={yy}><text x={cx + 12} y={yy - 6} fontSize="11" fill={k ? '#2E9E6E' : '#2E9E6E'}>{angle}°</text><text x={cx - 40} y={yy + 16} fontSize="11" fill="#2E9E6E">{angle}°</text><text x={cx - 44} y={yy - 6} fontSize="11" fill="#4BA3DB">{180 - angle}°</text><text x={cx + 12} y={yy + 16} fontSize="11" fill="#4BA3DB">{180 - angle}°</text></g>; })}
          </g>)}
          {view === 'quad' && <polygon points={`${110 + quadSkew},60 ${330 + quadSkew},60 ${330 - quadSkew},190 ${110 - quadSkew},190`} fill="rgba(242,193,78,.25)" stroke="#1E3A55" strokeWidth="2.4" style={{ transition: 'all .5s cubic-bezier(.34,1.3,.64,1)' }} />}
          {view === 'polygon' && <polygon points={poly} fill="rgba(143,200,238,.3)" stroke="#1E3A55" strokeWidth="2.4" />}
        </svg>
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['angles', 'Углы'], ['parallel', 'Параллельные'], ['triangle', 'Треугольник'], ['quad', 'Четырёхугольник'], ['polygon', 'Многоугольник']]} />
          {(view === 'angles' || view === 'parallel') && <SceneSlider label="Угол" value={angle} min={10} max={170} unit="°" onChange={setAngle} />}
          {view === 'angles' && <SceneNote>Смежные углы: {angle}° + {180 - angle}° = 180°. Угол {angle < 90 ? 'острый' : angle === 90 ? 'прямой' : 'тупой'}.</SceneNote>}
          {view === 'parallel' && <SceneNote>Секущая пересекает параллельные прямые: соответственные и накрест лежащие углы равны (зелёные), односторонние в сумме дают 180°.</SceneNote>}
          {view === 'triangle' && <SceneNote>Тяните жёлтую вершину. Углы: {a2.toFixed(0)}° + {a1.toFixed(0)}° + {a3.toFixed(0)}° = <b>180°</b> — всегда!</SceneNote>}
          {view === 'quad' && (<><SceneSlider label="Наклон сторон" value={skew} min={0} max={60} unit="" onChange={(value) => { setSkew(value); setSquare(false); }} /><button type="button" className="btn small" onClick={() => setSquare((value) => !value)}>{square ? 'Параллелограмм' : 'Сделать прямоугольником'}</button><SceneNote>{quadSkew === 0 ? 'Все углы по 90° — прямоугольник.' : 'Противоположные стороны параллельны — параллелограмм.'} Сумма углов любого четырёхугольника — 360°.</SceneNote></>)}
          {view === 'polygon' && (<><SceneSlider label="Число сторон n" value={sides} min={3} max={12} unit="" onChange={setSides} /><SceneNote>Сумма углов (n − 2)·180° = <b>{(sides - 2) * 180}°</b>; угол правильного {sides}-угольника = {(((sides - 2) * 180) / sides).toFixed(1)}°.</SceneNote></>)}
        </section>
      )}
    />
  );
}
