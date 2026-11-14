import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Minus, Plus, RotateCcw, Sparkles, Atom } from 'lucide-react';
import { AiTutor } from './extras';
import { PhysicsLab } from './physics-lab';
import type { Language } from './school-data';

/**
 * 3D chemistry lab.
 *
 * Students put atoms together; when the set matches a real substance the
 * molecule appears in 3D (ball-and-stick, drag to rotate) with its name,
 * formula and properties. A second mode mixes two substances and shows the
 * reaction with its equation. Everything is local data — no network, so it
 * works on weak school internet; the AI tutor answers anything beyond it.
 */

type El = 'H' | 'C' | 'N' | 'O' | 'Na' | 'Cl' | 'S';
type Txt = Record<Language, string>;
const L = (uz: string, ru: string, en: string): Txt => ({ Uzbek: uz, Русский: ru, English: en });

const ELEMENTS: Record<El, { color: string; r: number; name: Txt }> = {
  H: { color: '#F2F2F3', r: 0.32, name: L('Vodorod', 'Водород', 'Hydrogen') },
  C: { color: '#3A3A42', r: 0.5, name: L('Uglerod', 'Углерод', 'Carbon') },
  N: { color: '#3B6FE0', r: 0.48, name: L('Azot', 'Азот', 'Nitrogen') },
  O: { color: '#E0303F', r: 0.46, name: L('Kislorod', 'Кислород', 'Oxygen') },
  Na: { color: '#A66BE0', r: 0.62, name: L('Natriy', 'Натрий', 'Sodium') },
  Cl: { color: '#3CC46C', r: 0.58, name: L('Xlor', 'Хлор', 'Chlorine') },
  S: { color: '#E8C534', r: 0.56, name: L('Oltingugurt', 'Сера', 'Sulfur') },
};

type Atom3 = { el: El; p: [number, number, number] };
const VALENCE: Record<El, number> = { H: 1, C: 4, N: 3, O: 2, Na: 1, Cl: 1, S: 2 };

/**
 * Builds a 3D model for ANY set of atoms: the atom with the highest valence
 * sits in the centre, the others spread evenly on a sphere around it. The
 * student always sees what they made, plus whether it can exist.
 */
function sandboxMolecule(counts: Record<string, number>): Molecule | null {
  const atoms: El[] = [];
  for (const [el, n] of Object.entries(counts)) for (let i = 0; i < n; i += 1) atoms.push(el as El);
  if (atoms.length === 0) return null;
  atoms.sort((a, b) => VALENCE[b] - VALENCE[a]);
  const [center, ...rest] = atoms;
  const placed: Atom3[] = [{ el: center!, p: [0, 0, 0] }];
  const bonds: Array<[number, number, number?]> = [];
  rest.forEach((el, i) => {
    // Fibonacci sphere: even spacing for any count
    const k = rest.length;
    const y = k === 1 ? 0 : 1 - (2 * (i + 0.5)) / k;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const d = 1.1 + ELEMENTS[el].r * 0.6;
    placed.push({ el, p: [Math.cos(phi) * r * d, y * d, Math.sin(phi) * r * d] });
    bonds.push([0, i + 1]);
  });
  const formula = Object.entries(counts).map(([el, n]) => `${el}${n > 1 ? n : ''}`).join('');
  return {
    id: 'sandbox', formula, name: L('Sizning molekulangiz', 'Ваша молекула', 'Your molecule'),
    atoms: placed, bonds, facts: [], state: L('Noma’lum', 'Неизвестно', 'Unknown'),
  };
}

/** Valence check: can these atoms form one neutral molecule? */
function valenceReport(counts: Record<string, number>): { ok: boolean; free: number } {
  const atoms = Object.entries(counts).flatMap(([el, n]) => Array.from({ length: n }, () => VALENCE[el as El]));
  if (atoms.length < 2) return { ok: false, free: atoms[0] ?? 0 };
  const total = atoms.reduce((a, b) => a + b, 0);
  const max = Math.max(...atoms);
  // a connected structure needs an even bond count and enough bonds to link every atom
  const ok = total % 2 === 0 && total >= 2 * (atoms.length - 1) && max <= total - max;
  return { ok, free: total % 2 };
}
type Molecule = {
  id: string;
  formula: string;
  name: Txt;
  atoms: Atom3[];
  bonds: Array<[number, number, number?]>; // [a, b, order]
  facts: Txt[];
  state: Txt;
  danger?: Txt;
  life?: Txt;
};

const t = 1.0;
// Geometry: simple, readable coordinates (Å-like units).
const MOLECULES: Molecule[] = [
  {
    id: 'h2', life: L('Shar va raketalar yoqilg‘isi — rangsiz, hidsiz gaz.', 'Воздушные шары и ракетное топливо — бесцветный газ без запаха.', 'Balloons and rocket fuel — colourless, odourless gas.'), formula: 'H₂', name: L('Vodorod', 'Водород', 'Hydrogen'),
    atoms: [{ el: 'H', p: [-0.37, 0, 0] }, { el: 'H', p: [0.37, 0, 0] }], bonds: [[0, 1]],
    state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Eng yengil gaz.', 'Самый лёгкий газ.', 'The lightest gas.'), L('Yonadi, suv hosil qiladi.', 'Горит, образуя воду.', 'Burns to form water.')],
    danger: L('Havo bilan portlovchi aralashma.', 'С воздухом образует гремучую смесь.', 'Explosive mixture with air.'),
  },
  {
    id: 'o2', life: L('Biz nafas olayotgan havo; suyuq kislorod — och ko‘k rangda.', 'Воздух, которым мы дышим; жидкий кислород — бледно-голубой.', 'The air we breathe; liquid oxygen is pale blue.'), formula: 'O₂', name: L('Kislorod', 'Кислород', 'Oxygen'),
    atoms: [{ el: 'O', p: [-0.6, 0, 0] }, { el: 'O', p: [0.6, 0, 0] }], bonds: [[0, 1, 2]],
    state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Havoning 21%.', 'Составляет 21% воздуха.', '21% of air.'), L('Nafas olish va yonish uchun kerak.', 'Нужен для дыхания и горения.', 'Needed for breathing and burning.')],
  },
  {
    id: 'n2', life: L('Havoning asosiy qismi; suyuq azot −196 °C da qaynaydi.', 'Основная часть воздуха; жидкий азот кипит при −196 °C.', 'Most of the air; liquid nitrogen boils at −196 °C.'), formula: 'N₂', name: L('Azot', 'Азот', 'Nitrogen'),
    atoms: [{ el: 'N', p: [-0.55, 0, 0] }, { el: 'N', p: [0.55, 0, 0] }], bonds: [[0, 1, 3]],
    state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Havoning 78%.', 'Составляет 78% воздуха.', '78% of air.'), L('Uch bog‘ — juda barqaror.', 'Тройная связь — очень устойчив.', 'Triple bond — very stable.')],
  },
  {
    id: 'h2o', life: L('Stakandagi suv, muz va bug‘ — bitta modda uch holatda.', 'Вода в стакане, лёд и пар — одно вещество в трёх состояниях.', 'Water in a glass, ice and steam — one substance, three states.'), formula: 'H₂O', name: L('Suv', 'Вода', 'Water'),
    atoms: [{ el: 'O', p: [0, 0, 0] }, { el: 'H', p: [-0.76, 0.59, 0] }, { el: 'H', p: [0.76, 0.59, 0] }],
    bonds: [[0, 1], [0, 2]], state: L('Suyuqlik', 'Жидкость', 'Liquid'),
    facts: [L('Burchak 104,5° — molekula qutbli.', 'Угол 104,5° — молекула полярная.', 'Angle 104.5° — a polar molecule.'), L('100 °C da qaynaydi, 0 °C da muzlaydi.', 'Кипит при 100 °C, замерзает при 0 °C.', 'Boils at 100 °C, freezes at 0 °C.')],
  },
  {
    id: 'co2', life: L('Gazli suvdagi pufakchalar va quruq muz.', 'Пузырьки в газировке и «сухой лёд».', 'Bubbles in soda and dry ice.'), formula: 'CO₂', name: L('Karbonat angidrid', 'Углекислый газ', 'Carbon dioxide'),
    atoms: [{ el: 'C', p: [0, 0, 0] }, { el: 'O', p: [-1.16, 0, 0] }, { el: 'O', p: [1.16, 0, 0] }],
    bonds: [[0, 1, 2], [0, 2, 2]], state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Chiziqli molekula, 180°.', 'Линейная молекула, 180°.', 'Linear molecule, 180°.'), L('O‘simliklar fotosintezda yutadi.', 'Растения поглощают при фотосинтезе.', 'Plants absorb it in photosynthesis.')],
  },
  {
    id: 'ch4', life: L('Gaz plitasidagi ko‘k olov.', 'Голубое пламя газовой плиты.', 'The blue flame of a gas stove.'), formula: 'CH₄', name: L('Metan', 'Метан', 'Methane'),
    atoms: [{ el: 'C', p: [0, 0, 0] }, { el: 'H', p: [0.63, 0.63, 0.63] }, { el: 'H', p: [-0.63, -0.63, 0.63] }, { el: 'H', p: [-0.63, 0.63, -0.63] }, { el: 'H', p: [0.63, -0.63, -0.63] }],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4]], state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Tetraedr, burchak 109,5°.', 'Тетраэдр, угол 109,5°.', 'Tetrahedron, 109.5°.'), L('Tabiiy gazning asosi.', 'Основа природного газа.', 'Main part of natural gas.')],
    danger: L('Yonuvchan.', 'Горючий.', 'Flammable.'),
  },
  {
    id: 'nh3', life: L('Novshadil spirti hidi, o‘g‘itlar.', 'Запах нашатырного спирта, удобрения.', 'Smell of smelling salts, fertilisers.'), formula: 'NH₃', name: L('Ammiak', 'Аммиак', 'Ammonia'),
    atoms: [{ el: 'N', p: [0, 0.3, 0] }, { el: 'H', p: [0.94, -0.08, 0] }, { el: 'H', p: [-0.47, -0.08, 0.81] }, { el: 'H', p: [-0.47, -0.08, -0.81] }],
    bonds: [[0, 1], [0, 2], [0, 3]], state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Piramida shakli, 107°.', 'Пирамидальная форма, 107°.', 'Pyramid shape, 107°.'), L('O‘g‘itlar ishlab chiqarishda.', 'Используется для удобрений.', 'Used to make fertilisers.')],
    danger: L('O‘tkir hidli, zaharli.', 'Резкий запах, ядовит.', 'Pungent, toxic.'),
  },
  {
    id: 'hcl', life: L('Me’da shirasi; suvdagi eritmasi — xlorid kislota.', 'Желудочный сок; раствор в воде — соляная кислота.', 'Stomach acid; dissolved in water it is hydrochloric acid.'), formula: 'HCl', name: L('Xlorid kislota', 'Хлороводород', 'Hydrogen chloride'),
    atoms: [{ el: 'H', p: [-0.64, 0, 0] }, { el: 'Cl', p: [0.64, 0, 0] }], bonds: [[0, 1]],
    state: L('Gaz (suvda — kislota)', 'Газ (в воде — кислота)', 'Gas (acid in water)'),
    facts: [L('Me’da shirasida bor.', 'Есть в желудочном соке.', 'Found in stomach acid.')],
    danger: L('Kuchli kislota.', 'Сильная кислота.', 'Strong acid.'),
  },
  {
    id: 'nacl', life: L('Oshxonadagi tuz — oq kub kristallar.', 'Соль на кухне — белые кубические кристаллы.', 'Kitchen salt — white cubic crystals.'), formula: 'NaCl', name: L('Osh tuzi', 'Поваренная соль', 'Table salt'),
    atoms: [{ el: 'Na', p: [-0.75, 0, 0] }, { el: 'Cl', p: [0.85, 0, 0] }], bonds: [[0, 1]],
    state: L('Qattiq kristall', 'Твёрдый кристалл', 'Solid crystal'),
    facts: [L('Ion bog‘: Na⁺ va Cl⁻.', 'Ионная связь: Na⁺ и Cl⁻.', 'Ionic bond: Na⁺ and Cl⁻.'), L('801 °C da eriydi.', 'Плавится при 801 °C.', 'Melts at 801 °C.')],
  },
  {
    id: 'naoh', life: L('Sovun va quvur tozalagich.', 'Мыло и средство для прочистки труб.', 'Soap and drain cleaner.'), formula: 'NaOH', name: L('O‘yuvchi natriy', 'Гидроксид натрия', 'Sodium hydroxide'),
    atoms: [{ el: 'Na', p: [-1.2, 0, 0] }, { el: 'O', p: [0.3, 0, 0] }, { el: 'H', p: [1.05, 0.5, 0] }],
    bonds: [[0, 1], [1, 2]], state: L('Qattiq', 'Твёрдое вещество', 'Solid'),
    facts: [L('Kuchli ishqor.', 'Сильная щёлочь.', 'Strong base.'), L('Sovun tayyorlashda.', 'Используется для мыла.', 'Used to make soap.')],
    danger: L('Terini kuydiradi.', 'Разъедает кожу.', 'Burns skin.'),
  },
  {
    id: 'h2s', life: L('Vulqonlar va mineral buloqlar yaqinidagi hid.', 'Запах у вулканов и минеральных источников.', 'The smell near volcanoes and hot springs.'), formula: 'H₂S', name: L('Vodorod sulfid', 'Сероводород', 'Hydrogen sulfide'),
    atoms: [{ el: 'S', p: [0, 0, 0] }, { el: 'H', p: [-0.96, 0.65, 0] }, { el: 'H', p: [0.96, 0.65, 0] }],
    bonds: [[0, 1], [0, 2]], state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Chirigan tuxum hidi.', 'Запах тухлых яиц.', 'Smells of rotten eggs.')],
    danger: L('Zaharli.', 'Ядовит.', 'Toxic.'),
  },
  {
    id: 'so2', life: L('Vulqon tutuni, quritilgan mevalarni saqlash.', 'Вулканический дым, консервирование сухофруктов.', 'Volcanic smoke, preserving dried fruit.'), formula: 'SO₂', name: L('Oltingugurt dioksidi', 'Сернистый газ', 'Sulfur dioxide'),
    atoms: [{ el: 'S', p: [0, 0.2, 0] }, { el: 'O', p: [-1.24, -0.45, 0] }, { el: 'O', p: [1.24, -0.45, 0] }],
    bonds: [[0, 1, 2], [0, 2, 2]], state: L('Gaz', 'Газ', 'Gas'),
    facts: [L('Burchak 119°.', 'Угол 119°.', 'Angle 119°.'), L('Kislotali yomg‘ir sababi.', 'Причина кислотных дождей.', 'Causes acid rain.')],
  },
  {
    id: 'c2h5oh', life: L('Dezinfeksiya vositasi, ko‘k olov bilan yonadi.', 'Антисептик, горит голубым пламенем.', 'Hand sanitiser, burns with a blue flame.'), formula: 'C₂H₅OH', name: L('Etanol', 'Этанол', 'Ethanol'),
    atoms: [
      { el: 'C', p: [-0.75, 0, 0] }, { el: 'C', p: [0.75, 0, 0] }, { el: 'O', p: [1.4, 1.15, 0] },
      { el: 'H', p: [2.3, 1.05, 0] }, { el: 'H', p: [-1.15, 1.0, 0.1] }, { el: 'H', p: [-1.15, -0.5, 0.85] },
      { el: 'H', p: [-1.15, -0.5, -0.85] }, { el: 'H', p: [1.1, -0.55, 0.85] }, { el: 'H', p: [1.1, -0.55, -0.85] },
    ],
    bonds: [[0, 1], [1, 2], [2, 3], [0, 4], [0, 5], [0, 6], [1, 7], [1, 8]],
    state: L('Suyuqlik', 'Жидкость', 'Liquid'),
    facts: [L('78 °C da qaynaydi.', 'Кипит при 78 °C.', 'Boils at 78 °C.'), L('Dezinfeksiya uchun.', 'Используется для дезинфекции.', 'Used as a disinfectant.')],
    danger: L('Yonuvchan.', 'Горючий.', 'Flammable.'),
  },
];

/** Atom counts of a formula, used to match the built set. */
function countsOf(molecule: Molecule): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const atom of molecule.atoms) counts[atom.el] = (counts[atom.el] ?? 0) + 1;
  return counts;
}
const sameCounts = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys({ ...a, ...b }).every((key) => (a[key] ?? 0) === (b[key] ?? 0));

type Reaction = { a: string; b: string; equation: string; products: string[]; note: Txt; effect: 'flame' | 'bubbles' | 'heat' };
const REACTIONS: Reaction[] = [
  { a: 'h2', b: 'o2', equation: '2H₂ + O₂ → 2H₂O', products: ['h2o'], effect: 'flame', note: L('Yonish: ko‘p issiqlik ajraladi, suv hosil bo‘ladi.', 'Горение: выделяется много тепла, образуется вода.', 'Combustion: lots of heat, water forms.') },
  { a: 'ch4', b: 'o2', equation: 'CH₄ + 2O₂ → CO₂ + 2H₂O', products: ['co2', 'h2o'], effect: 'flame', note: L('Gaz plitasidagi olov — metanning yonishi.', 'Пламя газовой плиты — это горение метана.', 'A gas stove flame is methane burning.') },
  { a: 'hcl', b: 'naoh', equation: 'HCl + NaOH → NaCl + H₂O', products: ['nacl', 'h2o'], effect: 'heat', note: L('Neytrallanish: kislota + ishqor = tuz + suv.', 'Нейтрализация: кислота + щёлочь = соль + вода.', 'Neutralisation: acid + base = salt + water.') },
  { a: 'n2', b: 'h2', equation: 'N₂ + 3H₂ ⇌ 2NH₃', products: ['nh3'], effect: 'heat', note: L('Gaber jarayoni: katalizator va yuqori bosim kerak.', 'Процесс Габера: нужен катализатор и высокое давление.', 'Haber process: needs a catalyst and high pressure.') },
  { a: 'h2s', b: 'o2', equation: '2H₂S + 3O₂ → 2SO₂ + 2H₂O', products: ['so2', 'h2o'], effect: 'flame', note: L('Vodorod sulfid yonib, sernistiy gaz beradi.', 'Сероводород сгорает, образуя сернистый газ.', 'Hydrogen sulfide burns to sulfur dioxide.') },
  { a: 'c2h5oh', b: 'o2', equation: 'C₂H₅OH + 3O₂ → 2CO₂ + 3H₂O', products: ['co2', 'h2o'], effect: 'flame', note: L('Spirt ko‘k alanga bilan yonadi.', 'Спирт горит синим пламенем.', 'Alcohol burns with a blue flame.') },
];

/* ------------------------------------------------------------------------ */
/* Ball-and-stick renderer (canvas, no WebGL needed — runs on weak PCs)       */
/* ------------------------------------------------------------------------ */

function MoleculeView({ molecule, height = 320 }: { molecule: Molecule; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const angle = useRef({ x: -0.35, y: 0.5, auto: true });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const center = molecule.atoms.reduce((acc, atom) => [acc[0] + atom.p[0], acc[1] + atom.p[1], acc[2] + atom.p[2]], [0, 0, 0]).map((v) => v / molecule.atoms.length);
    const extent = Math.max(0.85, ...molecule.atoms.map((atom) => Math.hypot(atom.p[0] - center[0], atom.p[1] - center[1], atom.p[2] - center[2])));

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== width * ratio) { canvas.width = width * ratio; canvas.height = h * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, h);
      if (angle.current.auto && !drag.current) angle.current.y += 0.008;
      const { x: ax, y: ay } = angle.current;
      const scale = (Math.min(width, h) * 0.4) / extent;
      const project = (p: [number, number, number]) => {
        let [x, y, z] = [p[0] - center[0], -(p[1] - center[1]), p[2] - center[2]];
        const cy = Math.cos(ay), sy = Math.sin(ay);
        [x, z] = [x * cy + z * sy, -x * sy + z * cy];
        const cx = Math.cos(ax), sx = Math.sin(ax);
        [y, z] = [y * cx - z * sx, y * sx + z * cx];
        const persp = 4 / (4 + z * 0.5);
        return { sx: width / 2 + x * scale * persp, sy: h / 2 + y * scale * persp, z, persp };
      };
      const projected = molecule.atoms.map((atom) => ({ atom, ...project(atom.p) }));
      // bonds first, sorted back to front
      const bonds = molecule.bonds.map(([a, b, order]) => ({ a: projected[a]!, b: projected[b]!, order: order ?? 1, z: (projected[a]!.z + projected[b]!.z) / 2 }));
      const items: Array<{ z: number; paint: () => void }> = [];
      for (const bond of bonds) {
        items.push({ z: bond.z - 0.01, paint: () => {
          const dx = bond.b.sx - bond.a.sx, dy = bond.b.sy - bond.a.sy;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-4, 4] : [-6, 0, 6];
          context.lineCap = 'round';
          for (const off of offsets) {
            context.strokeStyle = '#8E8E96';
            context.lineWidth = 5;
            context.beginPath();
            context.moveTo(bond.a.sx + nx * off, bond.a.sy + ny * off);
            context.lineTo(bond.b.sx + nx * off, bond.b.sy + ny * off);
            context.stroke();
          }
        } });
      }
      for (const item of projected) {
        items.push({ z: item.z, paint: () => {
          const info = ELEMENTS[item.atom.el];
          const radius = info.r * scale * 0.55 * item.persp;
          const gradient = context.createRadialGradient(item.sx - radius * 0.35, item.sy - radius * 0.35, radius * 0.1, item.sx, item.sy, radius);
          gradient.addColorStop(0, '#FFFFFF');
          gradient.addColorStop(0.25, info.color);
          gradient.addColorStop(1, shade(info.color));
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(item.sx, item.sy, radius, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = item.atom.el === 'H' ? '#1C1C21' : '#FFFFFF';
          context.font = `700 ${Math.max(10, radius * 0.7)}px DM Sans, sans-serif`;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(item.atom.el, item.sx, item.sy + 1);
        } });
      }
      items.sort((a, b) => b.z - a.z).forEach((item) => item.paint());
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [molecule]);

  return (
    <canvas
      ref={canvasRef}
      className="chem-canvas"
      style={{ height }}
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; angle.current.auto = false; (event.target as HTMLElement).setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        angle.current.y += (event.clientX - drag.current.x) * 0.01;
        angle.current.x += (event.clientY - drag.current.y) * 0.01;
        drag.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => { drag.current = null; }}
      onDoubleClick={() => { angle.current.auto = true; }}
    />
  );
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 90), g = Math.max(0, ((n >> 8) & 255) - 90), b = Math.max(0, (n & 255) - 90);
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------------------ */

export function ChemLabPage({ language }: { language: Language }) {
  const tx = (text: Txt) => text[language];
  const [subject, setSubject] = useState<'chem' | 'phys'>('chem');
  const [mode, setMode] = useState<'build' | 'react'>('build');
  const [counts, setCounts] = useState<Record<string, number>>({ H: 2, O: 1 });
  const [selected, setSelected] = useState<Molecule>(MOLECULES.find((m) => m.id === 'h2o')!);
  const [mixA, setMixA] = useState('h2');
  const [mixB, setMixB] = useState('o2');
  const [mixed, setMixed] = useState<Reaction | null | undefined>(undefined);
  const [animKey, setAnimKey] = useState(0);

  const match = useMemo(() => MOLECULES.find((molecule) => sameCounts(countsOf(molecule), counts)) ?? null, [counts]);
  const sandbox = useMemo(() => (match ? null : sandboxMolecule(counts)), [match, counts]);
  const report = useMemo(() => valenceReport(counts), [counts]);
  useEffect(() => {
    if (match) setSelected(match);
  }, [match]);
  const shown = match ?? sandbox ?? selected;

  const change = (el: El, delta: number) =>
    setCounts((current) => {
      const next = { ...current, [el]: Math.max(0, Math.min(9, (current[el] ?? 0) + delta)) };
      if (next[el] === 0) delete next[el];
      return next;
    });

  const formula = Object.entries(counts).map(([el, n]) => `${el}${n > 1 ? n : ''}`).join('') || '—';
  const mix = () => {
    const found = REACTIONS.find((r) => (r.a === mixA && r.b === mixB) || (r.a === mixB && r.b === mixA)) ?? null;
    setMixed(found);
    setAnimKey((k) => k + 1);
  };
  const byId = (id: string) => MOLECULES.find((m) => m.id === id)!;

  return (
    <section className="chem-lab">
      <div className="page-heading">
        <div>
          <div className="row lab-subjects">
            <button type="button" className={`btn small ${subject === 'chem' ? 'primary' : ''}`} onClick={() => setSubject('chem')}>{tx(L('Kimyo', 'Химия', 'Chemistry'))}</button>
            <button type="button" className={`btn small ${subject === 'phys' ? 'primary' : ''}`} onClick={() => setSubject('phys')}>{tx(L('Fizika', 'Физика', 'Physics'))}</button>
          </div>
          <h1>{tx(L('3D laboratoriya', '3D-лаборатория', '3D lab'))}</h1>
          <p className="page-subtitle">{tx(L(
            'Atomlarni yig‘ing — molekula 3D da paydo bo‘ladi. Moddalarni aralashtiring — reaksiyani ko‘ring.',
            'Соберите атомы — молекула появится в 3D. Смешайте вещества — увидите реакцию.',
            'Combine atoms — the molecule appears in 3D. Mix substances — watch the reaction.'))}</p>
        </div>
        {subject === 'chem' && <div className="row chem-tabs">
          <button type="button" className={`btn ${mode === 'build' ? 'primary' : ''}`} onClick={() => setMode('build')}><Atom /> {tx(L('Molekula yig‘ish', 'Собрать молекулу', 'Build a molecule'))}</button>
          <button type="button" className={`btn ${mode === 'react' ? 'primary' : ''}`} onClick={() => setMode('react')}><FlaskConical /> {tx(L('Reaksiya', 'Реакция', 'Reaction'))}</button>
        </div>}
      </div>

      {subject === 'phys' ? <PhysicsLab language={language} /> : mode === 'build' ? (
        <div className="chem-grid">
          <div className="panel chem-stage">
            <MoleculeView molecule={shown} />
            <div className="chem-caption">
              <b>{tx(shown.name)}</b> <span className="chem-formula">{shown.formula}</span>
              <span className="muted"> · {tx(L('aylantirish uchun torting', 'потяните, чтобы вращать', 'drag to rotate'))}</span>
            </div>
          </div>
          <div className="stack">
            <section className="panel">
              <div className="section-head"><h2>{tx(L('Atomlar', 'Атомы', 'Atoms'))}</h2>
                <button type="button" className="btn small" onClick={() => setCounts({})}><RotateCcw /> {tx(L('Tozalash', 'Сбросить', 'Reset'))}</button>
              </div>
              <div className="chem-atoms">
                {(Object.keys(ELEMENTS) as El[]).map((el) => (
                  <div className="chem-atom" key={el}>
                    <span className="chem-ball" style={{ background: ELEMENTS[el].color, color: el === 'H' ? '#1C1C21' : '#fff' }}>{el}</span>
                    <small>{tx(ELEMENTS[el].name)}</small>
                    <div className="chem-count">
                      <button type="button" className="btn small" onClick={() => change(el, -1)} aria-label="-"><Minus /></button>
                      <b>{counts[el] ?? 0}</b>
                      <button type="button" className="btn small" onClick={() => change(el, 1)} aria-label="+"><Plus /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className={`chem-result ${match ? 'ok' : ''}`}>
                <span>{formula}</span>
                <b>{match ? `= ${tx(match.name)}` : tx(L('Bunday modda ro‘yxatda yo‘q — AI dan so‘rang', 'Такого вещества нет в списке — спросите ИИ', 'Not in the list — ask the AI'))}</b>
              </div>
              {!match && sandbox && (
                <div className={`notice ${report.ok ? 'success' : ''}`}>
                  {report.ok
                    ? tx(L('Valentlik mos keladi: bunday molekula bo‘lishi mumkin. Nomini AI dan so‘rang.', 'Валентности сходятся: такая молекула может существовать. Спросите ИИ, как она называется.', 'Valences fit: such a molecule can exist. Ask the AI for its name.'))
                    : tx(L('Valentlik mos emas: atomlarda bo‘sh bog‘lar qoldi. Haqiqiy hayotda bunday zarracha barqaror emas — u boshqa atomlarni o‘ziga tortadi.', 'Валентности не сходятся: у атомов остались свободные связи. В реальной жизни такая частица неустойчива — она сразу притянет другие атомы.', 'Valences do not fit: free bonds remain. In real life such a particle is unstable and grabs other atoms.'))}
                </div>
              )}
            </section>
            {match && <RealLife molecule={match} language={language} />}
            <section className="panel">
              <div className="section-head"><h2>{tx(L('Xossalari', 'Свойства', 'Properties'))}</h2><span className="tag">{tx(selected.state)}</span></div>
              <ul className="chem-facts">{selected.facts.map((fact, i) => <li key={i}>{tx(fact)}</li>)}</ul>
              {selected.danger && <div className="notice" role="note">⚠ {tx(selected.danger)}</div>}
            </section>
            <div className="chem-presets">
              {MOLECULES.map((molecule) => (
                <button type="button" key={molecule.id} className={`tag ${molecule.id === selected.id ? 'gold' : ''}`} onClick={() => { setSelected(molecule); setCounts(countsOf(molecule)); }}>
                  {molecule.formula}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="chem-grid">
          <div className="panel chem-stage">
            <div className="chem-mix">
              <select className="input" value={mixA} onChange={(e) => { setMixA(e.target.value); setMixed(undefined); }}>
                {MOLECULES.map((m) => <option key={m.id} value={m.id}>{m.formula} · {tx(m.name)}</option>)}
              </select>
              <span className="chem-plus">+</span>
              <select className="input" value={mixB} onChange={(e) => { setMixB(e.target.value); setMixed(undefined); }}>
                {MOLECULES.map((m) => <option key={m.id} value={m.id}>{m.formula} · {tx(m.name)}</option>)}
              </select>
              <button type="button" className="btn primary" onClick={mix}><Sparkles /> {tx(L('Aralashtirish', 'Смешать', 'Mix'))}</button>
            </div>
            {mixed === undefined && (
              <div className="chem-flask-row">
                <div className="chem-mini"><MoleculeView molecule={byId(mixA)} height={180} /></div>
                <div className="chem-mini"><MoleculeView molecule={byId(mixB)} height={180} /></div>
              </div>
            )}
            {mixed && (
              <div className={`chem-reaction effect-${mixed.effect}`} key={animKey}>
                <div className="chem-equation">{mixed.equation}</div>
                <div className="chem-flask-row">
                  {mixed.products.map((id) => (
                    <div className="chem-mini" key={id}>
                      <MoleculeView molecule={byId(id)} height={180} />
                      <small>{byId(id).formula} · {tx(byId(id).name)}</small>
                    </div>
                  ))}
                </div>
                <p>{tx(mixed.note)}</p>
              </div>
            )}
            {mixed === null && (
              <div className="notice">{tx(L(
                'Bu moddalar oddiy sharoitda reaksiyaga kirmaydi yoki ro‘yxatda yo‘q. Pastdagi AI yordamchidan so‘rang.',
                'Эти вещества при обычных условиях не реагируют или реакции нет в списке. Спросите ИИ-помощника ниже.',
                'These do not react under normal conditions or the reaction is not listed. Ask the AI assistant below.'))}</div>
            )}
          </div>
          <div className="stack">
            <section className="panel">
              <div className="section-head"><h2>{tx(L('Mavjud reaksiyalar', 'Доступные реакции', 'Available reactions'))}</h2></div>
              <div className="stack">
                {REACTIONS.map((reaction) => (
                  <button type="button" key={reaction.equation} className="chem-reaction-pick" onClick={() => { setMixA(reaction.a); setMixB(reaction.b); setMixed(reaction); setAnimKey((k) => k + 1); }}>
                    {reaction.equation}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      <AiTutor language={language} topicId={null} />
    </section>
  );
}

void t;

/** "How it looks in real life": gas in a jar, liquid in a glass, or crystals. */
function RealLife({ molecule, language }: { molecule: Molecule; language: Language }) {
  const state = molecule.state.English.toLowerCase();
  const kind = state.startsWith('gas') ? 'gas' : state.startsWith('liquid') ? 'liquid' : 'solid';
  const tint = molecule.id === 'o2' ? '#9FC5FF' : molecule.id === 'h2s' || molecule.id === 'so2' ? '#E8DC8A' : molecule.id === 'c2h5oh' ? '#E8F0FF' : '#BFD8FF';
  return (
    <section className="panel real-life">
      <div className="section-head"><h2>{language === 'Uzbek' ? 'Haqiqiy hayotda' : language === 'Русский' ? 'В реальной жизни' : 'In real life'}</h2></div>
      <div className={`life-scene life-${kind}`} style={{ ['--tint' as string]: tint }} key={molecule.id}>
        <div className="life-vessel">
          {kind === 'gas' && Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${8 + ((i * 37) % 84)}%`, animationDelay: `${(i % 7) * 0.45}s`, animationDuration: `${3 + (i % 4)}s` }} />)}
          {kind === 'liquid' && <><div className="life-liquid" />{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ left: `${15 + i * 13}%`, animationDelay: `${i * 0.6}s` }} />)}</>}
          {kind === 'solid' && <div className="life-crystals">{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</div>}
        </div>
        <p>{molecule.life ? molecule.life[language] : ''}</p>
      </div>
    </section>
  );
}
