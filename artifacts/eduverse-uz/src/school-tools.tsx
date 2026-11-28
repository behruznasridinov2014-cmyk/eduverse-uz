import { useEffect, useMemo, useState } from 'react';
import { Select } from './ui/select';
import { customFetch } from '@workspace/api-client-react';
import { Bell, Camera, ClipboardList, Download, FileSpreadsheet, KeyRound, Printer, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';
import { CredentialList } from './ui/credentials';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* -------------------------------------------------------------------------- */
/* 1. Import a school from Excel (copy-paste of the table)                     */
/* -------------------------------------------------------------------------- */

type Role = 'student' | 'teacher' | 'parent' | 'school_admin' | 'school_director';
type Row = { role: Role; name: string; className?: string; childName?: string; phone?: string };
type Credential = { role: Role; name: string; className: string; login: string; password: string; phone?: string };

function roleOf(value: string): Role | null {
  const v = value.trim().toLowerCase();
  if (/^(student|ученик|ученица|o['‘’`]?quvchi|oquvchi|talaba)/.test(v)) return 'student';
  if (/^(teacher|учитель|учительница|преподаватель|o['‘’`]?qituvchi|oqituvchi|ustoz)/.test(v)) return 'teacher';
  if (/^(parent|родитель|мама|папа|ота|она|ota-ona|ota ona)/.test(v)) return 'parent';
  if (/^(завуч|заместитель|deputy|zavuch|o['‘’`]?rinbosar|orinbosar)/.test(v)) return 'school_admin';
  if (/^(директор|director|direktor)/.test(v)) return 'school_director';
  return null;
}

/** Rows copied from Excel/Google Sheets are tab separated; CSV also works. */
const PHONE = /^\+?[\d\s()\-]{9,18}$/;
const isPhone = (value: string) => PHONE.test(value.trim()) && value.replace(/\D/g, '').length >= 9;
const isClass = (value: string) => /^\d{1,2}\s*[-–]?\s*[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]?$/.test(value.trim());

/**
 * Two formats are accepted (copied from Excel / Google Sheets, or CSV):
 *  1) the simplest one — one row per student:
 *       ФИО ученика · Класс · Телефон родителя · ФИО родителя (optional)
 *     the parent account is created and linked automatically;
 *  2) with a role in the first column: ученик / учитель / родитель.
 * Header rows are skipped.
 */
export function parseTable(text: string): { rows: Row[]; errors: number[] } {
  const rows: Row[] = [];
  const errors: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/[;,]/)).map((cell) => cell.trim());
    const role = roleOf(cells[0] ?? '');
    const phone = cells.find((cell) => isPhone(cell));
    if (role) {
      const name = cells[1] ?? '';
      if (!name) { errors.push(index + 1); return; }
      const rest = cells.slice(2).filter((cell) => cell && cell !== phone);
      const className = rest.find((cell) => isClass(cell));
      const childName = role === 'parent' ? rest.find((cell) => cell !== className) : undefined;
      rows.push({ role, name, className, childName, phone });
      return;
    }
    // format 1: student row
    const name = cells[0] ?? '';
    const className = cells.slice(1).find((cell) => isClass(cell));
    if (!name || !className || /^(фио|ф\.и\.о|f\.i\.sh|ism|name|ученик)/i.test(name)) {
      if (index > 0 && name && !/^(фио|ф\.и\.о|ism|name)/i.test(name)) errors.push(index + 1);
      return;
    }
    rows.push({ role: 'student', name, className });
    if (phone) {
      const parentName = cells.slice(1).find((cell) => cell && cell !== className && cell !== phone && !isPhone(cell)) || `${name} — ota-ona / родитель`;
      rows.push({ role: 'parent', name: parentName, childName: name, phone });
    }
  });
  return { rows, errors };
}

const SAMPLE = `ФИО ученика\tКласс\tТелефон родителя\tФИО родителя
Азиз Каримов\t7-А\t+998 90 123 45 67\tКарим Каримов
Малика Юсупова\t7-А\t+998 93 765 43 21\tДилноза Юсупова
учитель\tНодира Рахимова\t7-А`;

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
    const header = 'role;name;class;login;password;phone';
    const body = result.map((row) => [row.role, row.name, row.className, row.login, row.password, row.phone ?? ''].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'eduverse-logins.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const roleName = (role: Role) => role === 'student' ? t(language, 'O‘quvchi', 'Ученик', 'Student') : role === 'teacher' ? t(language, 'O‘qituvchi', 'Учитель', 'Teacher') : role === 'school_admin' ? t(language, 'Zavuch', 'Завуч', 'Deputy') : role === 'school_director' ? t(language, 'Direktor', 'Директор', 'Director') : t(language, 'Ota-ona', 'Родитель', 'Parent');

  return (
    <section className="panel import-panel">
      <div className="section-head">
        <h2><FileSpreadsheet size={16} /> {t(language, 'Excel dan import', 'Импорт из Excel', 'Import from Excel')}</h2>
        <button type="button" className="btn small" onClick={() => setText(SAMPLE)}><ClipboardList size={14} /> {t(language, 'Namuna', 'Пример', 'Sample')}</button>
      </div>
      <p className="muted">{t(language,
        'Eng oddiy: har bir qator — bitta o‘quvchi: F.I.Sh · Sinf · Ota-ona telefoni · Ota-ona F.I.Sh. Ota-ona hisobi ham avtomatik yaratiladi. O‘qituvchi uchun birinchi ustunga «учитель» yozing.',
        'Проще всего: одна строка — один ученик: ФИО · Класс · Телефон родителя · ФИО родителя. Аккаунт родителя создастся и привяжется сам. Для учителя напишите в первом столбце «учитель», для завуча — «завуч».',
        'Simplest: one row per student: Full name · Class · Parent phone · Parent name. The parent account is created and linked automatically. For a teacher put “teacher” in the first column.')}</p>
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
          <CredentialList
            people={result.map((row) => ({ name: row.name, login: row.login, password: row.password, sub: [roleName(row.role), row.className, row.phone].filter(Boolean).join(' · ') }))}
            language={language}
            extra={<button type="button" className="btn small" onClick={downloadCsv}><Download size={14} /> CSV</button>}
          />
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

/**
 * One button for parents: marks, absences and homework of the child come to Telegram.
 * Shown only while Telegram is not connected yet; after connecting it disappears.
 */
export function TelegramOneTap({ language }: { language: Language }) {
  const [state, setState] = useState<{ available: boolean; connected: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const load = () => customFetch<{ available: boolean; connected: boolean }>('/api/me/telegram', { method: 'GET' }).then((value) => { setState(value); return value; }).catch(() => null);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = window.setInterval(() => { void load().then((value) => { if (value?.connected || Date.now() - started > 180000) setWaiting(false); }); }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  async function connect() {
    // The tab opens right on the press: phones block a window opened later.
    const tab = window.open('', '_blank');
    const response = await customFetch<{ link: string }>('/api/me/telegram/link', { method: 'POST' }).catch(() => null);
    if (!response?.link) { tab?.close(); return; }
    if (tab) tab.location.href = response.link; else window.location.href = response.link;
    setWaiting(true);
  }
  if (!state?.available || state.connected) return null;
  return (
    <section className="tg-onetap">
      <span className="tg-onetap-icon"><Send size={18} /></span>
      <div>
        <b>{t(language, 'Baholar va davomat Telegramga', 'Оценки и посещаемость — в Telegram', 'Marks and attendance in Telegram')}</b>
        <small>{t(language, 'Bir marta bosing — har bir baho va «nb» darhol keladi.', 'Нажмите один раз — каждая оценка и «нб» придут сразу.', 'Tap once — every mark and absence arrives at once.')}</small>
      </div>
      <button type="button" className="btn primary" onClick={() => void connect()} disabled={waiting}>{waiting ? t(language, 'Kutilmoqda…', 'Ждём…', 'Waiting…') : t(language, 'Ulash', 'Подключить', 'Connect')}</button>
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
        <h2><Sparkles size={16} /> {t(language, 'Dars rejasi', 'План урока', 'Lesson plan')}</h2>
        {plan && <button type="button" className="btn small" onClick={() => window.print()}><Printer size={14} /> {t(language, 'Chop etish', 'Печать', 'Print')}</button>}
      </div>
      <div className="planner-form">
        <Select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}>{SUBJECTS.map((item) => <option key={item}>{item}</option>)}</Select>
        <Select className="input" value={grade} onChange={(event) => setGrade(Number(event.target.value))}>{Array.from({ length: 11 }, (_, i) => i + 1).map((g) => <option key={g} value={g}>{g}-{t(language, 'sinf', 'класс', 'grade')}</option>)}</Select>
        <Select className="input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[40, 45, 80, 90].map((m) => <option key={m} value={m}>{m} {t(language, 'daq', 'мин', 'min')}</option>)}</Select>
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
          
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Password change (name and login are set by the school)                      */
/* -------------------------------------------------------------------------- */

export function PasswordChange({ language, mustChange = false }: { language: Language; mustChange?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(mustChange);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => { if (mustChange) setOpen(true); }, [mustChange]);
  // After recovery through Google the old password is not asked.
  useEffect(() => {
    void customFetch<{ recovery?: boolean }>('/api/me/security', { method: 'GET' })
      .then((response) => { if (response.recovery) { setRecovery(true); setOpen(true); } })
      .catch(() => {});
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (next !== repeat) { setError(t(language, 'Parollar mos emas.', 'Пароли не совпадают.', 'Passwords do not match.')); return; }
    setBusy(true);
    try {
      await customFetch('/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
      setMessage(t(language, 'Parol o‘zgartirildi.', 'Пароль изменён.', 'Password changed.'));
      window.dispatchEvent(new Event('eduverse:password-changed'));
      setCurrent(''); setNext(''); setRepeat(''); setRecovery(false);
      setOpen(false);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`panel password-panel ${mustChange ? 'must-change' : ''}`}>
      <div className="password-head">
        <div>
          <h2><KeyRound size={16} /> {t(language, 'Parol', 'Пароль', 'Password')}</h2>
          <p className="muted">{recovery
            ? t(language, 'Hisob tiklandi: barcha qurilmalardan chiqildi. Yangi parol qo‘ying.', 'Доступ восстановлен: выполнен выход на всех устройствах. Поставьте новый пароль.', 'Access recovered: every device was signed out. Set a new password.')
            : mustChange
            ? t(language, 'Maktab bergan vaqtinchalik parolni o‘zingizning parolingizga almashtiring.', 'Замените временный пароль от школы на свой.', 'Replace the temporary password from the school with your own.')
            : t(language, 'Ism va login maktab tomonidan belgilanadi, parolni o‘zingiz o‘zgartirasiz.', 'Имя и логин задаёт школа, пароль вы меняете сами.', 'The school sets your name and login; you change the password.')}</p>
        </div>
        {!open && <button type="button" className="btn" onClick={() => { setOpen(true); setMessage(''); }}>{t(language, 'Parolni o‘zgartirish', 'Сменить пароль', 'Change password')}</button>}
      </div>
      {open && (
        <form className="password-form reveal" onSubmit={submit}>
          {!recovery && <input className="input" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder={t(language, 'Hozirgi parol', 'Текущий пароль', 'Current password')} required autoFocus />}
          <input className="input" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(event) => setNext(event.target.value)} placeholder={t(language, 'Yangi parol (10+ belgi, harf va raqam)', 'Новый пароль (от 10 символов, буквы и цифры)', 'New password (10+ chars, letters and digits)')} required />
          <input className="input" type="password" autoComplete="new-password" minLength={10} value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder={t(language, 'Yangi parolni takrorlang', 'Повторите новый пароль', 'Repeat new password')} required />
          <div className="password-actions">
            <button type="submit" className="btn primary" disabled={busy}>{t(language, 'Saqlash', 'Сохранить', 'Save')}</button>
            {!mustChange && <button type="button" className="btn ghost" onClick={() => { setOpen(false); setError(''); }}>{t(language, 'Bekor qilish', 'Отмена', 'Cancel')}</button>}
          </div>
        </form>
      )}
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}

export function useMustChangePassword(userId: string | null = 'self'): boolean {
  const [must, setMust] = useState(false);
  useEffect(() => {
    if (!userId) { setMust(false); return; }
    let active = true;
    void customFetch<{ mustChangePassword: boolean }>('/api/me/security', { method: 'GET' })
      .then((response) => { if (active) setMust(response.mustChangePassword); })
      .catch(() => {});
    const onChanged = () => setMust(false);
    window.addEventListener('eduverse:password-changed', onChanged);
    return () => { active = false; window.removeEventListener('eduverse:password-changed', onChanged); };
  }, [userId]);
  return must;
}

/* -------------------------------------------------------------------------- */
/* Optional profile photo                                                       */
/* -------------------------------------------------------------------------- */

const avatarCache: { owner: string | null; value: string | null | undefined } = { owner: null, value: undefined };

/** The signed-in user's photo (null = letter avatar). Shared by the sidebar, the header and the profile. */
export function useAvatar(userId: string | null): string | null {
  const [avatar, setAvatar] = useState<string | null>(avatarCache.owner === userId ? avatarCache.value ?? null : null);
  useEffect(() => {
    if (!userId) { setAvatar(null); return; }
    let active = true;
    const onChanged = () => { if (avatarCache.owner === userId) setAvatar(avatarCache.value ?? null); };
    window.addEventListener('eduverse:avatar-changed', onChanged);
    if (avatarCache.owner !== userId || avatarCache.value === undefined) {
      avatarCache.owner = userId;
      avatarCache.value = undefined;
      void customFetch<{ avatar: string | null }>('/api/me/avatar', { method: 'GET' })
        .then((response) => {
          if (avatarCache.owner !== userId) return;
          avatarCache.value = response.avatar;
          window.dispatchEvent(new Event('eduverse:avatar-changed'));
          if (active) setAvatar(response.avatar);
        })
        .catch(() => {});
    } else {
      setAvatar(avatarCache.value ?? null);
    }
    return () => { active = false; window.removeEventListener('eduverse:avatar-changed', onChanged); };
  }, [userId]);
  return avatar;
}

function publishAvatar(value: string | null) {
  avatarCache.value = value;
  window.dispatchEvent(new Event('eduverse:avatar-changed'));
}

/** Square crop + resize to 256 px JPEG so the photo stays small (about 15–40 KB). */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image'));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    let quality = 0.86;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 78 * 1024 && quality > 0.4) { quality -= 0.12; data = canvas.toDataURL('image/jpeg', quality); }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarPicker({ userId, name, language }: { userId: string; name: string; language: Language }) {
  const avatar = useAvatar(userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError(t(language, 'Rasm tanlang.', 'Выберите фото.', 'Choose a photo.')); return; }
    setBusy(true);
    try {
      const data = await shrinkPhoto(file);
      await customFetch('/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: data }) });
      publishAvatar(data);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await customFetch('/api/me/avatar', { method: 'DELETE' });
      publishAvatar(null);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="avatar-picker">
      <label className={`avatar avatar-xl ${busy ? 'busy' : ''}`} title={t(language, 'Rasm qo‘yish (ixtiyoriy)', 'Поставить фото (по желанию)', 'Set a photo (optional)')}>
        {avatar ? <img src={avatar} alt="" /> : <span>{name.slice(0, 1).toLocaleUpperCase()}</span>}
        <span className="avatar-cam"><Camera size={15} /></span>
        <input type="file" accept="image/*" hidden onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      {avatar && <button type="button" className="avatar-remove" onClick={() => void remove()} disabled={busy} aria-label={t(language, 'Rasmni o‘chirish', 'Убрать фото', 'Remove photo')}><Trash2 size={13} /></button>}
      {error && <span className="avatar-error">{error}</span>}
    </div>
  );
}

/** Small round avatar: the photo if the user set one, otherwise the first letter. */
export function UserAvatar({ userId, name, className = 'avatar' }: { userId: string | null; name: string; className?: string }) {
  const avatar = useAvatar(userId);
  return <span className={`${className}${avatar ? ' has-photo' : ''}`}>{avatar ? <img src={avatar} alt="" /> : name.slice(0, 1).toLocaleUpperCase()}</span>;
}
