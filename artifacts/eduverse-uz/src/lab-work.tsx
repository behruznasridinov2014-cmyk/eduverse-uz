import { useCallback, useEffect, useRef, useState } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { ClipboardCheck, FlaskConical, Play, RotateCcw, Send, Square, Trash2 } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

type Row = { length: number; period: number };
const G = 9.81;
const SWINGS = 10;

/**
 * Virtual lab work: "Measure the acceleration of free fall with a pendulum".
 *
 * The student sets the length, starts the swing, measures the time of ten
 * swings with a stopwatch (a real human reaction error is part of the
 * experiment), records the row, then builds the T²(L) graph. The server
 * computes g from the raw data and grades the work — the teacher receives a
 * full report.
 */
export function PendulumLabWork({ language, user }: { language: Language; user: User }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [length, setLength] = useState(0.6);
  const [swinging, setSwinging] = useState(false);
  const [timing, setTiming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [conclusion, setConclusion] = useState('');
  const [result, setResult] = useState<{ g: number; errorPercent: number; grade: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sim = useRef({ theta: 0.17, omega: 0, start: 0 });
  const timer = useRef<{ started: number; frame: number } | null>(null);
  const isStudent = user.role === 'student';

  // pendulum animation
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = sim.current;
      if (swinging) {
        for (let i = 0; i < 6; i += 1) {
          s.omega += (-(G / length) * Math.sin(s.theta)) * (dt / 6);
          s.theta += s.omega * (dt / 6);
        }
      }
      const ratio = window.devicePixelRatio || 1;
      const w = element.clientWidth, h = element.clientHeight;
      if (element.width !== w * ratio) { element.width = w * ratio; element.height = h * ratio; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, w, h);
      const pivot = { x: w / 2, y: 26 };
      const px = (h - 70) / 1.5;
      const bob = { x: pivot.x + Math.sin(s.theta) * length * px, y: pivot.y + Math.cos(s.theta) * length * px };
      // stand
      context.fillStyle = '#3A3A42';
      context.fillRect(pivot.x - 90, pivot.y - 8, 180, 6);
      context.fillRect(pivot.x + 84, pivot.y - 8, 6, h - 30);
      // ruler
      context.strokeStyle = 'rgba(214,201,181,.35)';
      context.setLineDash([4, 6]);
      context.beginPath();
      context.moveTo(pivot.x, pivot.y);
      context.lineTo(pivot.x, pivot.y + length * px);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = '#A9A49A';
      context.font = '600 11px DM Sans, sans-serif';
      context.fillText(`L = ${length.toFixed(2)} m`, pivot.x + 8, pivot.y + (length * px) / 2);
      // string and bob
      context.strokeStyle = '#E8E2D6';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(pivot.x, pivot.y);
      context.lineTo(bob.x, bob.y);
      context.stroke();
      const grad = context.createRadialGradient(bob.x - 5, bob.y - 5, 2, bob.x, bob.y, 15);
      grad.addColorStop(0, '#FFF7E6');
      grad.addColorStop(0.35, '#C9A86A');
      grad.addColorStop(1, '#5A4422');
      context.fillStyle = grad;
      context.beginPath();
      context.arc(bob.x, bob.y, 15, 0, Math.PI * 2);
      context.fill();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [length, swinging]);

  useEffect(() => {
    sim.current = { theta: 0.17, omega: 0, start: 0 };
    setSwinging(false);
    stopTimer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length]);

  const tick = useCallback(() => {
    if (!timer.current) return;
    setElapsed((performance.now() - timer.current.started) / 1000);
    timer.current.frame = requestAnimationFrame(tick);
  }, []);

  function startTimer() {
    if (!swinging) setSwinging(true);
    timer.current = { started: performance.now(), frame: 0 };
    setElapsed(0);
    setTiming(true);
    timer.current.frame = requestAnimationFrame(tick);
  }

  function stopTimer(record = true) {
    if (timer.current) cancelAnimationFrame(timer.current.frame);
    const total = timer.current ? (performance.now() - timer.current.started) / 1000 : 0;
    timer.current = null;
    setTiming(false);
    if (record && total > 0.5) {
      setElapsed(total);
      setRows((current) => [...current, { length, period: Math.round((total / SWINGS) * 1000) / 1000 }].slice(-8));
      setResult(null);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const response = await customFetch<{ g: number; errorPercent: number; grade: number }>('/api/labs/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lab: 'pendulum', rows, conclusion }),
      });
      setResult(response);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  // local preview of g (the server recomputes it)
  const preview = rows.length
    ? rows.map((row) => (4 * Math.PI * Math.PI * row.length) / (row.period * row.period)).reduce((a, b) => a + b, 0) / rows.length
    : null;

  return (
    <div className="labwork">
      <section className="panel labwork-task">
        <div className="section-head"><h2><FlaskConical size={16} /> {t(language, 'Laboratoriya ishi №1', 'Лабораторная работа №1', 'Lab work #1')}</h2><span className="tag gold">{t(language, '7–9-sinf', '7–9 класс', 'Grade 7–9')}</span></div>
        <p><b>{t(language, 'Mayatnik yordamida erkin tushish tezlanishini o‘lchash', 'Измерение ускорения свободного падения с помощью маятника', 'Measuring free-fall acceleration with a pendulum')}</b></p>
        <ol className="labwork-steps">
          <li>{t(language, 'Ip uzunligini tanlang.', 'Выберите длину нити.', 'Choose the string length.')}</li>
          <li>{t(language, `Sekundomerni ishga tushiring va ${SWINGS} ta to‘liq tebranishni sanang, keyin to‘xtating.`, `Запустите секундомер, отсчитайте ${SWINGS} полных колебаний и остановите.`, `Start the stopwatch, count ${SWINGS} full swings and stop it.`)}</li>
          <li>{t(language, 'Kamida 3 xil uzunlik bilan takrorlang.', 'Повторите минимум для 3 разных длин.', 'Repeat for at least 3 different lengths.')}</li>
          <li>{t(language, 'Grafik va xulosani tekshiring, ishni yuboring.', 'Проверьте график и вывод, отправьте работу.', 'Check the graph and conclusion, submit.')}</li>
        </ol>
      </section>

      <div className="chem-grid">
        <div className="panel chem-stage">
          <canvas ref={canvas} className="chem-canvas" style={{ height: 380 }} />
          <div className="labwork-stopwatch">
            <span className="labwork-time">{elapsed.toFixed(2)} s</span>
            {!timing ? (
              <button type="button" className="btn primary" onClick={startTimer}><Play size={15} /> {t(language, 'Sekundomer', 'Секундомер', 'Stopwatch')}</button>
            ) : (
              <button type="button" className="btn primary" onClick={() => stopTimer(true)}><Square size={15} /> {t(language, `To‘xtatish (${SWINGS} tebranish)`, `Стоп (${SWINGS} колебаний)`, `Stop (${SWINGS} swings)`)}</button>
            )}
            <button type="button" className="btn" onClick={() => { sim.current = { theta: 0.17, omega: 0, start: 0 }; setSwinging(true); }}><RotateCcw size={15} /> {t(language, 'Qo‘yib yuborish', 'Отпустить маятник', 'Release')}</button>
          </div>
        </div>
        <div className="stack">
          <section className="panel">
            <label className="lab-slider"><span>{t(language, 'Ip uzunligi L', 'Длина нити L', 'Length L')}<b>{length.toFixed(2)} m</b></span>
              <input type="range" min={0.2} max={1.4} step={0.05} value={length} onChange={(event) => setLength(Number(event.target.value))} disabled={timing} /></label>
            <table className="grade-table labwork-table">
              <thead><tr><th>№</th><th>L, m</th><th>T, s</th><th>T², s²</th><th /></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="muted">{t(language, 'O‘lchovlar hali yo‘q', 'Измерений пока нет', 'No measurements yet')}</td></tr>}
                {rows.map((row, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td><td>{row.length.toFixed(2)}</td><td>{row.period.toFixed(3)}</td><td>{(row.period ** 2).toFixed(3)}</td>
                    <td><button type="button" className="btn small" onClick={() => { setRows((current) => current.filter((_, i) => i !== index)); setResult(null); }} aria-label="del"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <Graph rows={rows} language={language} />
            {preview !== null && <div className="lab-value">g ≈ <b>{preview.toFixed(2)}</b> m/s²</div>}
          </section>
        </div>
      </div>

      {isStudent && (
        <section className="panel">
          <div className="section-head"><h2><ClipboardCheck size={16} /> {t(language, 'Xulosa va topshirish', 'Вывод и сдача', 'Conclusion and submit')}</h2></div>
          <textarea className="import-area" style={{ minHeight: 80 }} value={conclusion} onChange={(event) => setConclusion(event.target.value)} placeholder={t(language, 'Masalan: davr ip uzunligiga bog‘liq, g ≈ 9,8 m/s²…', 'Например: период зависит от длины нити, g ≈ 9,8 м/с²…', 'E.g.: the period depends on length, g ≈ 9.8 m/s²…')} />
          <button type="button" className="btn primary" disabled={busy || rows.length < 3} onClick={() => void submit()}><Send size={15} /> {t(language, 'O‘qituvchiga yuborish', 'Отправить учителю', 'Send to teacher')}</button>
          {rows.length < 3 && <p className="muted">{t(language, 'Kamida 3 ta o‘lchov kerak.', 'Нужно минимум 3 измерения.', 'At least 3 measurements are needed.')}</p>}
          {error && <div className="notice" role="alert">{error}</div>}
          {result && (
            <div className={`labwork-result grade-${result.grade}`}>
              <span className="grade-mark big">{result.grade}</span>
              <div>
                <b>g = {result.g} m/s² · {t(language, 'xato', 'погрешность', 'error')} {result.errorPercent}%</b>
                <p className="muted">{result.errorPercent <= 5
                  ? t(language, 'Ajoyib! Natija haqiqiy qiymatga juda yaqin.', 'Отлично! Результат очень близок к настоящему значению.', 'Excellent! Very close to the real value.')
                  : t(language, 'Sekundomerni aniqroq bosing va ko‘proq uzunliklarni sinab ko‘ring.', 'Нажимайте секундомер точнее и попробуйте больше разных длин.', 'Press the stopwatch more precisely and try more lengths.')}</p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Graph({ rows, language }: { rows: Row[]; language: Language }) {
  const w = 320, h = 200, pad = 34;
  const maxL = Math.max(1.5, ...rows.map((row) => row.length));
  const maxT2 = Math.max(6, ...rows.map((row) => row.period ** 2));
  const x = (l: number) => pad + (l / maxL) * (w - pad - 10);
  const y = (t2: number) => h - pad + 4 - (t2 / maxT2) * (h - pad - 10);
  const theory = (4 * Math.PI * Math.PI) / G;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="labwork-graph" role="img" aria-label="T²(L)">
      <line x1={pad} y1={h - pad + 4} x2={w - 6} y2={h - pad + 4} stroke="#5C5A55" />
      <line x1={pad} y1={8} x2={pad} y2={h - pad + 4} stroke="#5C5A55" />
      <text x={w - 10} y={h - 8} textAnchor="end" fill="#A9A49A" fontSize="11">L, m</text>
      <text x={6} y={14} fill="#A9A49A" fontSize="11">T², s²</text>
      <line x1={x(0)} y1={y(0)} x2={x(maxL)} y2={y(theory * maxL)} stroke="rgba(214,201,181,.45)" strokeDasharray="5 5" />
      <text x={x(maxL) - 4} y={Math.max(14, y(theory * maxL)) + 12} textAnchor="end" fill="#A9A49A" fontSize="10">{language === 'Русский' ? 'теория' : language === 'Uzbek' ? 'nazariya' : 'theory'}</text>
      {rows.map((row, index) => (
        <circle key={index} cx={x(row.length)} cy={y(row.period ** 2)} r={5} fill="#C9A86A" stroke="#17140F" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

type Report = { id: string; lab: string; result: string; errorPercent: number | null; grade: number | null; createdAt: string; studentName: string; data: { rows?: Row[]; conclusion?: string } };

/** Teacher view: every submitted lab report of the teacher's classes. */
export function LabReports({ language }: { language: Language }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  useEffect(() => {
    void customFetch<{ reports: Report[] }>('/api/labs/reports', { method: 'GET' }).then((response) => setReports(response.reports)).catch(() => setReports([]));
  }, []);
  if (!reports) return null;
  return (
    <section className="panel">
      <div className="section-head"><h2><FlaskConical size={16} /> {t(language, 'Laboratoriya ishlari', 'Лабораторные работы', 'Lab reports')}</h2><span className="tag">{reports.length}</span></div>
      {reports.length === 0 ? <p className="muted">{t(language, 'O‘quvchilar hali ish topshirmagan. Ular 3D studiya → Fizika → Laboratoriya ishi bo‘limida bajaradi.', 'Ученики ещё не сдавали работ. Они выполняют их в 3D-студии → Физика → Лабораторная работа.', 'No reports yet. Students do them in 3D studio → Physics → Lab work.')}</p> : (
        <table className="grade-table">
          <thead><tr><th>{t(language, 'O‘quvchi', 'Ученик', 'Student')}</th><th>{t(language, 'Natija', 'Результат', 'Result')}</th><th>{t(language, 'Xato', 'Погрешность', 'Error')}</th><th>{t(language, 'Baho', 'Оценка', 'Grade')}</th><th>{t(language, 'Xulosa', 'Вывод', 'Conclusion')}</th></tr></thead>
          <tbody>{reports.map((report) => (
            <tr key={report.id}>
              <td><b>{report.studentName}</b><br /><span className="muted">{new Date(report.createdAt).toLocaleDateString(language === 'Русский' ? 'ru-RU' : 'en-GB')}</span></td>
              <td>{report.result}<br /><span className="muted">{report.data.rows?.length ?? 0} {t(language, 'o‘lchov', 'изм.', 'meas.')}</span></td>
              <td>{report.errorPercent ?? '—'}%</td>
              <td>{report.grade ? <span className="grade-mark">{report.grade}</span> : '—'}</td>
              <td className="muted">{report.data.conclusion || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
