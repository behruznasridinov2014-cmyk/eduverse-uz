import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Download, Plus, Printer, Trash2, UserPlus } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';
import { CredentialList } from './ui/credentials';

/*
 * The owner prepares a school before handing it over:
 *   1. director  2. deputies  3. teachers  4. pupils with their parents.
 * Every step creates accounts at once and shows logins + one-time passwords to print.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Step = 'director' | 'deputy' | 'teacher' | 'pupil';
type Row = { name: string; phone: string; className: string; parentName: string; parentPhone: string };
type Created = { role: string; name: string; className: string; login: string; password: string; phone: string };

const EMPTY: Row = { name: '', phone: '', className: '', parentName: '', parentPhone: '' };
const ROLE_RU: Record<string, string> = { school_director: 'Директор', school_admin: 'Завуч', teacher: 'Учитель', student: 'Ученик', parent: 'Родитель' };
const ROLE_UZ: Record<string, string> = { school_director: 'Direktor', school_admin: 'Zavuch', teacher: 'O‘qituvchi', student: 'O‘quvchi', parent: 'Ota-ona' };

export function SchoolSetupWizard({ schoolId, schoolName, language }: { schoolId: string; schoolName: string; language: Language }) {
  const [step, setStep] = useState<Step>('director');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  const [pupilClass, setPupilClass] = useState('');
  const [created, setCreated] = useState<Created[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const steps: Array<[Step, string]> = [
    ['director', t(language, '1. Direktor', '1. Директор', '1. Director')],
    ['deputy', t(language, '2. Zavuchlar', '2. Завучи', '2. Deputies')],
    // Teachers, pupils, parents, the timetable and books are added by the school itself.
  ];
  const go = (next: Step) => { setStep(next); setRows([{ ...EMPTY }]); setMessage(''); setError(''); };
  const setRow = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function toApiRows() {
    const filled = rows.filter((row) => row.name.trim());
    if (step === 'director') return filled.slice(0, 1).map((row) => ({ role: 'school_director', name: row.name.trim(), phone: row.phone.trim() || undefined }));
    if (step === 'deputy') return filled.map((row) => ({ role: 'school_admin', name: row.name.trim(), phone: row.phone.trim() || undefined }));
    if (step === 'teacher') return filled.map((row) => ({ role: 'teacher', name: row.name.trim(), phone: row.phone.trim() || undefined, className: row.className.trim() || undefined }));
    const className = pupilClass.trim();
    return filled.flatMap((row) => [
      { role: 'student', name: row.name.trim(), className },
      ...(row.parentName.trim() || row.parentPhone.trim()
        ? [{ role: 'parent', name: row.parentName.trim() || `${row.name.trim()} — родитель`, childName: row.name.trim(), phone: row.parentPhone.trim() || undefined }]
        : []),
    ]);
  }

  async function submit() {
    setError(''); setMessage('');
    if (step === 'pupil' && !pupilClass.trim()) { setError(t(language, 'Sinfni yozing, masalan 7-A.', 'Укажите класс, например 7-А.', 'Enter the class, e.g. 7-A.')); return; }
    const apiRows = toApiRows();
    if (apiRows.length === 0) { setError(t(language, 'Kamida bitta F.I.Sh. yozing.', 'Впишите хотя бы одно ФИО.', 'Enter at least one name.')); return; }
    if (!window.confirm(t(language, `${schoolName}: ${apiRows.length} ta hisob yaratilsinmi?`, `${schoolName}: создать аккаунтов — ${apiRows.length}?`, `${schoolName}: create ${apiRows.length} accounts?`))) return;
    setBusy(true);
    try {
      const response = await customFetch<{ created: Created[]; skipped: Array<{ name: string; reason: string }> }>(`/api/schools/${schoolId}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: apiRows }) });
      setCreated((current) => [...current, ...response.created]);
      setRows([{ ...EMPTY }]);
      if (step === 'director' && response.created.length > 0) setStep('deputy');
      setMessage(t(language, `Yaratildi: ${response.created.length}. Kartochkalar pastda.`, `Создано: ${response.created.length}. Карточки с логинами — внизу.`, `Created: ${response.created.length}. Cards are below.`) + (response.skipped.length ? ` ${t(language, 'O‘tkazib yuborildi', 'Пропущено', 'Skipped')}: ${response.skipped.map((item) => item.name).join(', ')}` : ''));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const header = 'Роль;ФИО;Класс;Логин;Пароль;Телефон';
    const body = created.map((row) => [ROLE_RU[row.role] ?? row.role, row.name, row.className, row.login, row.password, row.phone].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' }));
    link.download = `eduverse-${schoolName.replace(/[^\p{L}\p{N}]+/gu, '-')}-logins.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const roleLabel = (role: string) => (language === 'Uzbek' ? ROLE_UZ[role] : ROLE_RU[role]) ?? role;
  const single = step === 'director';

  return (
    <section className="panel setup-wizard">
      <h2><UserPlus size={16} /> {t(language, 'Maktabni tayyorlash', 'Подготовка школы', 'Prepare the school')}: {schoolName}</h2>
      <p className="muted">{t(language, 'Direktor va zavuchni qo‘shing. Qolganlarni maktab o‘zi qo‘shadi.', 'Добавьте директора и завуча. Остальных школа добавит сама.', 'Add the director and deputy. The school adds everyone else.')}</p>
      <div className="setup-steps-tabs">
        {steps.map(([key, label]) => <button key={key} type="button" className={`btn small ${step === key ? 'primary' : ''}`} onClick={() => go(key)}>{label}</button>)}
      </div>

      {step === 'pupil' && (
        <div className="setup-class">
          <label htmlFor="setup-class">{t(language, 'Sinf', 'Класс', 'Class')}</label>
          <input id="setup-class" className="input" value={pupilClass} onChange={(event) => setPupilClass(event.target.value)} placeholder="7-А" />
          <small className="muted">{t(language, 'Sinf yo‘q bo‘lsa, avtomatik yaratiladi.', 'Если такого класса нет, он создастся сам.', 'Created if missing.')}</small>
        </div>
      )}

      <div className="setup-rows">
        <div className={`setup-row head ${step}`}>
          <span>{step === 'pupil' ? t(language, 'O‘quvchi F.I.Sh.', 'ФИО ученика', 'Pupil name') : t(language, 'F.I.Sh.', 'Фамилия Имя Отчество', 'Full name')}</span>
          {step === 'pupil' ? <><span>{t(language, 'Ota-ona F.I.Sh.', 'ФИО родителя', 'Parent name')}</span><span>{t(language, 'Ota-ona telefoni', 'Телефон родителя', 'Parent phone')}</span></>
            : <span>{t(language, 'Telefon', 'Телефон', 'Phone')}</span>}
          {step === 'teacher' && <span>{t(language, 'Sinf (rahbar)', 'Класс', 'Class')}</span>}
          <span />
        </div>
        {rows.map((row, index) => (
          <div key={index} className={`setup-row ${step}`}>
            <input className="input" value={row.name} onChange={(event) => setRow(index, { name: event.target.value })} placeholder={step === 'pupil' ? 'Каримова Азиза Рустамовна' : 'Иванов Иван Иванович'} />
            {step === 'pupil' ? (
              <>
                <input className="input" value={row.parentName} onChange={(event) => setRow(index, { parentName: event.target.value })} placeholder="Каримов Рустам" />
                <input className="input" value={row.parentPhone} onChange={(event) => setRow(index, { parentPhone: event.target.value })} placeholder="+998 90 123 45 67" inputMode="tel" />
              </>
            ) : <input className="input" value={row.phone} onChange={(event) => setRow(index, { phone: event.target.value })} placeholder="+998 90 123 45 67" inputMode="tel" />}
            {step === 'teacher' && <input className="input" value={row.className} onChange={(event) => setRow(index, { className: event.target.value })} placeholder="7-А" />}
            {!single && rows.length > 1 ? <button type="button" className="btn small" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label="−"><Trash2 size={13} /></button> : <span />}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {!single && <button type="button" className="btn small" onClick={() => setRows((current) => [...current, { ...EMPTY }])}><Plus size={13} /> {t(language, 'Qator qo‘shish', 'Ещё строка', 'Add a row')}</button>}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><UserPlus size={14} /> {t(language, 'Hisoblarni yaratish', 'Создать аккаунты', 'Create accounts')}</button>
      </div>
      {message && <div className="notice success" style={{ marginTop: 10 }}>{message}</div>}
      {error && <div className="notice" style={{ marginTop: 10 }}>{error}</div>}

      {created.length > 0 && (
        <div className="setup-created">
          <CredentialList
            people={created.map((person) => ({ name: person.name, login: person.login, password: person.password, sub: [roleLabel(person.role), person.className].filter(Boolean).join(' · ') }))}
            language={language}
            extra={<button type="button" className="btn small" onClick={downloadCsv}><Download size={13} /> Excel</button>}
          />
        </div>
      )}
    </section>
  );
}
