import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Bell, ClipboardList, Download, FileSpreadsheet, Printer, Send, Sparkles, Upload } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* -------------------------------------------------------------------------- */
/* 1. Import a school from Excel (copy-paste of the table)                     */
/* -------------------------------------------------------------------------- */

type Role = 'student' | 'teacher' | 'parent';
type Row = { role: Role; name: string; className?: string; childName?: string };
type Credential = { role: Role; name: string; className: string; login: string; password: string };

function roleOf(value: string): Role | null {
  const v = value.trim().toLowerCase();
  if (/^(student|ученик|ученица|o['‘’`]?quvchi|oquvchi|talaba)/.test(v)) return 'student';
  if (/^(teacher|учитель|учительница|преподаватель|o['‘’`]?qituvchi|oqituvchi|ustoz)/.test(v)) return 'teacher';
  if (/^(parent|родитель|мама|папа|ота|она|ota-ona|ota ona)/.test(v)) return 'parent';
  return null;
}

/** Rows copied from Excel/Google Sheets are tab separated; CSV also works. */
export function parseTable(text: string): { rows: Row[]; errors: number[] } {
  const rows: Row[] = [];
  const errors: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/[;,]/)).map((cell) => cell.trim());
    const role = roleOf(cells[0] ?? '');
    if (!role) {
      // a header row is skipped silently
      if (index > 0) errors.push(index + 1);
      return;
    }
    const name = cells[1] ?? '';
    if (!name) {
      errors.push(index + 1);
      return;
    }
    rows.push({ role, name, className: cells[2] || undefined, childName: role === 'parent' ? cells[3] || cells[2] || undefined : undefined });
  });
  return { rows, errors };
}

const SAMPLE = `Роль\tФИО\tКласс\tРебёнок
ученик\tАзиз Каримов\t7-А
ученик\tМалика Юсупова\t7-А
учитель\tНодира Рахимова\t7-А
родитель\tКарим Каримов\t\tАзиз Каримов`;

export function SchoolImport({ schoolId, language }: { schoolId: string; language: Language }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Credential[]>([]);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseTable(text), [text]);
  const counts = useMemo(() => ({
    student: parsed.rows.filter((row) => row.role === 'student').length,
    teacher: parsed.rows.filter((row) => row.role === 'teacher').length,
    parent: parsed.rows.filter((row) => row.role === 'parent').length,
  }), [parsed]);

  async function run() {
    setBusy(true);
    setError('');
    setResult([]);
    setSkipped([]);
    const all: Credential[] = [];
    const missed: Array<{ name: string; reason: string }> = [];
    // Students and teachers go first so that parents find their children.
    const ordered = [...parsed.rows.filter((row) => row.role !== 'parent'), ...parsed.rows.filter((row) => row.role === 'parent')];
    try {
      for (let i = 0; i < ordered.length; i += 40) {
        const chunk = ordered.slice(i, i + 40);
        const response = await customFetch<{ created: Credential[]; skipped: Array<{ name: string; reason: string }> }>(`/api/schools/${schoolId}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        all.push(...response.created);
        missed.push(...response.skipped);
        setProgress(Math.round(((i + chunk.length) / ordered.length) * 100));
      }
      setText('');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setResult(all);
      setSkipped(missed);
      setBusy(false);
    }
  }

  function downloadCsv() {
    const header = 'role;name;class;login;password';
    const body = result.map((row) => [row.role, row.name, row.className, row.login, row.password].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'eduverse-logins.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const roleName = (role: Role) => role === 'student' ? t(language, 'O‘quvchi', 'Ученик', 'Student') : role === 'teacher' ? t(language, 'O‘qituvchi', 'Учитель', 'Teacher') : t(language, 'Ota-ona', 'Родитель', 'Parent');

  return (
    <section className="panel import-panel">
      <div className="section-head">
        <h2><FileSpreadsheet size={16} /> {t(language, 'Excel dan import', 'Импорт из Excel', 'Import from Excel')}</h2>
        <button type="button" className="btn small" onClick={() => setText(SAMPLE)}><ClipboardList size={14} /> {t(language, 'Namuna', 'Пример', 'Sample')}</button>
      </div>
      <p className="muted">{t(language,
        'Excel jadvalidan ustunlarni nusxalab qo‘ying: Rol · F.I.Sh. · Sinf · Farzand (ota-ona uchun). Loginlar va parollar avtomatik yaratiladi.',
        'Скопируйте из Excel столбцы и вставьте сюда: Роль · ФИО · Класс · Ребёнок (для родителя). Логины и пароли создадутся сами.',
        'Copy columns from Excel and paste here: Role · Full name · Class · Child (for parents). Logins and passwords are generated.')}</p>
      <textarea className="import-area" value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={SAMPLE} spellCheck={false} />
      {parsed.rows.length > 0 && (
        <div className="import-summary">
          <span className="tag">{t(language, 'O‘quvchilar', 'Учеников', 'Students')}: <b>{counts.student}</b></span>
          <span className="tag">{t(language, 'O‘qituvchilar', 'Учителей', 'Teachers')}: <b>{counts.teacher}</b></span>
          <span className="tag">{t(language, 'Ota-onalar', 'Родителей', 'Parents')}: <b>{counts.parent}</b></span>
          {parsed.errors.length > 0 && <span className="tag gold">{t(language, 'Tushunilmagan qatorlar', 'Непонятные строки', 'Unreadable rows')}: {parsed.errors.slice(0, 6).join(', ')}</span>}
        </div>
      )}
      <button type="button" className="btn primary" disabled={busy || parsed.rows.length === 0} onClick={() => void run()}>
        <Upload size={15} /> {busy ? `${progress}%` : t(language, 'Import qilish', 'Импортировать', 'Import')}
      </button>
      {busy && <div className="test-progress"><span style={{ width: `${progress}%` }} /></div>}
      {error && <div className="notice" role="alert">{error}</div>}
      {skipped.length > 0 && (
        <div className="notice">{t(language, 'O‘tkazib yuborildi', 'Пропущено', 'Skipped')}: {skipped.map((row) => `${row.name} (${row.reason === 'child-not-found' ? t(language, 'farzand topilmadi', 'ребёнок не найден', 'child not found') : t(language, 'takror', 'дубль', 'duplicate')})`).join(', ')}</div>
      )}
      {result.length > 0 && (
        <div className="import-result">
          <div className="row">
            <b>{t(language, `Yaratildi: ${result.length}`, `Создано: ${result.length}`, `Created: ${result.length}`)}</b>
            <button type="button" className="btn small" onClick={() => window.print()}><Printer size={14} /> {t(language, 'Kartochkalarni chop etish', 'Распечатать карточки', 'Print cards')}</button>
            <button type="button" className="btn small" onClick={downloadCsv}><Download size={14} /> CSV</button>
          </div>
          <p className="muted">{t(language, 'Parollar faqat hozir ko‘rinadi — chop eting yoki saqlang.', 'Пароли видны только сейчас — распечатайте или сохраните.', 'Passwords are shown only now — print or save them.')}</p>
          <div className="login-cards">
            {result.map((row) => (
              <div className="login-card" key={row.login}>
                <small>EDUVERSE · {roleName(row.role)}{row.className ? ` · ${row.className}` : ''}</small>
                <b>{row.name}</b>
                <span>{t(language, 'Login', 'Логин', 'Login')}: <code>{row.login}</code></span>
                <span>{t(language, 'Parol', 'Пароль', 'Password')}: <code>{row.password}</code></span>
                <small>{window.location.host}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Telegram notifications                                                   */
/* -------------------------------------------------------------------------- */

export function TelegramConnect({ language }: { language: Language }) {
  const [state, setState] = useState<{ available: boolean; connected: boolean } | null>(null);
  const [error, setError] = useState('');
  const load = () => customFetch<{ available: boolean; connected: boolean }>('/api/me/telegram', { method: 'GET' }).then(setState).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function connect() {
    setError('');
    try {
      const response = await customFetch<{ link: string }>('/api/me/telegram/link', { method: 'POST' });
      window.open(response.link, '_blank', 'noopener');
      // The bot confirms within seconds; the status refreshes when the user returns.
      const onFocus = () => { void load(); window.removeEventListener('focus', onFocus); };
      window.addEventListener('focus', onFocus);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }
  async function disconnect() {
    await customFetch('/api/me/telegram', { method: 'DELETE' }).catch(() => {});
    void load();
  }

  if (!state) return null;
  return (
    <section className="panel">
      <div className="section-head">
        <h2><Bell size={16} /> {t(language, 'Telegram bildirishnomalari', 'Уведомления в Telegram', 'Telegram notifications')}</h2>
        {state.connected && <span className="tag green">{t(language, 'Ulangan', 'Подключено', 'Connected')}</span>}
      </div>
      <p className="muted">{t(language,
        'Darsga kelmaslik, yangi baho va sinf e’lonlari Telegramga keladi.',
        'Пропуски, новые оценки и объявления класса приходят в Telegram.',
        'Absences, new grades and class announcements arrive in Telegram.')}</p>
      {!state.available ? (
        <p className="muted">{t(language, 'Maktab hali Telegram botni ulamagan.', 'Школа ещё не подключила Telegram-бота.', 'The school has not connected the Telegram bot yet.')}</p>
      ) : state.connected ? (
        <button type="button" className="btn" onClick={() => void disconnect()}>{t(language, 'O‘chirish', 'Отключить', 'Disconnect')}</button>
      ) : (
        <button type="button" className="btn primary" onClick={() => void connect()}><Send size={15} /> {t(language, 'Telegramni ulash', 'Подключить Telegram', 'Connect Telegram')}</button>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. AI lesson plan                                                           */
/* -------------------------------------------------------------------------- */

type Plan = {
  title: string; goals: string[]; steps: Array<{ minutes: number; title: string; activity: string }>;
  questions: string[]; homework: string; experiment: string; source: 'ai' | 'local';
};
const SUBJECTS = ['Kimyo / Химия', 'Fizika / Физика', 'Biologiya / Биология', 'Matematika / Математика', 'Geografiya / География', 'Tarix / История', 'Ingliz tili / English', 'Ona tili / Родной язык', 'Informatika / Информатика'];

export function LessonPlanner({ language }: { language: Language }) {
  const [subject, setSubject] = useState(SUBJECTS[0]!);
  const [grade, setGrade] = useState(7);
  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function make() {
    if (!topic.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await customFetch<{ plan: Plan }>('/api/ai/lesson-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, grade, topic: topic.trim(), minutes, language }),
      });
      setPlan(response.plan);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel planner">
      <div className="section-head">
        <h2><Sparkles size={16} /> {t(language, 'AI dars rejasi', 'ИИ-план урока', 'AI lesson plan')}</h2>
        {plan && <button type="button" className="btn small" onClick={() => window.print()}><Printer size={14} /> {t(language, 'Chop etish', 'Печать', 'Print')}</button>}
      </div>
      <p className="muted">{t(language, 'Darslik paragrafini yozing — 30 soniyada reja, savollar va uy vazifasi tayyor.', 'Напишите параграф учебника — за 30 секунд готовы план, вопросы и домашнее задание.', 'Type the textbook paragraph — a plan, questions and homework in 30 seconds.')}</p>
      <div className="planner-form">
        <select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}>{SUBJECTS.map((item) => <option key={item}>{item}</option>)}</select>
        <select className="input" value={grade} onChange={(event) => setGrade(Number(event.target.value))}>{Array.from({ length: 11 }, (_, i) => i + 1).map((g) => <option key={g} value={g}>{g}-{t(language, 'sinf', 'класс', 'grade')}</option>)}</select>
        <select className="input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[40, 45, 80, 90].map((m) => <option key={m} value={m}>{m} {t(language, 'daq', 'мин', 'min')}</option>)}</select>
        <input className="input planner-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={t(language, '§12. Kislotalar va ularning xossalari', '§12. Кислоты и их свойства', '§12. Acids and their properties')} onKeyDown={(event) => { if (event.key === 'Enter') void make(); }} />
        <button type="button" className="btn primary" disabled={busy || !topic.trim()} onClick={() => void make()}>
          <Sparkles size={15} /> {busy ? t(language, 'Tayyorlanmoqda…', 'Готовим…', 'Working…') : t(language, 'Reja tuzish', 'Составить план', 'Make plan')}
        </button>
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      {plan && (
        <div className="plan-doc">
          <h3>{plan.title}</h3>
          {plan.goals.length > 0 && <><h4>{t(language, 'Maqsadlar', 'Цели', 'Goals')}</h4><ul>{plan.goals.map((goal, i) => <li key={i}>{goal}</li>)}</ul></>}
          <h4>{t(language, 'Dars bosqichlari', 'Ход урока', 'Lesson steps')}</h4>
          <div className="plan-steps">
            {plan.steps.map((step, i) => (
              <div className="plan-step" key={i}>
                <span className="plan-min">{step.minutes}′</span>
                <div><b>{step.title}</b><p>{step.activity}</p></div>
              </div>
            ))}
          </div>
          {plan.experiment && <><h4>{t(language, 'Tajriba / 3D', 'Опыт / 3D', 'Experiment / 3D')}</h4><p>{plan.experiment}</p></>}
          {plan.questions.length > 0 && <><h4>{t(language, 'Savollar', 'Вопросы классу', 'Questions')}</h4><ol>{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ol></>}
          {plan.homework && <><h4>{t(language, 'Uy vazifasi', 'Домашнее задание', 'Homework')}</h4><p>{plan.homework}</p></>}
          {plan.source === 'local' && <p className="muted">{t(language, 'AI hozir mavjud emas — namuna reja ko‘rsatildi.', 'ИИ сейчас недоступен — показан шаблон.', 'AI unavailable — a template is shown.')}</p>}
        </div>
      )}
    </section>
  );
}
