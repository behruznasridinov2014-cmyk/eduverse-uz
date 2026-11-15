import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Language } from './school-data';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/**
 * Car crash in slow motion (momentum and energy).
 *
 * Two cars drive towards each other (or one catches up with the other). The
 * collision follows the real 1D formulas with a coefficient of restitution e:
 *   v1' = (m1·v1 + m2·v2 + m2·e·(v2 − v1)) / (m1 + m2)
 *   v2' = (m1·v1 + m2·v2 + m1·e·(v1 − v2)) / (m1 + m2)
 * Momentum is always conserved; the "lost" kinetic energy goes into crumpling,
 * heat, sound and flying parts — so the number of sparks, glass shards, debris
 * and smoke grows with the lost energy. Particles live in the same slowed-down
 * time as the cars, so at 0.1× every shard can be followed by eye.
 */
type Car = { x: number; v: number; m: number; len: number; crumple: number; color: string };
type Kind = 'spark' | 'glass' | 'debris' | 'smoke' | 'dust';
type Particle = { kind: Kind; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; spin: number; angle: number; color: string; resting: boolean };
type Phase = 'approach' | 'impact' | 'braking' | 'stopped';

const ROAD = 60; // metres shown
const G = 9.81;
const MAX_PARTICLES = 900;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function CollisionLab({ language, compact = false }: { language: Language; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [m1, setM1] = useState(1200);
  const [m2, setM2] = useState(1500);
  const [v1, setV1] = useState(15);
  const [v2, setV2] = useState(-10);
  const [e, setE] = useState(0.2);
  const [mu, setMu] = useState(0.6);
  const [slow, setSlow] = useState(0.25);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState<Phase>('approach');
  const [result, setResult] = useState<null | { p0: number; p1: number; k0: number; k1: number; u1: number; u2: number; parts: number }>(null);
  const sim = useRef({
    cars: [] as Car[], collided: false, time: 0, particles: [] as Particle[], skids: [] as Array<[number, number]>,
    shake: 0, flash: 0, ring: 0, impactX: 0, impactAt: 0, cam: { center: ROAD / 2, width: ROAD },
  });
  // Live settings: the animation reads them every frame, so sliders never restart the loop.
  const live = useRef({ running, slow, e, mu });
  live.current = { running, slow, e, mu };
  const phaseRef = useRef<Phase>('approach');

  const reset = () => {
    sim.current = {
      cars: [
        { x: 8, v: v1, m: m1, len: 4.4, crumple: 0, color: '#4BA3DB' },
        { x: ROAD - 12, v: v2, m: m2, len: 4.8, crumple: 0, color: '#D2B26E' },
      ],
      collided: false, time: 0, particles: [], skids: [], shake: 0, flash: 0, ring: 0, impactX: 0, impactAt: 0, cam: { center: ROAD / 2, width: ROAD },
    };
    phaseRef.current = 'approach';
    setPhase('approach');
    setResult(null);
  };
  useEffect(reset, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Before the crash, new masses and speeds apply to the moving cars at once (no restart).
  useEffect(() => {
    const s = sim.current;
    if (s.collided || s.cars.length < 2) return;
    s.cars[0].m = m1; s.cars[0].v = v1;
    s.cars[1].m = m2; s.cars[1].v = v2;
  }, [m1, m2, v1, v2]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    let last = performance.now();

    const spawn = (s: typeof sim.current, x: number, lost: number, a: Car, b: Car) => {
      // amount grows with the energy turned into damage (≈ 120 particles at 30 kJ, capped)
      const scale = Math.min(1, Math.sqrt(lost / 400000));
      const n = (base: number) => Math.round(base * (0.35 + 0.65 * scale));
      const list: Particle[] = [];
      for (let i = 0; i < n(320); i += 1) {
        const speed = rand(4, 22);
        const dir = rand(-Math.PI, Math.PI);
        list.push({ kind: 'spark', x, y: rand(0.3, 1.2), z: rand(-0.6, 0.6), vx: Math.cos(dir) * speed, vy: Math.abs(Math.sin(dir)) * speed * 0.8 + rand(0, 4), vz: rand(-3, 3), life: rand(0.35, 1.1), max: 1, size: rand(1, 2.4), spin: 0, angle: 0, color: '', resting: false });
      }
      for (let i = 0; i < n(110); i += 1) {
        list.push({ kind: 'glass', x: x + rand(-0.4, 0.4), y: rand(0.8, 1.5), z: rand(-0.5, 0.5), vx: rand(-9, 9), vy: rand(1, 7), vz: rand(-4, 4), life: rand(4, 7), max: 7, size: rand(2, 5), spin: rand(-14, 14), angle: rand(0, 6.3), color: Math.random() < 0.5 ? 'rgba(210,238,255,.95)' : 'rgba(170,215,245,.9)', resting: false });
      }
      for (let i = 0; i < n(70); i += 1) {
        const fromA = Math.random() < b.m / (a.m + b.m);
        list.push({ kind: 'debris', x: x + rand(-0.5, 0.5), y: rand(0.2, 1), z: rand(-0.5, 0.5), vx: (fromA ? -1 : 1) * rand(1, 8) + rand(-3, 3), vy: rand(1, 6), vz: rand(-3, 3), life: rand(5, 8), max: 8, size: rand(4, 9), spin: rand(-9, 9), angle: rand(0, 6.3), color: fromA ? a.color : b.color, resting: false });
      }
      for (let i = 0; i < n(46); i += 1) {
        list.push({ kind: 'smoke', x: x + rand(-0.8, 0.8), y: rand(0.4, 1.4), z: rand(-0.3, 0.3), vx: rand(-1.2, 1.2), vy: rand(0.4, 1.4), vz: 0, life: rand(2.5, 4.5), max: 4.5, size: rand(10, 22), spin: 0, angle: 0, color: '', resting: false });
      }
      for (let i = 0; i < n(40); i += 1) {
        list.push({ kind: 'dust', x: x + rand(-1.2, 1.2), y: 0.05, z: rand(-0.8, 0.8), vx: rand(-4, 4), vy: rand(0.2, 1.2), vz: rand(-1, 1), life: rand(1.5, 3), max: 3, size: rand(6, 14), spin: 0, angle: 0, color: '', resting: false });
      }
      s.particles = [...s.particles, ...list].slice(-MAX_PARTICLES);
      return list.length;
    };

    const step = (now: number) => {
      const real = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = sim.current;
      const { running, slow, e, mu } = live.current;
      const dt = running ? real * slow : 0;
      const [a, b] = s.cars;
      if (a && b && dt > 0) {
        for (const car of [a, b]) {
          car.x += car.v * dt;
          // friction only after the crash (the drivers brake / wheels block)
          if (s.collided && car.v !== 0) {
            const dv = mu * G * dt;
            car.v = Math.abs(car.v) <= dv ? 0 : car.v - Math.sign(car.v) * dv;
            if (car.v !== 0) s.skids.push([car.x + car.len * 0.2, car === a ? -0.35 : 0.35], [car.x + car.len * 0.8, car === a ? -0.35 : 0.35]);
          }
        }
        if (s.skids.length > 1600) s.skids.splice(0, s.skids.length - 1600);
        s.time += dt;
        if (!s.collided && a.x + a.len >= b.x) {
          s.collided = true;
          const p0 = a.m * a.v + b.m * b.v;
          const k0 = 0.5 * a.m * a.v ** 2 + 0.5 * b.m * b.v ** 2;
          const u1 = (a.m * a.v + b.m * b.v + b.m * e * (b.v - a.v)) / (a.m + b.m);
          const u2 = (a.m * a.v + b.m * b.v + a.m * e * (a.v - b.v)) / (a.m + b.m);
          const k1 = 0.5 * a.m * u1 ** 2 + 0.5 * b.m * u2 ** 2;
          const lost = Math.max(0, k0 - k1);
          // crumple depth grows with the absorbed energy (illustrative scale)
          const depth = Math.min(1.4, Math.sqrt(lost) / 260);
          a.crumple = depth * (b.m / (a.m + b.m));
          b.crumple = depth * (a.m / (a.m + b.m));
          a.v = u1;
          b.v = u2;
          b.x = a.x + a.len;
          s.impactX = a.x + a.len;
          s.impactAt = s.time;
          s.shake = Math.min(1, Math.sqrt(lost) / 500);
          s.flash = 1;
          s.ring = 0.001;
          const parts = spawn(s, s.impactX, lost, a, b);
          setResult({ p0, p1: a.m * u1 + b.m * u2, k0, k1, u1, u2, parts });
        }
        // particles
        for (const p of s.particles) {
          p.life -= dt;
          if (p.resting) continue;
          if (p.kind === 'smoke' || p.kind === 'dust') {
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.vx *= 1 - Math.min(1, dt * 0.8);
            p.size += dt * (p.kind === 'smoke' ? 9 : 6);
            continue;
          }
          p.vy -= G * dt * (p.kind === 'spark' ? 0.6 : 1);
          p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(-1, Math.min(1, p.z + p.vz * dt * 0.2));
          p.angle += p.spin * dt;
          if (p.y <= 0) {
            if (p.kind === 'spark') { p.life = 0; continue; }
            p.y = 0;
            // bounce, then slide and stop on the road
            p.vy = -p.vy * (p.kind === 'glass' ? 0.32 : 0.22);
            p.vx *= 0.55; p.vz *= 0.5; p.spin *= 0.5;
            if (Math.abs(p.vy) < 0.6) { p.vy = 0; p.vx *= 0.7; if (Math.abs(p.vx) < 0.25) { p.resting = true; p.spin = 0; } }
          }
        }
        s.particles = s.particles.filter((p) => p.life > 0 && p.x > -5 && p.x < ROAD + 5);
        if (s.ring > 0) s.ring += dt * 3;
        if (s.ring > 1) s.ring = 0;
      }
      // decay of screen effects in real (not slowed) time, so slow motion keeps them visible longer
      s.flash = Math.max(0, s.flash - real * (slow < 1 ? 1.2 : 3));
      s.shake = Math.max(0, s.shake - real * (slow < 1 ? 0.8 : 2.4));

      const nextPhase: Phase = !s.collided ? 'approach' : s.time - s.impactAt < 0.25 ? 'impact' : a && b && (a.v !== 0 || b.v !== 0) ? 'braking' : 'stopped';
      if (nextPhase !== phaseRef.current) { phaseRef.current = nextPhase; setPhase(nextPhase); }

      // ---- draw ----
      const ratio = window.devicePixelRatio || 1;
      const w = element.clientWidth, h = element.clientHeight;
      if (element.width !== Math.round(w * ratio) || element.height !== Math.round(h * ratio)) { element.width = Math.round(w * ratio); element.height = Math.round(h * ratio); }
      const shakeX = s.shake ? (Math.random() - 0.5) * 10 * s.shake : 0;
      const shakeY = s.shake ? (Math.random() - 0.5) * 6 * s.shake : 0;
      context.setTransform(ratio, 0, 0, ratio, shakeX * ratio, shakeY * ratio);
      const sky = context.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#CFE8F8');
      sky.addColorStop(0.55, '#F4EEE2');
      sky.addColorStop(1, '#E9DFCB');
      context.fillStyle = sky;
      context.fillRect(-12, -12, w + 24, h + 24);
      const groundY = h * 0.7;
      // camera: follows both cars and zooms in as they get close, so the impact fills the screen
      if (a && b) {
        const ca = a.x + a.len / 2, cb = b.x + b.len / 2;
        const targetWidth = Math.max(16, Math.min(ROAD, Math.abs(cb - ca) + 18));
        const targetCenter = (ca + cb) / 2;
        const k = Math.min(1, real * 2.6);
        s.cam.width += (targetWidth - s.cam.width) * k;
        s.cam.center += (targetCenter - s.cam.center) * k;
      }
      const px = w / s.cam.width;
      const camLeft = s.cam.center - s.cam.width / 2;
      const zoom = Math.min(2.8, s.cam.width ? ROAD / s.cam.width : 1) * Math.min(1.3, w / 760);
      // road: far lane (top strip) and near lane
      context.fillStyle = '#7A808C';
      context.fillRect(-12, groundY - 26, w + 24, 26);
      context.fillStyle = '#5E6470';
      context.fillRect(-12, groundY, w + 24, 46);
      context.strokeStyle = 'rgba(255,255,255,.85)';
      context.setLineDash([18, 16]);
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(0, groundY + 22);
      context.lineTo(w, groundY + 22);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = 'rgba(30,38,51,.55)';
      context.font = '600 10px DM Sans, sans-serif';
      const markStep = s.cam.width < 30 ? 5 : 10;
      for (let m = Math.ceil(camLeft / markStep) * markStep; m <= camLeft + s.cam.width; m += markStep) context.fillText(`${m} m`, (m - camLeft) * px + 2, groundY + 60);
      // projection: z = road depth (−1 far … +1 near), y = height in metres
      const sx = (x: number) => (x - camLeft) * px;
      const sy = (y: number, z: number) => groundY - 8 * zoom + z * 13 - y * 15 * zoom;
      // skid marks
      context.fillStyle = 'rgba(20,22,28,.28)';
      for (const [x, z] of s.skids) context.fillRect(sx(x) - 1.5 * zoom, sy(0, z) + 4 * zoom, 3 * zoom, 2.2 * zoom);

      const behind = s.particles.filter((p) => p.z < 0);
      const front = s.particles.filter((p) => p.z >= 0);
      const drawParticles = (list: Particle[]) => {
        for (const p of list) {
          const x = sx(p.x), y = sy(p.y, p.z);
          const fade = Math.max(0, Math.min(1, p.life / (p.kind === 'spark' ? 0.4 : 1.2)));
          if (p.kind === 'spark') continue; // sparks are drawn last with additive light
          if (p.kind === 'smoke' || p.kind === 'dust') {
            const alpha = (p.kind === 'smoke' ? 0.32 : 0.22) * Math.min(1, p.life / p.max * 1.6);
            const radius = p.size * zoom;
            const g = context.createRadialGradient(x, y, 0, x, y, radius);
            const base = p.kind === 'smoke' ? '110,112,120' : '170,150,120';
            g.addColorStop(0, `rgba(${base},${alpha})`);
            g.addColorStop(1, `rgba(${base},0)`);
            context.fillStyle = g;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
            continue;
          }
          context.save();
          context.translate(x, y);
          context.rotate(p.angle);
          context.scale(zoom, zoom);
          context.globalAlpha = fade;
          if (p.kind === 'glass') {
            context.fillStyle = p.color;
            context.beginPath();
            context.moveTo(-p.size / 2, p.size / 3);
            context.lineTo(p.size / 2, p.size / 2);
            context.lineTo(0, -p.size / 2);
            context.closePath();
            context.fill();
            context.strokeStyle = 'rgba(255,255,255,.9)';
            context.lineWidth = 0.6;
            context.stroke();
          } else {
            context.fillStyle = p.color;
            context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            context.fillStyle = 'rgba(0,0,0,.25)';
            context.fillRect(-p.size / 2, p.size / 8, p.size, p.size / 8);
          }
          context.restore();
        }
        context.globalAlpha = 1;
      };
      drawParticles(behind);

      const drawCar = (car: Car, facing: 1 | -1, label: string) => {
        const len = Math.max(1.6, car.len - car.crumple) * px;
        const x = sx(car.x) + (facing === -1 ? car.crumple * px : 0);
        const bodyH = 26 * zoom, depth = 16 * zoom, roofH = 18 * zoom, wheel = 8 * zoom;
        const y = groundY - wheel - bodyH;
        const shade = (hex: string, k: number) => {
          const n = parseInt(hex.slice(1), 16);
          const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
          return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
        };
        context.fillStyle = 'rgba(0,0,0,.18)';
        context.beginPath();
        context.ellipse(x + len / 2, groundY - 2, len / 2 + 4, 6 * zoom, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = shade(car.color, 1.15);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + depth, y - depth * 0.6);
        context.lineTo(x + len + depth, y - depth * 0.6);
        context.lineTo(x + len, y);
        context.closePath();
        context.fill();
        const body = context.createLinearGradient(0, y, 0, y + bodyH);
        body.addColorStop(0, shade(car.color, 1.1));
        body.addColorStop(1, shade(car.color, 0.8));
        context.fillStyle = body;
        context.fillRect(x, y, len, bodyH);
        // lights: headlight at the front, tail light at the back
        const frontX = facing === 1 ? x + len - 4 : x;
        const backX = facing === 1 ? x : x + len - 4;
        context.fillStyle = '#FFF4C2';
        context.fillRect(frontX, y + 6 * zoom, 4 * zoom, 6 * zoom);
        context.fillStyle = '#D2475A';
        context.fillRect(backX, y + 6 * zoom, 4 * zoom, 6 * zoom);
        if (car.crumple > 0) {
          context.fillStyle = 'rgba(30,38,51,.38)';
          const zone = Math.min(len * 0.35, car.crumple * px * 1.2);
          const zx = facing === 1 ? x + len - zone : x;
          context.beginPath();
          for (let i = 0; i <= 6; i += 1) {
            const yy = y + (bodyH / 6) * i;
            const xx = zx + (i % 2 ? zone : zone * 0.4);
            if (i === 0) context.moveTo(xx, yy); else context.lineTo(xx, yy);
          }
          context.lineTo(zx + (facing === 1 ? zone : 0), y + bodyH);
          context.lineTo(zx + (facing === 1 ? zone : 0), y);
          context.fill();
        }
        const cabX = x + len * 0.22, cabW = len * 0.5;
        context.fillStyle = shade(car.color, 0.85);
        context.beginPath();
        context.moveTo(cabX, y);
        context.lineTo(cabX + cabW * 0.18, y - roofH);
        context.lineTo(cabX + cabW * 0.82, y - roofH);
        context.lineTo(cabX + cabW, y);
        context.closePath();
        context.fill();
        context.fillStyle = car.crumple > 0.3 ? 'rgba(200,225,240,.55)' : 'rgba(220,240,252,.92)';
        context.fillRect(cabX + cabW * 0.25, y - roofH + 4 * zoom, cabW * 0.5, roofH - 6 * zoom);
        if (car.crumple > 0.3) {
          // cracked windscreen
          context.strokeStyle = 'rgba(255,255,255,.9)';
          context.lineWidth = 0.8;
          const cx = cabX + cabW * 0.5, cy = y - roofH / 2 + 1;
          for (let i = 0; i < 6; i += 1) { context.beginPath(); context.moveTo(cx, cy); context.lineTo(cx + Math.cos(i) * 9 * zoom, cy + Math.sin(i * 1.7) * 6 * zoom); context.stroke(); }
        }
        context.fillStyle = '#1E2633';
        for (const wx of [x + len * 0.2, x + len * 0.8]) {
          context.beginPath(); context.arc(wx, groundY - wheel, wheel, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#A9B0BC';
          context.beginPath(); context.arc(wx, groundY - wheel, wheel * 0.38, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#1E2633';
        }
        // label and velocity arrow
        context.font = '700 11px DM Sans, sans-serif';
        context.fillStyle = '#1E2633';
        context.fillText(label, x + 2, groundY + (facing === 1 ? 14 : 38));
        if (Math.abs(car.v) > 0.05) {
          const ax = x + len / 2, ay = y - roofH - 14 - (facing === 1 ? 0 : 18), lenA = Math.min(80, Math.abs(car.v) * 3.2) * Math.sign(car.v);
          context.strokeStyle = '#1E2633';
          context.lineWidth = 2.5;
          context.beginPath(); context.moveTo(ax, ay); context.lineTo(ax + lenA, ay); context.stroke();
          context.beginPath();
          context.moveTo(ax + lenA, ay);
          context.lineTo(ax + lenA - Math.sign(lenA) * 8, ay - 5);
          context.lineTo(ax + lenA - Math.sign(lenA) * 8, ay + 5);
          context.fill();
          context.fillText(`${(car.v * 3.6).toFixed(0)} km/h`, ax + lenA / 2 - 22, ay - 6);
        }
      };
      const [c1, c2] = s.cars;
      if (c1) drawCar(c1, 1, `m₁ = ${c1.m} kg`);
      if (c2) drawCar(c2, -1, `m₂ = ${c2.m} kg`);
      drawParticles(front);

      // shockwave ring
      if (s.ring > 0) {
        context.strokeStyle = `rgba(255,255,255,${0.7 * (1 - s.ring)})`;
        context.lineWidth = 3 * (1 - s.ring) + 0.5;
        context.beginPath();
        context.ellipse(sx(s.impactX), sy(0.9, 0), (10 + s.ring * 140) * zoom, (6 + s.ring * 60) * zoom, 0, 0, Math.PI * 2);
        context.stroke();
      }
      // sparks: additive light with short motion streaks
      context.globalCompositeOperation = 'lighter';
      for (const p of s.particles) {
        if (p.kind !== 'spark') continue;
        const x = sx(p.x), y = sy(p.y, p.z);
        const k = Math.max(0, Math.min(1, p.life / 0.5));
        context.strokeStyle = `rgba(255, ${170 + Math.round(k * 80)}, ${80 + Math.round(k * 120)}, ${k})`;
        context.lineWidth = p.size * Math.min(1.8, zoom);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - p.vx * px * 0.012, y + p.vy * 15 * zoom * 0.012);
        context.stroke();
      }
      if (s.flash > 0) {
        const g = context.createRadialGradient(sx(s.impactX), sy(0.9, 0), 0, sx(s.impactX), sy(0.9, 0), 120 * zoom);
        g.addColorStop(0, `rgba(255,240,200,${0.8 * s.flash})`);
        g.addColorStop(1, 'rgba(255,240,200,0)');
        context.fillStyle = g;
        context.fillRect(sx(s.impactX) - 120 * zoom, sy(0.9, 0) - 120 * zoom, 240 * zoom, 240 * zoom);
      }
      context.globalCompositeOperation = 'source-over';

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = 'rgba(255,255,255,.88)';
      context.fillRect(10, 10, 150, 26);
      context.fillStyle = '#1E2633';
      context.font = '700 12px DM Sans, sans-serif';
      context.fillText(`${slow === 1 ? '▶ 1×' : `🐢 ${slow}×`}  t = ${s.time.toFixed(2)} s`, 18, 28);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  const slider = (label: string, value: number, min: number, max: number, stepValue: number, unit: string, set: (n: number) => void) => (
    <label className="lab-slider"><span>{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={stepValue} value={value} onChange={(event) => set(Number(event.target.value))} /></label>
  );
  const phases: Array<[Phase, string]> = [
    ['approach', t(language, '1. Yaqinlashish', '1. Сближение', '1. Approach')],
    ['impact', t(language, '2. Zarba', '2. Удар', '2. Impact')],
    ['braking', t(language, '3. Tormozlanish', '3. Торможение', '3. Braking')],
    ['stopped', t(language, '4. To‘xtadi', '4. Остановились', '4. Stopped')],
  ];
  const phaseNote: Record<Phase, string> = {
    approach: t(language, 'Impuls p = m·v. Ikkala mashinaning umumiy impulsi hisoblanadi.', 'Импульс p = m·v. Считаем общий импульс двух машин.', 'Momentum p = m·v. We add up the momentum of both cars.'),
    impact: t(language, 'Zarba! Energiyaning bir qismi ezilish, issiqlik, ovoz va uchgan bo‘laklarga o‘tadi.', 'Удар! Часть энергии уходит на смятие, тепло, звук и разлетающиеся детали.', 'Impact! Part of the energy turns into crumpling, heat, sound and flying parts.'),
    braking: t(language, 'Ishqalanish kuchi F = μ·m·g mashinalarni to‘xtatadi — yo‘lda iz qoladi.', 'Сила трения F = μ·m·g тормозит машины — на дороге остаются следы.', 'Friction F = μ·m·g stops the cars — skid marks stay on the road.'),
    stopped: t(language, 'Impuls zarbadan oldin va keyin bir xil. Energiya esa kamaydi.', 'Импульс до и после удара одинаковый. А энергия уменьшилась.', 'Momentum is the same before and after the impact. Energy is not.'),
  };
  return (
    <div className={compact ? 'stack' : 'chem-grid'}>
      <div className="panel chem-stage collision-stage">
        <canvas ref={canvas} className="chem-canvas" style={{ height: compact ? 270 : 340 }} />
        <div className="collision-phases">
          {phases.map(([key, label]) => <span key={key} className={phase === key ? 'active' : ''}>{label}</span>)}
        </div>
        <p className="collision-note">{phaseNote[phase]}</p>
        <div className="labwork-stopwatch">
          <button type="button" className="btn primary" onClick={() => { reset(); setRunning(true); }}><RotateCcw size={15} /> {t(language, 'Qaytadan', 'Заново', 'Replay')}</button>
          <button type="button" className="btn" onClick={() => setRunning((value) => !value)} aria-label={running ? 'Pause' : 'Play'}>{running ? <Pause size={15} /> : <Play size={15} />}</button>
          {[1, 0.25, 0.1].map((value) => (
            <button type="button" key={value} className={`btn small ${slow === value ? 'primary' : ''}`} onClick={() => setSlow(value)}>{value === 1 ? '1×' : `${value}×`}</button>
          ))}
        </div>
      </div>
      <div className="stack">
        <section className="panel">
          {slider(t(language, '1-mashina massasi', 'Масса машины 1', 'Car 1 mass'), m1, 600, 3000, 100, ' kg', setM1)}
          {slider(t(language, '1-mashina tezligi', 'Скорость машины 1', 'Car 1 speed'), v1, 0, 30, 1, ' m/s', setV1)}
          {slider(t(language, '2-mashina massasi', 'Масса машины 2', 'Car 2 mass'), m2, 600, 3000, 100, ' kg', setM2)}
          {slider(t(language, '2-mashina tezligi (− = qarshi)', 'Скорость машины 2 (− = навстречу)', 'Car 2 speed (− = towards)'), v2, -30, 10, 1, ' m/s', setV2)}
          {slider(t(language, 'Zarba elastikligi e', 'Упругость удара e', 'Elasticity e'), e, 0, 1, 0.05, '', setE)}
          {slider(t(language, 'Yo‘l ishqalanishi μ', 'Трение дороги μ', 'Road friction μ'), mu, 0.1, 0.9, 0.05, '', setMu)}
          {result && <p className="muted" style={{ margin: '8px 0 0' }}>{t(language, 'Yangi qiymatlar bilan ko‘rish uchun «Qaytadan» ni bosing.', 'Чтобы увидеть удар с новыми значениями, нажмите «Заново».', 'Press “Replay” to see the crash with the new values.')}</p>}
        </section>
        <section className="panel lab-result">
          <div className="lab-formula">p = m·v · E = m·v²/2</div>
          {result ? (
            <>
              <div className="collision-table">
                <span />
                <b>{t(language, 'Oldin', 'До', 'Before')}</b>
                <b>{t(language, 'Keyin', 'После', 'After')}</b>
                <span>{t(language, 'Impuls p', 'Импульс p', 'Momentum p')}</span>
                <span>{Math.round(result.p0).toLocaleString()} kg·m/s</span>
                <span>{Math.round(result.p1).toLocaleString()} kg·m/s</span>
                <span>{t(language, 'Kinetik energiya', 'Кинетическая энергия', 'Kinetic energy')}</span>
                <span>{(result.k0 / 1000).toFixed(1)} kJ</span>
                <span>{(result.k1 / 1000).toFixed(1)} kJ</span>
              </div>
              <div className="energy-split" aria-hidden="true">
                <span style={{ width: `${(result.k1 / Math.max(1, result.k0)) * 100}%` }} />
              </div>
              <p className="muted">{t(language,
                `Impuls saqlandi. ${((1 - result.k1 / Math.max(1, result.k0)) * 100).toFixed(0)}% energiya ezilishga, issiqlikka va ${result.parts} ta uchgan bo‘lakka ketdi.`,
                `Импульс сохранился. ${((1 - result.k1 / Math.max(1, result.k0)) * 100).toFixed(0)}% энергии ушло на смятие, нагрев и ${result.parts} разлетевшихся частиц.`,
                `Momentum is conserved. ${((1 - result.k1 / Math.max(1, result.k0)) * 100).toFixed(0)}% of the energy went into crumpling, heat and ${result.parts} flying particles.`)}</p>
            </>
          ) : (
            <p className="muted">{t(language, 'To‘qnashuvni kuting…', 'Дождитесь столкновения…', 'Wait for the collision…')}</p>
          )}
          <p className="muted">{t(language,
            'Nima uchun avtomobillarda deformatsiya zonasi bor? Zarba energiyasini yutib, yo‘lovchilarni himoya qiladi.',
            'Зачем у машин зона деформации? Она поглощает энергию удара и спасает пассажиров.',
            'Why do cars have crumple zones? They absorb the crash energy and protect passengers.')}</p>
        </section>
      </div>
    </div>
  );
}
