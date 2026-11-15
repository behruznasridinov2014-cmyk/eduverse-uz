/** Own 3D scenes for biology topics. */
import { useMemo, useRef, useState } from 'react';
import { Layer, SceneFrame, SceneModes, SceneNote, SceneSlider, Stage3D, useFrame } from './scene-kit';

/* ------------------------------------------------------------------ */
/* Cell: animal / plant organelles, specialised cells, levels           */
/* ------------------------------------------------------------------ */

const ORGANELLES: Record<string, [string, string]> = {
  membrane: ['Клеточная мембрана', 'Отделяет клетку от среды и пропускает только нужные вещества.'],
  nucleus: ['Ядро', 'Хранит наследственную информацию (хромосомы, гены) и управляет клеткой.'],
  cytoplasm: ['Цитоплазма', 'Вязкое содержимое клетки; в ней идут синтез и расщепление веществ.'],
  mito: ['Митохондрия', '«Электростанция» клетки: здесь из питательных веществ получается энергия.'],
  vacuole: ['Вакуоль', 'Пузырь с клеточным соком. У растений большая и поддерживает упругость клетки.'],
  wall: ['Клеточная стенка', 'Прочная оболочка растительной клетки, держит форму. У животных её нет.'],
  chloro: ['Хлоропласт', 'Содержит зелёный хлорофилл; здесь идёт фотосинтез.'],
};
const SPECIAL: Array<[string, string]> = [
  ['Нейрон', 'Длинные отростки передают сигналы по телу — иногда на метр.'],
  ['Эритроцит', 'Без ядра, двояковогнутый; гемоглобин переносит кислород.'],
  ['Мышечная клетка', 'Длинная, сокращается и двигает тело.'],
  ['Яйцеклетка и сперматозоид', 'Сливаются при оплодотворении; у сперматозоида жгутик для движения.'],
];
const LEVELS = ['Клетка', 'Ткань', 'Орган (сердце)', 'Система органов', 'Организм'];

export function CellScene({ mode = 'animal' }: { mode?: string }) {
  const [view, setView] = useState(mode === 'plant' ? 'plant' : mode === 'specialized' ? 'specialized' : mode === 'tissue' || mode === 'organs' ? 'levels' : 'animal');
  const [picked, setPicked] = useState('nucleus');
  const [special, setSpecial] = useState(0);
  const [level, setLevel] = useState(mode === 'tissue' ? 1 : mode === 'organs' ? 3 : 0);
  const plant = view === 'plant';
  const pick = (id: string) => (event: React.MouseEvent) => { event.stopPropagation(); setPicked(id); };
  const part = (id: string) => ({ onClick: pick(id), className: `organelle ${picked === id ? 'on' : ''}`, 'data-interactive': true });
  const stage = (
    <Stage3D height={320} rest={{ x: 24, y: -18 }}>
      {(view === 'animal' || view === 'plant') && (<>
        {plant && <Layer z={-14}><svg viewBox="0 0 420 240" className="scene-svg"><rect {...part('wall')} x="70" y="30" width="280" height="180" rx="22" fill="#8DBB9F" opacity=".75" /></svg></Layer>}
        <Layer z={-6}><svg viewBox="0 0 420 240" className="scene-svg">
          {plant ? <rect {...part('membrane')} x="80" y="40" width="260" height="160" rx="18" fill="#E7F5E3" stroke="#3FA77A" strokeWidth="3" /> : <ellipse {...part('membrane')} cx="210" cy="120" rx="150" ry="95" fill="#FBE3E3" stroke="#D2475A" strokeWidth="3" />}
          <rect {...part('cytoplasm')} x="190" y="190" width="40" height="0" />
        </svg></Layer>
        {plant && <Layer z={4}><svg viewBox="0 0 420 240" className="scene-svg"><ellipse {...part('vacuole')} cx="230" cy="125" rx="80" ry="55" fill="#CFE8F8" opacity=".8" /></svg></Layer>}
        {!plant && <Layer z={4}><svg viewBox="0 0 420 240" className="scene-svg"><ellipse {...part('vacuole')} cx="290" cy="150" rx="14" ry="10" fill="#CFE8F8" /><ellipse {...part('vacuole')} cx="140" cy="80" rx="10" ry="8" fill="#CFE8F8" /></svg></Layer>}
        <Layer z={18}><svg viewBox="0 0 420 240" className="scene-svg">
          {[[130, 150, 20], [300, 95, -30], [160, 75, 60]].map(([x, y, r], i) => <g key={i} transform={`rotate(${r} ${x} ${y})`}><ellipse {...part('mito')} cx={x} cy={y} rx="22" ry="10" fill="#F2A33A" /><path d={`M${x - 15} ${y}q5 -6 10 0t10 0t10 0`} stroke="#9A5A12" fill="none" strokeWidth="1.4" pointerEvents="none" /></g>)}
          {plant && [[110, 70], [120, 175], [320, 70], [320, 175], [175, 190]].map(([x, y], i) => <ellipse key={i} {...part('chloro')} cx={x} cy={y} rx="16" ry="9" fill="#2E9E6E" />)}
        </svg></Layer>
        <Layer z={34}><svg viewBox="0 0 420 240" className="scene-svg"><circle {...part('nucleus')} cx={plant ? 130 : 200} cy={plant ? 120 : 118} r="30" fill="#8E6BBE" /><circle cx={plant ? 136 : 206} cy={plant ? 114 : 112} r="9" fill="#5E3E8E" pointerEvents="none" /></svg></Layer>
      </>)}
      {view === 'specialized' && (
        <Layer><svg viewBox="0 0 420 240" className="scene-svg">
          {special === 0 && <g><circle cx="120" cy="120" r="26" fill="#F2C14E" /><circle cx="120" cy="120" r="9" fill="#8E6BBE" />{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M120 120l${Math.cos(i * 1.3 + 2) * 60} ${Math.sin(i * 1.3 + 2) * 60}`} stroke="#F2C14E" strokeWidth="4" strokeLinecap="round" />)}<path d="M146 120H380" stroke="#F2C14E" strokeWidth="6" /><path d="M380 120l20 -14M380 120l22 0M380 120l20 14" stroke="#F2C14E" strokeWidth="3" /></g>}
          {special === 1 && <g>{[0, 1, 2].map((i) => <g key={i} transform={`translate(${130 + i * 80} 120)`}><ellipse rx="34" ry="34" fill="#D2263A" /><ellipse rx="16" ry="16" fill="#A81C2E" /></g>)}</g>}
          {special === 2 && <g>{[0, 1, 2].map((i) => <g key={i}><rect x="40" y={70 + i * 36} width="340" height="28" rx="14" fill="#E2786A" /><path d={`M50 ${84 + i * 36}H370`} stroke="#B8463A" strokeDasharray="6 6" /><circle cx={120 + i * 80} cy={84 + i * 36} r="5" fill="#8E6BBE" /></g>)}</g>}
          {special === 3 && <g><circle cx="270" cy="120" r="70" fill="#F7D9D0" stroke="#E2786A" strokeWidth="4" /><circle cx="270" cy="120" r="16" fill="#8E6BBE" /><ellipse cx="120" cy="120" rx="12" ry="9" fill="#8FC8EE" /><path d="M108 120c-20 -8 -30 8 -50 0s-30 8 -40 0" stroke="#8FC8EE" strokeWidth="3" fill="none" /></g>}
        </svg></Layer>
      )}
      {view === 'levels' && (
        <Layer><svg viewBox="0 0 420 240" className="scene-svg">
          {level === 0 && <g><ellipse cx="210" cy="120" rx="80" ry="55" fill="#FBE3E3" stroke="#D2475A" strokeWidth="3" /><circle cx="210" cy="118" r="18" fill="#8E6BBE" /></g>}
          {level === 1 && <g>{Array.from({ length: 24 }, (_, i) => <ellipse key={i} cx={95 + (i % 6) * 46 + (Math.floor(i / 6) % 2) * 23} cy={60 + Math.floor(i / 6) * 40} rx="22" ry="18" fill="#E2786A" stroke="#B8463A" />)}</g>}
          {level === 2 && <path d="M210 205C120 150 90 105 110 70c18-30 70-30 100 10c30-40 82-40 100-10c20 35-10 80-100 135z" fill="#D2263A" stroke="#8A1424" strokeWidth="3" />}
          {level === 3 && <g><path d="M210 30v180M210 60l-70 50v80M210 60l70 50v80M210 120l-50 30M210 120l50 30" stroke="#D2263A" strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M210 50c-12-12-30 0-20 14l20 18 20-18c10-14-8-26-20-14z" fill="#8A1424" /></g>}
          {level === 4 && <g fill="#8FC8EE"><circle cx="210" cy="40" r="22" /><rect x="185" y="66" width="50" height="80" rx="18" /><rect x="150" y="70" width="22" height="70" rx="11" /><rect x="248" y="70" width="22" height="70" rx="11" /><rect x="188" y="146" width="20" height="78" rx="10" /><rect x="212" y="146" width="20" height="78" rx="10" /></g>}
        </svg></Layer>
      )}
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['animal', 'Животная клетка'], ['plant', 'Растительная'], ['specialized', 'Особые клетки'], ['levels', 'От клетки к организму']]} />
          {(view === 'animal' || view === 'plant') && (<><h3>{ORGANELLES[picked][0]}</h3><SceneNote>{ORGANELLES[picked][1]} {!plant && (picked === 'wall' || picked === 'chloro') ? '' : ''}Нажимайте на части клетки и поворачивайте её — органоиды лежат на разной глубине.</SceneNote>{plant ? <SceneNote>Есть только у растений: клеточная стенка, хлоропласты, большая вакуоль.</SceneNote> : <SceneNote>У животной клетки нет клеточной стенки и хлоропластов.</SceneNote>}</>)}
          {view === 'specialized' && (<><SceneModes value={String(special)} onChange={(value) => setSpecial(Number(value))} options={SPECIAL.map(([name], index) => [String(index), name])} /><SceneNote><b>{SPECIAL[special][0]}</b>: {SPECIAL[special][1]}</SceneNote></>)}
          {view === 'levels' && (<><SceneSlider label="Уровень" value={level} min={0} max={4} unit="" onChange={setLevel} /><SceneNote><b>{LEVELS[level]}</b>. Клетки → ткани → органы → системы органов → организм.</SceneNote></>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Body: antagonist muscles, skeleton                                   */
/* ------------------------------------------------------------------ */

const BONES: Record<string, string> = {
  skull: 'Череп защищает мозг. У младенца кости ещё не срослись — это роднички.',
  spine: 'Позвоночник — опора тела, защищает спинной мозг. Состоит из 33–34 позвонков.',
  ribs: 'Рёбра образуют грудную клетку и защищают сердце и лёгкие.',
  humerus: 'Плечевая кость — от плеча до локтя.',
  forearm: 'Лучевая и локтевая кости предплечья.',
  femur: 'Бедренная кость — самая длинная и прочная в теле.',
  tibia: 'Большая и малая берцовые кости голени.',
};

export function BodyScene({ mode = 'muscles' }: { mode?: string }) {
  const [view, setView] = useState(mode === 'skeleton' ? 'skeleton' : 'muscles');
  const [angle, setAngle] = useState(60);
  const [bone, setBone] = useState('skull');
  const bent = (180 - angle) / 150; // 0 straight … 1 bent
  const rad = (angle * Math.PI) / 180;
  const elbow = { x: 230, y: 130 };
  const hand = { x: elbow.x + Math.cos(Math.PI - rad) * 120, y: elbow.y - Math.sin(Math.PI - rad) * 120 };
  const b = (id: string) => ({ onClick: (event: React.MouseEvent) => { event.stopPropagation(); setBone(id); }, 'data-interactive': true, className: `bone ${bone === id ? 'on' : ''}` });
  const stage = (
    <Stage3D height={320}>
      <Layer>
        {view === 'muscles' ? (
          <svg viewBox="0 0 420 240" className="scene-svg">
            <path d={`M70 130L${elbow.x} ${elbow.y}`} stroke="#EDE5D3" strokeWidth="14" strokeLinecap="round" />
            <path d={`M${elbow.x} ${elbow.y}L${hand.x} ${hand.y}`} stroke="#EDE5D3" strokeWidth="11" strokeLinecap="round" />
            <ellipse cx={(70 + elbow.x) / 2} cy={118 - bent * 10} rx={70 - bent * 14} ry={12 + bent * 12} fill={bent > 0.5 ? '#D2263A' : '#E2786A'} style={{ transition: 'all .25s' }} />
            <ellipse cx={(70 + elbow.x) / 2} cy={146} rx={64 + bent * 8} ry={14 - bent * 5} fill={bent > 0.5 ? '#E2786A' : '#D2263A'} opacity=".85" style={{ transition: 'all .25s' }} />
            <circle cx={elbow.x} cy={elbow.y} r="9" fill="#C9B48A" /><circle cx={hand.x} cy={hand.y} r="14" fill="#F2C9A5" />
            <text x="110" y="92" fontSize="11" fill="#1E3A55">Бицепс {bent > 0.5 ? 'сокращён' : 'расслаблен'}</text>
            <text x="110" y="182" fontSize="11" fill="#1E3A55">Трицепс {bent > 0.5 ? 'расслаблен' : 'сокращён'}</text>
          </svg>
        ) : (
          <svg viewBox="0 0 420 240" className="scene-svg">
            <g transform="translate(160 0)" fill="#EDE5D3" stroke="#8A7350" strokeWidth="1.5">
              <ellipse {...b('skull')} cx="50" cy="26" rx="18" ry="20" />
              <rect {...b('spine')} x="46" y="46" width="8" height="90" rx="3" />
              <g {...b('ribs')}>{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M50 ${58 + i * 11}c-26 2 -28 12 -24 16M50 ${58 + i * 11}c26 2 28 12 24 16`} fill="none" />)}</g>
              <rect {...b('humerus')} x="14" y="52" width="8" height="52" rx="4" transform="rotate(12 18 52)" /><rect {...b('humerus')} x="78" y="52" width="8" height="52" rx="4" transform="rotate(-12 82 52)" />
              <rect {...b('forearm')} x="4" y="104" width="7" height="48" rx="3" /><rect {...b('forearm')} x="89" y="104" width="7" height="48" rx="3" />
              <path d="M30 136h40l-6 12H36z" />
              <rect {...b('femur')} x="32" y="148" width="10" height="48" rx="5" /><rect {...b('femur')} x="58" y="148" width="10" height="48" rx="5" />
              <rect {...b('tibia')} x="33" y="198" width="8" height="40" rx="4" /><rect {...b('tibia')} x="59" y="198" width="8" height="40" rx="4" />
            </g>
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
          <SceneModes value={view} onChange={setView} options={[['muscles', 'Мышцы-антагонисты'], ['skeleton', 'Скелет']]} />
          {view === 'muscles' ? (<><SceneSlider label="Угол в локте" value={angle} min={30} max={180} step={5} unit="°" onChange={setAngle} /><SceneNote>Мышца умеет только тянуть. Сгибает руку бицепс, разгибает — трицепс. Они работают по очереди — это антагонисты.</SceneNote></>)
            : <SceneNote>{BONES[bone]} Нажимайте на кости и поворачивайте скелет.</SceneNote>}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Classification: kingdoms, species, variation, plant / animal keys    */
/* ------------------------------------------------------------------ */

const ORGANISMS: Array<[string, string, string]> = [
  ['🌳', 'Дуб', 'Растения'], ['🍄', 'Мухомор', 'Грибы'], ['🦠', 'Кишечная палочка', 'Бактерии'], ['🐅', 'Тигр', 'Животные'],
  ['🌿', 'Мох', 'Растения'], ['🍞', 'Дрожжи', 'Грибы'], ['🪼', 'Медуза', 'Животные'], ['🟢', 'Амёба', 'Протисты'],
];
const KINGDOMS = ['Растения', 'Животные', 'Грибы', 'Бактерии', 'Протисты'];
const SPECIES: Array<[string, string, boolean, string]> = [
  ['Овчарка', 'Такса', true, 'Один вид: породы скрещиваются и дают плодовитое потомство.'],
  ['Лошадь', 'Осёл', false, 'Разные виды: их потомство (мул) бесплодно.'],
  ['Тигр', 'Лев', false, 'Разные виды одного рода Panthera.'],
];
const CLASSES: Array<[string, string, string]> = [['🐟', 'Рыбы', 'чешуя, жабры, плавники'], ['🐸', 'Земноводные', 'голая влажная кожа, живут в воде и на суше'], ['🐢', 'Пресмыкающиеся', 'сухая кожа с чешуёй, яйца на суше'], ['🦅', 'Птицы', 'перья, клюв, яйца с твёрдой скорлупой'], ['🐋', 'Млекопитающие', 'шерсть, выкармливают детёнышей молоком']];

export function ClassifyScene({ mode = 'kingdoms' }: { mode?: string }) {
  const [view, setView] = useState(['kingdoms', 'species', 'variation', 'plants', 'animals'].includes(mode) ? mode : 'kingdoms');
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [current, setCurrent] = useState(0);
  const [pair, setPair] = useState(0);
  const [light, setLight] = useState(6);
  const [water, setWater] = useState(5);
  const [seeds, setSeeds] = useState<boolean | null>(null);
  const [flower, setFlower] = useState<boolean | null>(null);
  const [cls, setCls] = useState(4);
  const plantGroup = seeds === null ? null : !seeds ? 'Споровые (мхи, папоротники, водоросли)' : flower === null ? null : flower ? 'Покрытосеменные (цветковые)' : 'Голосеменные (хвойные)';
  const score = Object.entries(chosen).filter(([i, k]) => ORGANISMS[Number(i)][2] === k).length;
  const stage = (
    <Stage3D height={300}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        {view === 'kingdoms' && <div className="classify-cards">{ORGANISMS.map(([icon, name], index) => <button type="button" data-interactive key={name} className={`classify-card ${index === current ? 'on' : ''} ${chosen[index] ? (chosen[index] === ORGANISMS[index][2] ? 'ok' : 'bad') : ''}`} onClick={() => setCurrent(index)}><span>{icon}</span><small>{name}</small></button>)}</div>}
        {view === 'species' && <div className="classify-pair"><span>{SPECIES[pair][0]}</span><b>+</b><span>{SPECIES[pair][1]}</span><em>{SPECIES[pair][2] ? '= один вид' : '= разные виды'}</em></div>}
        {view === 'variation' && (
          <svg viewBox="0 0 420 240" className="scene-svg">
            {[0, 1].map((gene) => { const h = (gene ? 1.25 : 0.9) * (30 + light * 6) * (0.5 + water / 10); return <g key={gene} transform={`translate(${130 + gene * 160} 0)`}><rect x="-30" y="200" width="60" height="30" rx="4" fill="#B8663A" /><path d={`M0 200V${200 - h}`} stroke="#3FA77A" strokeWidth="5" />{[0.3, 0.55, 0.8].map((k) => <ellipse key={k} cx={k * 20 - 8} cy={200 - h * k} rx="16" ry="7" fill="#3FA77A" transform={`rotate(${k * 60 - 20} ${k * 20 - 8} ${200 - h * k})`} />)}<text y="236" fontSize="10" textAnchor="middle" fill="#fff">{gene ? 'сорт «высокий»' : 'сорт «низкий»'}</text></g>; })}
          </svg>
        )}
        {view === 'plants' && <div className="classify-pair"><span>{plantGroup ?? 'Ответьте на вопросы определителя →'}</span></div>}
        {view === 'animals' && <div className="classify-pair"><span style={{ fontSize: 64 }}>{CLASSES[cls][0]}</span><em>{CLASSES[cls][1]}</em></div>}
      </Layer>
    </Stage3D>
  );
  return (
    <SceneFrame
      stage={stage}
      controls={(
        <section className="panel">
          <SceneModes value={view} onChange={setView} options={[['kingdoms', 'Царства'], ['species', 'Вид'], ['variation', 'Изменчивость'], ['plants', 'Растения'], ['animals', 'Животные']]} />
          {view === 'kingdoms' && (<><SceneNote>Куда отнести: <b>{ORGANISMS[current][1]}</b>?</SceneNote><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{KINGDOMS.map((k) => <button key={k} type="button" className="tag" onClick={() => { setChosen((value) => ({ ...value, [current]: k })); setCurrent((c) => (c + 1) % ORGANISMS.length); }}>{k}</button>)}</div><SceneNote>Верно: {score} из {ORGANISMS.length}.</SceneNote></>)}
          {view === 'species' && (<><SceneModes value={String(pair)} onChange={(value) => setPair(Number(value))} options={SPECIES.map(([a, b2], index) => [String(index), `${a} и ${b2}`])} /><SceneNote>{SPECIES[pair][3]}</SceneNote></>)}
          {view === 'variation' && (<><SceneSlider label="Свет" value={light} min={0} max={10} unit="" onChange={setLight} /><SceneSlider label="Вода" value={water} min={0} max={10} unit="" onChange={setWater} /><SceneNote>Сорт (гены) — наследственная изменчивость. Свет и вода — ненаследственная: она меняет оба растения одинаково.</SceneNote></>)}
          {view === 'plants' && (<><SceneNote>1. Есть ли у растения семена?</SceneNote><div className="row" style={{ gap: 6 }}><button type="button" className={`tag ${seeds === true ? 'gold' : ''}`} onClick={() => setSeeds(true)}>Да</button><button type="button" className={`tag ${seeds === false ? 'gold' : ''}`} onClick={() => { setSeeds(false); setFlower(null); }}>Нет</button></div>{seeds && (<><SceneNote>2. Есть ли цветок и плод?</SceneNote><div className="row" style={{ gap: 6 }}><button type="button" className={`tag ${flower === true ? 'gold' : ''}`} onClick={() => setFlower(true)}>Да</button><button type="button" className={`tag ${flower === false ? 'gold' : ''}`} onClick={() => setFlower(false)}>Нет, шишки</button></div></>)}</>)}
          {view === 'animals' && (<><SceneModes value={String(cls)} onChange={(value) => setCls(Number(value))} options={CLASSES.map(([icon, name], index) => [String(index), `${icon} ${name}`])} /><SceneNote><b>{CLASSES[cls][1]}</b>: {CLASSES[cls][2]}.</SceneNote></>)}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Microbes: types, decay, food, disease spread, Pasteur's flasks       */
/* ------------------------------------------------------------------ */

const MICROBES: Array<[string, string]> = [['Бактерия-палочка', 'Одна клетка без ядра. Делится каждые 20 минут.'], ['Кокки', 'Шарообразные бактерии, часто цепочками.'], ['Амёба', 'Простейшее: ползает с помощью ложноножек.'], ['Дрожжи', 'Одноклеточные грибы, размножаются почкованием.'], ['Водоросль', 'Зелёная клетка, сама делает пищу на свету.']];

export function MicrobesScene({ mode = 'types' }: { mode?: string }) {
  const [view, setView] = useState(['types', 'decay', 'food', 'disease', 'pasteur'].includes(mode) ? mode : 'types');
  const [kind, setKind] = useState(0);
  const [temp, setTemp] = useState(25);
  const [humid, setHumid] = useState(70);
  const [days, setDays] = useState(5);
  const [wash, setWash] = useState(false);
  const sim = useRef({ t: 0, infected: new Set<number>([0]) });
  const [, tick] = useState(0);
  const host = useFrame((dt) => {
    const s = sim.current; s.t += dt;
    if (view === 'disease' && Math.floor(s.t * 3) !== Math.floor((s.t - dt) * 3)) {
      const next = new Set(s.infected);
      for (const i of s.infected) for (const j of [i - 1, i + 1, i - 10, i + 10]) if (j >= 0 && j < 100 && Math.random() < (wash ? 0.08 : 0.35)) next.add(j);
      s.infected = next.size >= 100 ? new Set([0]) : next;
    }
    tick((n) => (n + 1) % 1000000);
  });
  const s = sim.current;
  const decayRate = Math.max(0, Math.min(1, ((temp - 2) / 30) * (humid / 100)));
  const decay = Math.min(100, Math.round(days * decayRate * 18));
  const yeast = temp > 55 ? 0 : Math.max(0, 1 - Math.abs(temp - 35) / 30);
  const rise = 1 + yeast * Math.min(1, s.t / 6) * 0.8;
  const stage = (
    <Stage3D height={300} className={view === 'types' ? 'dark-stage' : ''}>
      <Layer>
        <svg viewBox="0 0 420 240" className="scene-svg">
          {view === 'types' && (<g>
            <circle cx="210" cy="120" r="105" fill="rgba(143,200,238,.12)" stroke="rgba(255,255,255,.5)" strokeWidth="6" />
            {kind === 0 && Array.from({ length: 9 }, (_, i) => <rect key={i} x={140 + (i % 3) * 50} y={80 + Math.floor(i / 3) * 30} width="30" height="11" rx="5.5" fill="#7FD3F7" transform={`rotate(${i * 37 + s.t * 10} ${155 + (i % 3) * 50} ${85 + Math.floor(i / 3) * 30})`} />)}
            {kind === 1 && Array.from({ length: 14 }, (_, i) => <circle key={i} cx={150 + i * 9} cy={120 + Math.sin(i) * 12} r="5" fill="#F7A8C8" />)}
            {kind === 2 && <path d={`M170 120c0-40 30-50 50-30 ${10 + Math.sin(s.t * 2) * 8} -20 40 0 30 30 20 30-10 50-40 40-30 10-60-10-40-40z`} fill="rgba(200,220,160,.8)" stroke="#8DBB9F" />}
            {kind === 3 && <g><circle cx="200" cy="120" r="22" fill="#F2DDB0" /><circle cx={222 + Math.min(14, s.t % 4 * 4)} cy="104" r={Math.min(12, (s.t % 4) * 3)} fill="#F2DDB0" /></g>}
            {kind === 4 && Array.from({ length: 6 }, (_, i) => <circle key={i} cx={160 + i * 20} cy={120 + Math.sin(i + s.t) * 4} r="9" fill="#3FA77A" />)}
          </g>)}
          {view === 'decay' && (<g>
            <circle cx="210" cy="120" r="70" fill={`rgb(${200 - decay}, ${60 + decay * 0.6}, ${50 + decay * 0.2})`} />
            {Array.from({ length: Math.round(decay / 6) }, (_, i) => <circle key={i} cx={170 + ((i * 37) % 80)} cy={90 + ((i * 23) % 70)} r={4 + (i % 3) * 3} fill="#5E6B4A" opacity=".7" />)}
            <path d="M210 50c0-14 8-20 16-22" stroke="#6B5B3E" strokeWidth="4" fill="none" />
            <text x="210" y="222" fontSize="13" textAnchor="middle" fill="#1E3A55">Разложилось: {decay}%</text>
          </g>)}
          {view === 'food' && (<g>
            <path d="M120 200h180l-12 30H132z" fill="#C9A26E" />
            <ellipse cx="210" cy={200 - 30 * rise} rx={80 + rise * 6} ry={30 * rise} fill="#F2DDB0" stroke="#C9A26E" />
            {Array.from({ length: Math.round(yeast * 14) }, (_, i) => <circle key={i} cx={170 + ((i * 29) % 80)} cy={200 - 30 * rise + ((i * 13) % 20) - 10} r="3" fill="#fff" opacity=".8" />)}
            <text x="210" y="40" fontSize="13" textAnchor="middle" fill="#1E3A55">{temp > 55 ? 'Дрожжи погибли от жары' : yeast > 0.7 ? 'Тесто быстро поднимается' : 'Дрожжи работают медленно'}</text>
          </g>)}
          {view === 'disease' && (<g>{Array.from({ length: 100 }, (_, i) => <circle key={i} cx={75 + (i % 10) * 30} cy={25 + Math.floor(i / 10) * 21} r="8" fill={s.infected.has(i) ? '#D2475A' : '#8FC8EE'} style={{ transition: 'fill .4s' }} />)}</g>)}
          {view === 'pasteur' && (<g>
            {[0, 1].map((swan) => { const cloudy = swan ? 0 : Math.min(1, days / 4); return <g key={swan} transform={`translate(${110 + swan * 200} 0)`}>
              <ellipse cx="0" cy="170" rx="50" ry="45" fill={`rgba(${200 - cloudy * 60}, ${170 - cloudy * 40}, ${90 + cloudy * 10}, ${0.4 + cloudy * 0.5})`} stroke="#1E3A55" strokeWidth="2" />
              {swan ? <path d="M-6 126V90c0-30 40-40 50-10 6 18-10 26-10 10" stroke="#1E3A55" strokeWidth="9" fill="none" /> : <path d="M0 126V40" stroke="#1E3A55" strokeWidth="12" />}
              <text x="0" y="234" fontSize="11" textAnchor="middle" fill="#1E3A55">{swan ? 'Изогнутое горло: чисто' : cloudy > 0.5 ? 'Прямое горло: микробы!' : 'Прямое горло'}</text>
            </g>; })}
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
            <SceneModes value={view} onChange={(next) => { setView(next); sim.current = { t: 0, infected: new Set([0]) }; }} options={[['types', 'Под микроскопом'], ['decay', 'Разложение'], ['food', 'Тесто'], ['disease', 'Инфекция'], ['pasteur', 'Опыт Пастера']]} />
            {view === 'types' && (<><SceneModes value={String(kind)} onChange={(value) => setKind(Number(value))} options={MICROBES.map(([name], index) => [String(index), name])} /><SceneNote>{MICROBES[kind][1]}</SceneNote></>)}
            {view === 'decay' && (<><SceneSlider label="Температура" value={temp} min={0} max={40} unit=" °C" onChange={setTemp} /><SceneSlider label="Влажность" value={humid} min={0} max={100} step={5} unit=" %" onChange={setHumid} /><SceneSlider label="Дней прошло" value={days} min={0} max={14} unit="" onChange={setDays} /><SceneNote>Тепло и влага ускоряют работу бактерий и грибов. В холодильнике и в сухом месте разложение почти останавливается.</SceneNote></>)}
            {view === 'food' && (<><SceneSlider label="Температура теста" value={temp} min={0} max={70} unit=" °C" onChange={(value) => { setTemp(value); sim.current.t = 0; }} /><SceneNote>Дрожжи едят сахар и выделяют углекислый газ — пузырьки поднимают тесто. Лучше всего при 30–38 °C.</SceneNote></>)}
            {view === 'disease' && (<><button type="button" className="btn small" onClick={() => { setWash((value) => !value); sim.current.infected = new Set([0]); }}>{wash ? 'Все перестали мыть руки' : 'Все моют руки'}</button><SceneNote>Заражено: <b>{s.infected.size}</b> из 100. {wash ? 'Гигиена сильно замедляет распространение.' : 'Без гигиены инфекция быстро передаётся соседям.'}</SceneNote></>)}
            {view === 'pasteur' && (<><SceneSlider label="Дней" value={days} min={0} max={8} unit="" onChange={setDays} /><SceneNote>Микробы из воздуха оседают в изгибе «лебединой шеи» и не попадают в бульон. Значит, жизнь не зарождается сама.</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Food web, human impact, habitats, protection, energy sources         */
/* ------------------------------------------------------------------ */

const WEB_NODES: Array<[string, string, number, number]> = [
  ['grass', '🌾 Трава', 210, 210], ['grasshopper', '🦗 Кузнечик', 90, 150], ['rabbit', '🐇 Заяц', 210, 150], ['mouse', '🐁 Мышь', 330, 150],
  ['frog', '🐸 Лягушка', 90, 90], ['snake', '🐍 Змея', 270, 85], ['fox', '🦊 Лиса', 160, 30], ['eagle', '🦅 Орёл', 330, 30],
];
const WEB_EDGES: Array<[string, string]> = [['grass', 'grasshopper'], ['grass', 'rabbit'], ['grass', 'mouse'], ['grasshopper', 'frog'], ['frog', 'snake'], ['mouse', 'snake'], ['rabbit', 'fox'], ['mouse', 'fox'], ['snake', 'eagle'], ['rabbit', 'eagle']];
const HABITATS: Array<[string, string, string]> = [['🐫', 'Верблюд', 'Пустыня'], ['🦭', 'Тюлень', 'Вода'], ['🐀', 'Крот', 'Почва'], ['🦅', 'Орёл', 'Воздух']];
const SOURCES: Array<[string, number, boolean]> = [['☀ Солнце', 0, true], ['🌬 Ветер', 0, true], ['💧 ГЭС', 0, true], ['⛽ Нефть', 85, false], ['🔥 Газ', 55, false], ['⛏ Уголь', 100, false]];

export function FoodWebScene({ mode = 'web' }: { mode?: string }) {
  const [view, setView] = useState(['web', 'human', 'adapt', 'protect', 'energy'].includes(mode) ? mode : 'web');
  const [removed, setRemoved] = useState<string | null>(null);
  const [pesticide, setPesticide] = useState(false);
  const [usage, setUsage] = useState(40);
  const [trees, setTrees] = useState(20);
  const [source, setSource] = useState(0);
  const [habitat, setHabitat] = useState<Record<number, string>>({});
  const effect = (id: string) => {
    if (!removed || removed === id) return 0;
    const preys = WEB_EDGES.filter(([, eater]) => eater === removed).map(([food]) => food);
    const eaters = WEB_EDGES.filter(([food]) => food === removed).map(([, eater]) => eater);
    return preys.includes(id) ? 1 : eaters.includes(id) ? -1 : 0;
  };
  const chain: Array<[string, number]> = [['🌾 Трава', 1], ['🦗 Кузнечик', 10], ['🐸 Лягушка', 100], ['🐍 Змея', 1000], ['🦅 Орёл', 10000]];
  const lake = Math.max(0.1, 1 - usage / 110);
  const biodiversity = Math.min(100, 20 + trees * 0.8);
  const stage = (
    <Stage3D height={320}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 240" className="scene-svg">
          {view === 'web' && (<g>
            {WEB_EDGES.map(([a, b]) => { const A = WEB_NODES.find((n) => n[0] === a)!, B = WEB_NODES.find((n) => n[0] === b)!; const off = removed === a || removed === b; return <path key={a + b} d={`M${A[2]} ${A[3]}L${B[2]} ${B[3]}`} stroke={off ? 'rgba(30,58,85,.12)' : '#B8955A'} strokeWidth="2" markerEnd="url(#arrow)" />; })}
            <defs><marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#B8955A" /></marker></defs>
            {WEB_NODES.map(([id, label, x, y]) => { const e = effect(id); return <g key={id} data-interactive onClick={() => setRemoved(removed === id ? null : id)} style={{ cursor: 'pointer', opacity: removed === id ? 0.25 : 1 }}><rect x={x - 46} y={y - 13} width="92" height="26" rx="13" fill={e > 0 ? '#E7F7EF' : e < 0 ? '#FFECEF' : '#FFFDF8'} stroke={e > 0 ? '#2E9E6E' : e < 0 ? '#D2475A' : '#B8955A'} /><text x={x} y={y + 4} fontSize="11" textAnchor="middle">{label}{e > 0 ? ' ↑' : e < 0 ? ' ↓' : ''}</text></g>; })}
          </g>)}
          {view === 'human' && (<g>
            {chain.map(([label, ppm], i) => <g key={label} transform={`translate(${30 + i * 78} ${190 - i * 30})`}><rect width="70" height="26" rx="8" fill="#FFFDF8" stroke="#B8955A" /><text x="35" y="17" fontSize="10" textAnchor="middle">{label}</text>{pesticide && <circle cx="35" cy="-14" r={Math.min(22, 3 + Math.log10(ppm) * 4.5)} fill="#D2475A" opacity=".6" />}</g>)}
            <ellipse cx="330" cy="70" rx={70 * lake} ry={34 * lake} fill="#4BA3DB" opacity=".75" style={{ transition: 'all .6s' }} /><text x="330" y="120" fontSize="10" textAnchor="middle">Аральское море: {(lake * 100).toFixed(0)}%</text>
          </g>)}
          {view === 'adapt' && (<g>{['Пустыня', 'Вода', 'Почва', 'Воздух'].map((h, i) => <g key={h} transform={`translate(${20 + i * 100} 30)`}><rect width="90" height="170" rx="12" fill={['#F2DDB0', '#8FC8EE', '#B8663A', '#CFE8F8'][i]} /><text x="45" y="190" fontSize="11" textAnchor="middle">{h}</text>{HABITATS.filter((_, j) => habitat[j] === h).map(([icon], k) => <text key={k} x="45" y={60 + k * 40} fontSize="30" textAnchor="middle">{icon}</text>)}</g>)}</g>)}
          {view === 'protect' && (<g>{Array.from({ length: Math.round(trees / 4) }, (_, i) => <g key={i} transform={`translate(${30 + (i * 47) % 360} ${120 + (i % 3) * 30})`}><path d="M0 0v20" stroke="#6B5B3E" strokeWidth="4" /><circle cy="-8" r="14" fill="#3FA77A" /></g>)}{Array.from({ length: Math.round(biodiversity / 15) }, (_, i) => <text key={i} x={40 + i * 55} y="60" fontSize="22">{['🦌', '🐦', '🦋', '🦔', '🐝', '🦉', '🐿'][i % 7]}</text>)}</g>)}
          {view === 'energy' && (<g>
            {SOURCES.map(([name, co2], i) => <g key={name} transform={`translate(${30 + i * 62} 0)`} data-interactive onClick={() => setSource(i)} style={{ cursor: 'pointer' }}><rect y={200 - co2 * 1.4} width="40" height={co2 * 1.4 + 1} rx="4" fill={i === source ? '#D2475A' : 'rgba(210,71,90,.35)'} /><text x="20" y="220" fontSize="9" textAnchor="middle">{name}</text></g>)}
            <text x="210" y="24" fontSize="12" textAnchor="middle" fill="#1E3A55">Выбросы CO₂ при получении энергии</text>
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
          <SceneModes value={view} onChange={setView} options={[['web', 'Пищевая сеть'], ['human', 'Влияние человека'], ['adapt', 'Среды обитания'], ['protect', 'Охрана природы'], ['energy', 'Источники энергии']]} />
          {view === 'web' && <SceneNote>{removed ? `Убрали: ${WEB_NODES.find((n) => n[0] === removed)?.[1]}. Зелёным — кого станет больше, красным — кому не хватит пищи.` : 'Нажмите на животное, чтобы убрать его из сети, и посмотрите, что случится с другими. На каждом звене передаётся около 10 % энергии.'}</SceneNote>}
          {view === 'human' && (<><button type="button" className="btn small" onClick={() => setPesticide((value) => !value)}>{pesticide ? 'Убрать пестицид' : 'Опрыскать поле пестицидом'}</button><SceneSlider label="Забор воды на поля" value={usage} min={0} max={100} step={5} unit=" %" onChange={setUsage} /><SceneNote>{pesticide ? 'Яд накапливается: у орла его в тысячи раз больше, чем в траве.' : 'Каждый хищник съедает много жертв — вместе с ними накапливаются и вредные вещества.'} Чем больше воды забирают реки на поля, тем меньше её доходит до Арала.</SceneNote></>)}
          {view === 'adapt' && HABITATS.map(([icon, name], index) => <div key={name} className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}><b style={{ minWidth: 90 }}>{icon} {name}</b>{['Пустыня', 'Вода', 'Почва', 'Воздух'].map((h) => <button key={h} type="button" className={`tag ${habitat[index] === h ? (h === HABITATS[index][2] ? 'gold' : '') : ''}`} onClick={() => setHabitat((value) => ({ ...value, [index]: h }))}>{h}{habitat[index] === h ? (h === HABITATS[index][2] ? ' ✓' : ' ✗') : ''}</button>)}</div>)}
          {view === 'protect' && (<><SceneSlider label="Посажено деревьев" value={trees} min={0} max={100} step={5} unit="" onChange={setTrees} /><SceneNote>Биоразнообразие: <b>{biodiversity.toFixed(0)}%</b>. Деревья дают дом и пищу птицам, насекомым и зверям.</SceneNote></>)}
          {view === 'energy' && <SceneNote><b>{SOURCES[source][0]}</b> — {SOURCES[source][2] ? 'возобновляемый источник, почти без выбросов.' : 'невозобновляемый: запасы кончаются, при сжигании выделяется CO₂.'}</SceneNote>}
        </section>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Leaf: photosynthesis with light, water transport                     */
/* ------------------------------------------------------------------ */

export function LeafScene({ mode = 'light' }: { mode?: string }) {
  const [view, setView] = useState(mode === 'water' ? 'water' : 'light');
  const [light, setLight] = useState(7);
  const [co2, setCo2] = useState(5);
  const [sun, setSun] = useState(6);
  const [wind, setWind] = useState(3);
  const sim = useRef({ t: 0, bubbles: [] as Array<[number, number]>, level: 0 });
  const [, tick] = useState(0);
  const rate = (light / 10) * Math.min(1, co2 / 6);
  const transpiration = (sun * 0.7 + wind * 0.5) / 10;
  const host = useFrame((dt) => {
    const s = sim.current; s.t += dt;
    if (view === 'light') {
      if (Math.random() < rate * dt * 6) s.bubbles.push([200 + (Math.random() - 0.5) * 60, 150]);
      s.bubbles = s.bubbles.map(([x, y]) => [x + Math.sin(y / 10) * 0.3, y - dt * 40] as [number, number]).filter(([, y]) => y > 20);
    } else {
      s.level = (s.level + dt * transpiration * 40) % 180;
    }
    tick((n) => (n + 1) % 1000000);
  });
  const s = sim.current;
  const drops = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);
  const stage = (
    <Stage3D height={310}>
      <Layer z={-30}><div className="scene-backdrop" /></Layer>
      <Layer>
        <svg viewBox="0 0 420 240" className="scene-svg">
          {view === 'light' ? (<g>
            <circle cx="60" cy="40" r={14 + light * 2} fill="#FFC94A" opacity={0.3 + light / 14} />
            {Array.from({ length: Math.round(light) }, (_, i) => <path key={i} d={`M${80 + i * 8} ${55 + i * 4}L${160 + i * 6} ${110 + i * 3}`} stroke="#FFC94A" strokeWidth="2" opacity=".6" />)}
            <path d="M120 170C140 90 270 70 320 120C280 180 170 200 120 170z" fill="#3FA77A" stroke="#2E7D57" strokeWidth="2" />
            <path d="M120 170C190 140 250 130 320 120" stroke="#2E7D57" strokeWidth="2" fill="none" />
            {s.bubbles.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="none" stroke="#4BA3DB" strokeWidth="1.5" />)}
            <text x="350" y="60" fontSize="11" fill="#1E3A55">O₂ ↑</text><text x="340" y="200" fontSize="11" fill="#1E3A55">CO₂ + H₂O →</text>
          </g>) : (<g>
            <path d="M200 230V40" stroke="#3FA77A" strokeWidth="18" strokeLinecap="round" />
            <path d="M200 230V40" stroke="#B8E0F5" strokeWidth="6" />
            <path d={`M200 230V${230 - s.level}`} stroke="#4BA3DB" strokeWidth="6" />
            {[60, 100, 140].map((y, i) => <ellipse key={y} cx={i % 2 ? 160 : 240} cy={y} rx="40" ry="14" fill="#3FA77A" transform={`rotate(${i % 2 ? 20 : -20} ${i % 2 ? 160 : 240} ${y})`} />)}
            {drops.slice(0, Math.round(transpiration * 12)).map((i) => <circle key={i} cx={130 + (i * 37) % 160} cy={30 + ((i * 23 + s.t * 30) % 60)} r="2.5" fill="#8FC8EE" opacity=".8" />)}
            <path d="M160 232c-20 6-40 4-60 0M240 232c20 6 40 4 60 0" stroke="#8A6A1E" strokeWidth="3" fill="none" />
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
            <SceneModes value={view} onChange={setView} options={[['light', 'Фотосинтез'], ['water', 'Движение воды']]} />
            {view === 'light' ? (<><SceneSlider label="Свет" value={light} min={0} max={10} unit="" onChange={setLight} /><SceneSlider label="Углекислый газ" value={co2} min={0} max={10} unit="" onChange={setCo2} /><SceneNote>6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ (на свету, в хлоропластах). Скорость фотосинтеза: <b>{Math.round(rate * 100)}%</b>. Без света пузырьков кислорода нет.</SceneNote></>)
              : (<><SceneSlider label="Солнце" value={sun} min={0} max={10} unit="" onChange={setSun} /><SceneSlider label="Ветер" value={wind} min={0} max={10} unit="" onChange={setWind} /><SceneNote>Листья испаряют воду (транспирация) и «тянут» её вверх по сосудам. Сейчас испарение: <b>{Math.round(transpiration * 100)}%</b>.</SceneNote></>)}
          </section>
        )}
      />
    </div>
  );
}
