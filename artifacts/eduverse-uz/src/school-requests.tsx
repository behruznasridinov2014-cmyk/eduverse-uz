import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from './ui/select';
import { customFetch } from '@workspace/api-client-react';
import { CalendarDays, Camera, Check, FileImage, ClipboardList, History, Inbox, Pencil, RefreshCw, UserMinus, UserPlus, X } from 'lucide-react';
import type { Language } from './school-data';
import { parseTable } from './school-tools';
import { friendlyError } from './errors';
import { TEACHER_SUBJECTS, subjectLabel } from './ui/config';
import { CredentialList } from './ui/credentials';
import { compressImage } from './homework';
import { Modal } from './ui/modal';
import { LensRow } from './glass-nav';

/*
 * People of a school:
 *  - the director / deputy makes the change at once (it is kept in the journal);
 *  - the owner can also change a person directly.
 * Nothing is deleted: an expelled pupil keeps grades and attendance.
 */

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

type Kind = 'enroll' | 'expel' | 'transfer' | 'graduate' | 'restore' | 'edit';
type Person = { id: string; name: string; login: string; role: string; phone: string | null; subjects?: string[]; status: string; statusReason: string; classes: string[]; hasDocument?: boolean; children?: string[] };

/** The subjects a teacher teaches: tap to add or remove (one or several). */
export function SubjectPicker({ value, onChange, language }: { value: string[]; onChange: (next: string[]) => void; language: Language }) {
  return (
    <div className="subject-picker">
      {TEACHER_SUBJECTS.map((item) => {
        const on = value.includes(item[1]);
        return (
          <button type="button" key={item[1]} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((name) => name !== item[1]) : [...value, item[1]].slice(0, 20))}>
            {on && <Check size={12} />} {t(language, item[0], item[1], item[2])}
          </button>
        );
      })}
    </div>
  );
}
type Request = {
  id: string; schoolId: string; schoolName: string; kind: Kind; reason: string; status: string; decisionNote: string; createdAt: string;
  payload: { rows?: Array<{ role: string; name: string; className?: string }>; name?: string; phone?: string; className?: string; toSchool?: string };
  target: { name: string; role: string } | null; author: string; result: Record<string, unknown>;
};
type Created = { role: string; name: string; className: string; login: string; password: string; phone: string };

const KIND_TEXT: Record<Kind, [string, string, string]> = {
  enroll: ['O‘quvchilarni qabul qilish', 'Принять учеников', 'Enrol pupils'],
  expel: ['Chiqarish / o‘chirish', 'Отчислить / отключить', 'Expel / disable'],
  transfer: ['Boshqa maktabga o‘tkazish', 'Перевод в другую школу', 'Transfer'],
  graduate: ['Bitiruv', 'Выпуск', 'Graduate'],
  restore: ['Qayta tiklash', 'Восстановить', 'Restore'],
  edit: ['Ma’lumotni tuzatish', 'Исправить данные', 'Correct details'],
};
const STATUS_TEXT: Record<string, [string, string, string, string]> = {
  active: ['O‘qiydi', 'Учится', 'Active', 'green'],
  expelled: ['Chiqarilgan', 'Отчислен', 'Expelled', 'red'],
  transferred: ['O‘tkazilgan', 'Переведён', 'Transferred', 'gold'],
  graduated: ['Bitirgan', 'Выпущен', 'Graduated', 'blue'],
  disabled: ['O‘chirilgan', 'Отключён', 'Disabled', 'red'],
};
const ROLE_TEXT: Record<string, [string, string, string]> = {
  student: ['O‘quvchi', 'Ученик', 'Student'], teacher: ['O‘qituvchi', 'Учитель', 'Teacher'], parent: ['Ota-ona', 'Родитель', 'Parent'],
  school_admin: ['Zavuch', 'Завуч', 'Deputy'], school_director: ['Direktor', 'Директор', 'Director'],
};
const REQ_STATUS: Record<string, [string, string, string, string]> = {
  pending: ['Kutilmoqda', 'Ждёт EDUVERSE', 'Waiting', 'gold'],
  approved: ['Bajarildi', 'Выполнено', 'Done', 'green'],
  rejected: ['Rad etildi', 'Отклонено', 'Rejected', 'red'],
};
const label = (language: Language, item: [string, string, string, ...string[]] | undefined, fallback: string) => (item ? t(language, item[0], item[1], item[2]) : fallback);
const when = (value: string) => new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function describeRequest(language: Language, request: Request): string {
  if (request.kind === 'enroll') {
    const rows = request.payload.rows ?? [];
    return `${rows.length} ${t(language, 'kishi', 'чел.', 'people')}: ${rows.slice(0, 4).map((row) => row.name + (row.className ? ` (${row.className})` : '')).join(', ')}${rows.length > 4 ? '…' : ''}`;
  }
  const who = request.target?.name ?? '—';
  if (request.kind === 'edit') {
    const parts = [request.payload.name && `ФИО → ${request.payload.name}`, request.payload.phone !== undefined && `тел. → ${request.payload.phone || '—'}`, request.payload.className && `класс → ${request.payload.className}`].filter(Boolean);
    return `${who}: ${parts.join(', ')}`;
  }
  return `${who}${request.payload.toSchool ? ` → ${request.payload.toSchool}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* People of a school with actions                                      */
/* ------------------------------------------------------------------ */

/**
 * mode "request": the director / deputy changes it at once (school side).
 * mode "owner": EDUVERSE changes the person at once.
 */
/** The pupil's document photo: open it, or add / replace it. Seen only by the school management. */
function DocumentButton({ schoolId, person, language, onSaved }: { schoolId: string; person: Person; language: Language; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function show() {
    setOpen(true); setError(''); setData(null);
    if (!person.hasDocument) return;
    try { setData((await customFetch<{ data: string }>(`/api/schools/${schoolId}/people/${person.id}/document`, { method: 'GET' })).data); }
    catch (requestError) { setError(friendlyError(requestError, language)); }
  }
  async function upload(file: File) {
    setBusy(true); setError('');
    try {
      const picture = await compressImage(file);
      await customFetch(`/api/schools/${schoolId}/people/${person.id}/document`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: picture }) });
      setData(picture); onSaved();
    } catch (requestError) { setError(friendlyError(requestError, language)); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className="btn small" onClick={() => void show()}><FileImage size={13} /> {person.hasDocument ? t(language, 'Hujjat', 'Документ', 'Document') : t(language, 'Hujjat qo‘shish', 'Добавить документ', 'Add document')}</button>
      {open && (
        <Modal title={`${t(language, 'Hujjat', 'Документ', 'Document')} · ${person.name}`} onClose={() => setOpen(false)}>
          {data ? <img className="person-doc" src={data} alt={t(language, 'Hujjat surati', 'Фото документа', 'Document photo')} /> : person.hasDocument && !error ? <p className="muted">…</p> : <p className="muted">{t(language, 'Hujjat surati hali yo‘q.', 'Фото документа ещё нет.', 'No document photo yet.')}</p>}
          {error && <div className="notice" role="alert">{error}</div>}
          <label className="add-doc">
            <input type="file" accept="image/*" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
            <span className="btn small primary"><Camera size={14} /> {busy ? '…' : data ? t(language, 'Almashtirish', 'Заменить фото', 'Replace') : t(language, 'Surat yuklash', 'Загрузить фото', 'Upload a photo')}</span>
          </label>
        </Modal>
      )}
    </>
  );
}

export function SchoolPeoplePanel({ schoolId, language, mode, onChanged }: { schoolId: string; language: Language; mode: 'request' | 'owner'; onChanged?: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('student');
  const [statusFilter, setStatusFilter] = useState('active');
  const [action, setAction] = useState<{ person: Person; kind: Kind } | null>(null);
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState<{ name: string; phone: string; className: string; toSchool: string; subjects: string[] }>({ name: '', phone: '', className: '', toSchool: '', subjects: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    void customFetch<{ people: Person[]; classes: string[] }>(`/api/schools/${schoolId}/people`, { method: 'GET' })
      .then((data) => { setPeople(data.people); setClasses(data.classes); })
      .catch((requestError) => setError(friendlyError(requestError, language)));
  }, [schoolId, language]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => people.filter((person) =>
    (roleFilter === 'all' || person.role === roleFilter)
    && (statusFilter === 'all' || person.status === statusFilter)
    && (!query.trim() || `${person.name} ${person.login} ${person.classes.join(' ')} ${person.phone ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))), [people, roleFilter, statusFilter, query]);

  function open(person: Person, kind: Kind) {
    setAction({ person, kind });
    setReason('');
    setEdit({ name: person.name, phone: person.phone ?? '', className: person.classes[0] ?? '', toSchool: '', subjects: person.subjects ?? [] });
    setMessage(''); setError('');
  }

  async function submit() {
    if (!action) return;
    const { person, kind } = action;
    const needsReason = kind === 'expel' || kind === 'transfer';
    if (needsReason && reason.trim().length < 3) { setError(t(language, 'Sababini yozing (masalan, buyruq raqami).', 'Напишите причину (например, номер приказа).', 'Write the reason (e.g. the order number).')); return; }
    const verb = label(language, KIND_TEXT[kind], kind);
    const question = mode === 'owner'
      ? t(language, `${person.name}: ${verb}. Tasdiqlaysizmi?`, `${person.name}: ${verb}. Подтверждаете?`, `${person.name}: ${verb}. Confirm?`)
      : t(language, `${person.name}: ${verb}. Tasdiqlaysizmi?`, `${person.name}: ${verb}. Подтверждаете?`, `${person.name}: ${verb}. Confirm?`);
    if (!window.confirm(question)) return;
    const body: Record<string, unknown> = { kind, reason: reason.trim(), userId: person.id };
    if (kind === 'edit') {
      if (edit.name.trim() && edit.name.trim() !== person.name) body.name = edit.name.trim();
      if (edit.phone.trim() !== (person.phone ?? '')) body.phone = edit.phone.trim();
      if (edit.className.trim() && edit.className.trim() !== (person.classes[0] ?? '')) body.className = edit.className.trim();
      if (person.role === 'teacher' && edit.subjects.join('|') !== (person.subjects ?? []).join('|')) body.subjects = edit.subjects;
    }
    if (kind === 'transfer' && edit.toSchool.trim()) body.toSchool = edit.toSchool.trim();
    setBusy(true); setError('');
    try {
      if (mode === 'owner') {
        await customFetch(`/api/admin/schools/${schoolId}/people/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        setMessage(t(language, 'Bajarildi.', 'Готово, изменение внесено.', 'Done.'));
        load(); onChanged?.();
      } else {
        await customFetch(`/api/schools/${schoolId}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        setMessage(t(language, 'Bajarildi.', 'Готово, изменение внесено.', 'Done.'));
        load(); onChanged?.();
      }
      setAction(null);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel people-panel">
      <div className="section-head">
        <h2><UserMinus size={16} /> {t(language, 'Maktab odamlari', 'Люди школы', 'People of the school')}</h2>
        <button type="button" className="btn small" onClick={load}><RefreshCw size={13} /></button>
      </div>
      <p className="muted">{mode === 'owner'
        ? t(language, 'Siz to‘g‘ridan-to‘g‘ri o‘zgartirasiz. Hech narsa o‘chirilmaydi: baholar va davomat saqlanadi.', 'Вы меняете сразу. Ничего не удаляется: оценки и посещаемость сохраняются.', 'You change it directly. Nothing is deleted.')
        : t(language, 'O‘zgartirish darhol kiritiladi va jurnalda saqlanadi. Hech narsa o‘chirilmaydi.', 'Изменение вносится сразу и сохраняется в журнале. Ничего не удаляется: оценки и посещаемость сохраняются.', 'The change is made at once and kept in the log. Nothing is deleted.')}</p>
      <div className="people-summary">
        {(['student', 'teacher', 'parent', 'school_admin'] as const).map((role) => {
          const count = people.filter((person) => person.role === role && person.status === 'active').length;
          const names: Record<string, [string, string, string]> = { student: ['O‘quvchilar', 'Ученики', 'Pupils'], teacher: ['O‘qituvchilar', 'Учителя', 'Teachers'], parent: ['Ota-onalar', 'Родители', 'Parents'], school_admin: ['Zavuchlar', 'Завучи', 'Deputies'] };
          return (
            <button type="button" key={role} className={`people-stat ${roleFilter === role ? 'on' : ''}`} onClick={() => setRoleFilter(role)}>
              <b>{count}</b><span>{label(language, names[role]!, role)}</span>
            </button>
          );
        })}
        <button type="button" className={`people-stat ${roleFilter === 'all' ? 'on' : ''}`} onClick={() => setRoleFilter('all')}><b>{people.filter((person) => person.status === 'active').length}</b><span>{t(language, 'Hammasi', 'Все', 'Everyone')}</span></button>
      </div>
      {roleFilter === 'student' && classes.length > 0 && (
        <div className="people-classes">
          {classes.map((name) => {
            const count = people.filter((person) => person.role === 'student' && person.status === 'active' && person.classes.includes(name)).length;
            return <button type="button" key={name} className={`tag ${query === name ? 'gold' : ''}`} onClick={() => setQuery(query === name ? '' : name)}>{name}: {count}</button>;
          })}
        </div>
      )}
      <div className="people-filters">
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'F.I.Sh., login, sinf yoki telefon', 'ФИО, логин, класс или телефон', 'Name, login, class or phone')} />
        <Select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">{t(language, 'Har qanday holat', 'Любой статус', 'Any status')}</option>
          {Object.entries(STATUS_TEXT).map(([key, value]) => <option key={key} value={key}>{label(language, value, key)}</option>)}
        </Select>
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice">{error}</div>}
      <div className="people-list">
        {shown.length === 0 && <p className="muted">{t(language, 'Hech kim topilmadi.', 'Никого не найдено.', 'Nobody found.')}</p>}
        {shown.slice(0, 300).map((person) => {
          const status = STATUS_TEXT[person.status] ?? STATUS_TEXT.active;
          const isDirector = person.role === 'school_director';
          return (
            <div key={person.id} className="people-row">
              <div className="people-main">
                <b>{person.name}</b>
                <small className="muted">{label(language, ROLE_TEXT[person.role], person.role)}{person.role === 'teacher' && person.subjects?.length ? ` · ${person.subjects.map((name) => subjectLabel(name, language)).join(', ')}` : ''}{person.classes.length ? ` · ${person.classes.join(', ')}` : ''} · {person.login}{person.phone ? ` · ${person.phone}` : ''}</small>
                {person.role === 'parent' && person.children?.length ? <small className="muted">{t(language, 'Farzandi', 'Ребёнок', 'Child')}: {person.children.join(', ')}</small> : null}
                {person.status !== 'active' && person.statusReason && <small className="muted">{person.statusReason}</small>}
              </div>
              <span className={`tag ${status[3]}`}>{label(language, status, person.status)}</span>
              {(!isDirector || mode === 'owner') && (
                <div className="people-actions">
                  <button type="button" className="btn small" onClick={() => open(person, 'edit')}><Pencil size={13} /> {t(language, 'Tuzatish', 'Исправить', 'Edit')}</button>
                  {person.role === 'student' && <DocumentButton schoolId={schoolId} person={person} language={language} onSaved={load} />}
                  {person.status === 'active' ? (
                    <>
                      <button type="button" className="btn small danger" onClick={() => open(person, 'expel')}>{person.role === 'student' ? t(language, 'Chiqarish', 'Отчислить', 'Expel') : t(language, 'O‘chirish', 'Отключить', 'Disable')}</button>
                      {person.role === 'student' && <button type="button" className="btn small" onClick={() => open(person, 'transfer')}>{t(language, 'O‘tkazish', 'Перевести', 'Transfer')}</button>}
                      {person.role === 'student' && <button type="button" className="btn small" onClick={() => open(person, 'graduate')}>{t(language, 'Bitirdi', 'Выпустить', 'Graduate')}</button>}
                    </>
                  ) : (
                    <button type="button" className="btn small" onClick={() => open(person, 'restore')}>{t(language, 'Qayta tiklash', 'Восстановить', 'Restore')}</button>
                  )}
                </div>
              )}
              {action?.person.id === person.id && (
                <div className="people-form">
                  <b>{label(language, KIND_TEXT[action.kind], action.kind)}</b>
                  {action.kind === 'edit' && <small className="muted">{t(language, 'Baholar, davomat va tarix saqlanadi — qayta qo‘shish shart emas.', 'Оценки, посещаемость и история сохраняются — заново добавлять не нужно.', 'Grades, attendance and history stay — no need to add again.')}</small>}
                  {action.kind === 'edit' && (
                    <div className="people-form-grid">
                      <input className="input" value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} placeholder={t(language, 'F.I.Sh.', 'ФИО', 'Full name')} />
                      <input className="input" value={edit.phone} onChange={(event) => setEdit({ ...edit, phone: event.target.value })} placeholder={t(language, 'Telefon', 'Телефон', 'Phone')} />
                      {(person.role === 'student' || person.role === 'teacher') && (
                        <input className="input" list={`classes-${schoolId}`} value={edit.className} onChange={(event) => setEdit({ ...edit, className: event.target.value })} placeholder={t(language, 'Sinf', 'Класс', 'Class')} />
                      )}
                      <datalist id={`classes-${schoolId}`}>{classes.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                  )}
                  {action.kind === 'edit' && person.role === 'teacher' && (
                    <div>
                      <small className="muted">{t(language, 'Qaysi fanlarni o‘qitadi', 'Какие предметы ведёт', 'Subjects taught')}</small>
                      <SubjectPicker value={edit.subjects} onChange={(subjects) => setEdit({ ...edit, subjects })} language={language} />
                    </div>
                  )}
                  {action.kind === 'transfer' && <input className="input" value={edit.toSchool} onChange={(event) => setEdit({ ...edit, toSchool: event.target.value })} placeholder={t(language, 'Qaysi maktabga', 'В какую школу', 'To which school')} />}
                  <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={action.kind === 'expel' || action.kind === 'transfer' ? t(language, 'Sabab va buyruq raqami (majburiy)', 'Причина и номер приказа (обязательно)', 'Reason and order number (required)') : t(language, 'Izoh (ixtiyoriy)', 'Комментарий (необязательно)', 'Comment (optional)')} />
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn primary small" disabled={busy} onClick={() => void submit()}><Check size={13} /> {t(language, 'Tasdiqlash', 'Подтвердить', 'Confirm')}</button>
                    <button type="button" className="btn small" onClick={() => setAction(null)}><X size={13} /> {t(language, 'Bekor qilish', 'Отмена', 'Cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* School: request to enrol pupils + my requests                        */
/* ------------------------------------------------------------------ */

type AddMode = 'student' | 'many' | 'teacher' | 'parent' | 'deputy';
type Fio = { surname: string; name: string; patronymic: string };
const EMPTY_FIO: Fio = { surname: '', name: '', patronymic: '' };
const fioText = (fio: Fio) => [fio.surname, fio.name, fio.patronymic].map((part) => part.trim()).filter(Boolean).join(' ');
const looksLikePhone = (value: string) => value.replace(/\D/g, '').length >= 9 && /^[+\d\s()-]+$/.test(value.trim());

/** Surname, name and patronymic in three boxes. */
function FioFields({ value, onChange, language }: { value: Fio; onChange: (next: Fio) => void; language: Language }) {
  return (
    <div className="people-form-grid">
      <input className="input" value={value.surname} onChange={(event) => onChange({ ...value, surname: event.target.value })} placeholder={t(language, 'Familiya', 'Фамилия', 'Surname')} aria-label={t(language, 'Familiya', 'Фамилия', 'Surname')} />
      <input className="input" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder={t(language, 'Ism', 'Имя', 'Name')} aria-label={t(language, 'Ism', 'Имя', 'Name')} />
      <input className="input" value={value.patronymic} onChange={(event) => onChange({ ...value, patronymic: event.target.value })} placeholder={t(language, 'Otasining ismi', 'Отчество', 'Patronymic')} aria-label={t(language, 'Otasining ismi', 'Отчество', 'Patronymic')} />
    </div>
  );
}

/** Many pupils of one class: one per line, a phone and a parent's name may follow after a comma. */
function parseMany(text: string, className: string): { rows: Array<Record<string, unknown>>; pupils: number; parents: number } {
  const table = parseTable(text);
  // Pasted from Excel with a class column: use the old format as it is.
  if (text.includes('\t') && table.rows.length) {
    return { rows: table.rows, pupils: table.rows.filter((row) => row.role === 'student').length, parents: table.rows.filter((row) => row.role === 'parent').length };
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[;,\t]/).map((cell) => cell.trim()).filter(Boolean);
    const name = cells[0]?.replace(/^\d+[.)]\s*/, '');
    if (!name || name.split(/\s+/).length < 2) continue;
    rows.push({ role: 'student', name, className });
    const phone = cells.slice(1).find(looksLikePhone);
    const parentName = cells.slice(1).find((cell) => !looksLikePhone(cell));
    if (phone || parentName) rows.push({ role: 'parent', name: parentName || `${name} — родитель`, childName: name, phone });
  }
  return { rows, pupils: rows.filter((row) => row.role === 'student').length, parents: rows.filter((row) => row.role === 'parent').length };
}

/**
 * Adding people, one clear form per kind: a pupil (with a parent and the document photo),
 * many pupils of a class at once (no Excel needed), a teacher, a parent, a deputy.
 */
export function EnrollRequestPanel({ schoolId, language, onSent }: { schoolId: string; language: Language; onSent?: () => void }) {
  const [mode, setMode] = useState<AddMode>('student');
  const [classes, setClasses] = useState<string[]>([]);
  const [pupils, setPupils] = useState<Array<{ id: string; name: string; className: string }>>([]);
  const [fio, setFio] = useState<Fio>(EMPTY_FIO);
  const [className, setClassName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentAccount, setParentAccount] = useState(true);
  const [childId, setChildId] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [many, setMany] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Array<Created & { userId?: string }>>([]);
  const [newTeacher, setNewTeacher] = useState(false);

  const loadPeople = useCallback(() => {
    void customFetch<{ people: Array<{ id: string; name: string; role: string; status: string; classes: string[] }>; classes: string[] }>(`/api/schools/${schoolId}/people`, { method: 'GET' })
      .then((data) => {
        setClasses(data.classes);
        setPupils(data.people.filter((person) => person.role === 'student' && person.status === 'active').map((person) => ({ id: person.id, name: person.name, className: person.classes[0] ?? '' })));
        setClassName((current) => current || data.classes[0] || '');
      })
      .catch(() => {});
  }, [schoolId]);
  useEffect(() => { loadPeople(); }, [loadPeople]);

  const parsedMany = useMemo(() => parseMany(many, className), [many, className]);
  const fullName = fioText(fio);
  const reset = () => { setFio(EMPTY_FIO); setPhone(''); setParentName(''); setParentPhone(''); setSubjects([]); setMany(''); setDoc(null); setChildId(''); };

  function switchMode(next: AddMode) { setMode(next); setError(''); setMessage(''); setNewTeacher(false); }

  function rowsToSend(): Array<Record<string, unknown>> {
    if (mode === 'many') return parsedMany.rows;
    if (mode === 'teacher') return [{ role: 'teacher', name: fullName, phone: phone.trim() || undefined, subjects }];
    if (mode === 'deputy') return [{ role: 'school_admin', name: fullName, phone: phone.trim() || undefined }];
    if (mode === 'parent') {
      const child = pupils.find((pupil) => pupil.id === childId);
      return child ? [{ role: 'parent', name: fullName, childName: child.name, phone: phone.trim() || undefined }] : [];
    }
    const rows: Array<Record<string, unknown>> = [{ role: 'student', name: fullName, className, phone: !parentAccount ? parentPhone.trim() || undefined : undefined }];
    if (parentAccount && (parentName.trim() || parentPhone.trim())) rows.push({ role: 'parent', name: parentName.trim() || `${fullName} — родитель`, childName: fullName, phone: parentPhone.trim() || undefined });
    return rows;
  }

  const ready = mode === 'many' ? parsedMany.pupils > 0 && Boolean(className || many.includes('\t'))
    : mode === 'parent' ? Boolean(fio.surname.trim() && fio.name.trim() && childId)
    : mode === 'teacher' ? Boolean(fio.surname.trim() && fio.name.trim() && subjects.length)
    : mode === 'student' ? Boolean(fio.surname.trim() && fio.name.trim() && className)
    : Boolean(fio.surname.trim() && fio.name.trim());

  async function send() {
    const rows = rowsToSend();
    if (!rows.length) return;
    if (mode === 'many' && !window.confirm(t(language, `${parsedMany.pupils} o‘quvchi qo‘shilsinmi?`, `Добавить учеников: ${parsedMany.pupils}?`, `Add ${parsedMany.pupils} pupils?`))) return;
    setBusy(true); setError(''); setMessage(''); setCreated([]); setNewTeacher(false);
    try {
      const response = await customFetch<{ result?: { created?: Array<Created & { userId?: string }>; skipped?: Array<{ name: string; reason: string }> } }>(`/api/schools/${schoolId}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'enroll', rows }) });
      const people = response.result?.created ?? [];
      const pupil = people.find((person) => person.role === 'student');
      let docNote = '';
      if (doc && pupil?.userId) {
        try {
          const data = await compressImage(doc);
          await customFetch(`/api/schools/${schoolId}/people/${pupil.userId}/document`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
          docNote = t(language, ' Hujjat surati saqlandi.', ' Фото документа сохранено.', ' Document photo saved.');
        } catch {
          docNote = t(language, ' Hujjat suratini saqlab bo‘lmadi — keyinroq «Maktab odamlari»da qo‘shing.', ' Фото документа не сохранилось — добавьте позже в «Люди школы».', ' The document photo was not saved — add it later.');
        }
      }
      setCreated(people);
      const skipped = response.result?.skipped ?? [];
      setMessage(t(language, `Qo‘shildi: ${people.length}.`, `Добавлено: ${people.length}.`, `Added: ${people.length}.`) + docNote
        + (skipped.length ? t(language, ` O‘tkazib yuborildi: ${skipped.map((item) => item.name).join(', ')}.`, ` Не добавлены: ${skipped.map((item) => item.name).join(', ')}.`, ` Skipped: ${skipped.map((item) => item.name).join(', ')}.`) : ''));
      setNewTeacher(mode === 'teacher' && people.length > 0);
      reset();
      loadPeople();
      onSent?.();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const modes: Array<[AddMode, string]> = [
    ['student', t(language, 'O‘quvchi', 'Ученик', 'Pupil')],
    ['many', t(language, 'Ro‘yxat', 'Списком', 'A list')],
    ['teacher', t(language, 'O‘qituvchi', 'Учитель', 'Teacher')],
    ['parent', t(language, 'Ota-ona', 'Родитель', 'Parent')],
    ['deputy', t(language, 'Zavuch', 'Завуч', 'Deputy')],
  ];
  const classField = classes.length
    ? <Select className="input" value={className} onChange={(event) => setClassName(event.target.value)} aria-label={t(language, 'Sinf', 'Класс', 'Class')}>{classes.map((name) => <option key={name} value={name}>{name}</option>)}</Select>
    : <input className="input" value={className} onChange={(event) => setClassName(event.target.value)} placeholder={t(language, 'Sinf, masalan 7-A', 'Класс, например 7-А', 'Class, e.g. 7-A')} />;

  return (
    <section className="panel add-people">
      <h2><UserPlus size={16} /> {t(language, 'Odam qo‘shish', 'Добавить человека', 'Add a person')}</h2>
      <LensRow className="add-people-modes" aria-label={t(language, 'Kimni qo‘shish', 'Кого добавить', 'Who to add')}>
        {modes.map(([key, text]) => <button type="button" role="tab" key={key} aria-selected={mode === key} className={mode === key ? 'on' : ''} onClick={() => switchMode(key)}>{text}</button>)}
      </LensRow>

      {mode === 'many' ? (
        <div className="add-people-form">
          <label className="add-field"><small>{t(language, 'Sinf', 'Класс', 'Class')}</small>{classField}</label>
          <label className="add-field">
            <small>{t(language, 'Har bir o‘quvchi — yangi qatorda. Vergul bilan ota-ona telefoni va F.I.Sh. qo‘shsa bo‘ladi.', 'Каждый ученик — с новой строки. Через запятую можно добавить телефон и ФИО родителя.', 'One pupil per line. A parent phone and name may follow after commas.')}</small>
            <textarea className="import-area" rows={7} value={many} onChange={(event) => setMany(event.target.value)} spellCheck={false}
              placeholder={'Каримов Азиз Рустамович, +998 90 123 45 67, Каримов Рустам\nАлиева Мадина Шухратовна\n…'} />
          </label>
          {many.trim() && <p className="muted">{t(language, `O‘quvchilar: ${parsedMany.pupils} · ota-onalar: ${parsedMany.parents}`, `Учеников: ${parsedMany.pupils} · родителей: ${parsedMany.parents}`, `Pupils: ${parsedMany.pupils} · parents: ${parsedMany.parents}`)}</p>}
        </div>
      ) : (
        <div className="add-people-form">
          <FioFields value={fio} onChange={setFio} language={language} />
          {mode === 'student' && (
            <>
              <label className="add-field"><small>{t(language, 'Sinf', 'Класс', 'Class')}</small>{classField}</label>
              <div className="people-form-grid two">
                <input className="input" value={parentName} onChange={(event) => setParentName(event.target.value)} placeholder={t(language, 'Ota-onaning F.I.Sh.', 'ФИО родителя', 'Parent’s full name')} />
                <input className="input" inputMode="tel" value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} placeholder={t(language, 'Ota-ona telefoni', 'Телефон родителя', 'Parent’s phone')} />
              </div>
              <label className="add-check"><input type="checkbox" checked={parentAccount} onChange={(event) => setParentAccount(event.target.checked)} /> {t(language, 'Ota-onaga ham login va parol berish', 'Дать родителю логин и пароль', 'Give the parent a login and password')}</label>
              <label className="add-doc">
                <input type="file" accept="image/*" onChange={(event) => setDoc(event.target.files?.[0] ?? null)} />
                <span className="btn small"><Camera size={14} /> {doc ? t(language, 'Hujjat tanlandi ✓', 'Документ выбран ✓', 'Document chosen ✓') : t(language, 'Hujjat surati (guvohnoma)', 'Фото документа (свидетельство)', 'Document photo')}</span>
              </label>
            </>
          )}
          {mode === 'parent' && (
            <>
              <label className="add-field"><small>{t(language, 'Kimning ota-onasi', 'Чей родитель', 'Parent of')}</small>
                <Select className="input" value={childId} onChange={(event) => setChildId(event.target.value)}>
                  <option value="">{t(language, 'O‘quvchini tanlang', 'Выберите ученика', 'Choose a pupil')}</option>
                  {pupils.map((pupil) => <option key={pupil.id} value={pupil.id}>{pupil.name}{pupil.className ? ` · ${pupil.className}` : ''}</option>)}
                </Select>
              </label>
              <input className="input" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t(language, 'Telefon', 'Телефон', 'Phone')} />
            </>
          )}
          {(mode === 'teacher' || mode === 'deputy') && <input className="input" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t(language, 'Telefon', 'Телефон', 'Phone')} />}
          {mode === 'teacher' && (
            <label className="add-field"><small>{t(language, 'Qaysi fanlarni o‘qitadi', 'Какие предметы ведёт', 'Subjects taught')}</small>
              <SubjectPicker value={subjects} onChange={setSubjects} language={language} />
            </label>
          )}
        </div>
      )}

      <button type="button" className="btn primary add-people-send" disabled={busy || !ready} onClick={() => void send()}>
        <UserPlus size={15} /> {mode === 'many' && parsedMany.pupils ? t(language, `Qo‘shish: ${parsedMany.pupils}`, `Добавить: ${parsedMany.pupils}`, `Add ${parsedMany.pupils}`) : t(language, 'Qo‘shish', 'Добавить', 'Add')}
      </button>
      {message && <div className="notice success">{message}</div>}
      {newTeacher && (
        <div className="notice add-people-next">
          <CalendarDays size={16} />
          <span>{t(language, 'Yangi o‘qituvchining jadvali hali yo‘q. Jadvalga darslarini qo‘shing — u saytda va Telegramda ko‘radi.', 'У нового учителя ещё нет расписания. Добавьте его уроки в расписание — он увидит их на сайте и в Telegram.', 'The new teacher has no timetable yet. Add their lessons — they will see them on the site and in Telegram.')}</span>
          <a className="btn small primary" href="/schedule">{t(language, 'Jadvalni ochish', 'Открыть расписание', 'Open the timetable')}</a>
        </div>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
      {created.length > 0 && <CredentialList people={created.map((person) => ({ name: person.name, login: person.login, password: person.password, sub: [person.className, label(language, ROLE_TEXT[person.role], person.role)].filter(Boolean).join(' · ') }))} language={language} onClose={() => setCreated([])} />}
    </section>
  );
}

export function MyRequestsPanel({ schoolId, language, revision = 0 }: { schoolId: string; language: Language; revision?: number }) {
  const [requests, setRequests] = useState<Request[]>([]);
  useEffect(() => {
    void customFetch<{ requests: Request[] }>(`/api/schools/${schoolId}/requests`, { method: 'GET' }).then((data) => setRequests(data.requests)).catch(() => {});
  }, [schoolId, revision]);
  return (
    <section className="panel">
      <h2><ClipboardList size={16} /> {t(language, 'Mening o‘zgarishlarim', 'Мои изменения', 'My changes')}</h2>
      {requests.length === 0 ? <p className="muted">{t(language, 'Hali o‘zgarish yo‘q.', 'Изменений пока нет.', 'No changes yet.')}</p> : (
        <div className="people-list">
          {requests.map((request) => {
            const st = REQ_STATUS[request.status] ?? REQ_STATUS.pending;
            return (
              <div key={request.id} className="people-row">
                <div className="people-main">
                  <b>{label(language, KIND_TEXT[request.kind], request.kind)}</b>
                  <small className="muted">{describeRequest(language, request)}</small>
                  <small className="muted">{when(request.createdAt)}{request.reason ? ` · ${request.reason}` : ''}{request.decisionNote ? ` · EDUVERSE: ${request.decisionNote}` : ''}</small>
                </div>
                <span className={`tag ${st[3]}`}>{label(language, st, request.status)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Owner: the queue of all schools                                      */
/* ------------------------------------------------------------------ */

export function OwnerRequestsPanel({ language }: { language: Language }) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [requests, setRequests] = useState<Request[]>([]);
  const [created, setCreated] = useState<{ school: string; people: Created[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    void customFetch<{ requests: Request[] }>(`/api/admin/requests${filter === 'pending' ? '?status=pending' : ''}`, { method: 'GET' })
      .then((data) => setRequests(data.requests)).catch((requestError) => setError(friendlyError(requestError, language)));
  }, [filter, language]);
  useEffect(() => { load(); }, [load]);

  async function decide(request: Request, decision: 'approve' | 'reject') {
    let note = '';
    if (decision === 'reject') {
      const answer = window.prompt(t(language, 'Rad etish sababi (maktab ko‘radi):', 'Причина отказа (школа увидит):', 'Reason (the school will see it):'));
      if (answer === null) return;
      note = answer;
    } else if (!window.confirm(t(language, `Tasdiqlaysizmi? ${request.schoolName}: ${label(language, KIND_TEXT[request.kind], request.kind)} — ${describeRequest(language, request)}`, `Подтвердить? ${request.schoolName}: ${label(language, KIND_TEXT[request.kind], request.kind)} — ${describeRequest(language, request)}`, `Approve? ${request.schoolName}: ${describeRequest(language, request)}`))) {
      return;
    }
    setBusy(request.id); setError('');
    try {
      const response = await customFetch<{ result: { created?: Created[] } }>(`/api/admin/requests/${request.id}/${decision}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      if (response.result?.created?.length) setCreated({ school: request.schoolName, people: response.result.created });
      load();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="panel owner-queue">
      <div className="section-head">
        <h2><Inbox size={16} /> {t(language, 'Maktablar arizalari', 'Заявки школ', 'School requests')} {filter === 'pending' && requests.length > 0 && <span className="tag gold">{requests.length}</span>}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`btn small ${filter === 'pending' ? 'primary' : ''}`} onClick={() => setFilter('pending')}>{t(language, 'Kutilmoqda', 'Ждут', 'Pending')}</button>
          <button type="button" className={`btn small ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>{t(language, 'Hammasi', 'Все', 'All')}</button>
          <button type="button" className="btn small" onClick={load}><RefreshCw size={13} /></button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {created && (
        <div className="owner-created">
          <b>{created.school}: {t(language, 'yaratildi', 'созданы аккаунты', 'accounts created')} · {created.people.length}</b>
          <CredentialList people={created.people.map((person) => ({ name: person.name, login: person.login, password: person.password, sub: [person.className, label(language, ROLE_TEXT[person.role], person.role)].filter(Boolean).join(' · ') }))} language={language} onClose={() => setCreated(null)} />
        </div>
      )}
      {requests.length === 0 ? <p className="muted">{filter === 'pending' ? t(language, 'Yangi ariza yo‘q.', 'Новых заявок нет.', 'No new requests.') : t(language, 'Arizalar yo‘q.', 'Заявок нет.', 'No requests.')}</p> : (
        <div className="people-list">
          {requests.map((request) => {
            const st = REQ_STATUS[request.status] ?? REQ_STATUS.pending;
            return (
              <div key={request.id} className="people-row">
                <div className="people-main">
                  <b>{request.schoolName} · {label(language, KIND_TEXT[request.kind], request.kind)}</b>
                  <small className="muted">{describeRequest(language, request)}</small>
                  <small className="muted">{when(request.createdAt)} · {request.author}{request.reason ? ` · ${request.reason}` : ''}</small>
                </div>
                {request.status === 'pending' ? (
                  <div className="people-actions">
                    <button type="button" className="btn small primary" disabled={busy === request.id} onClick={() => void decide(request, 'approve')}><Check size={13} /> {t(language, 'Tasdiqlash', 'Подтвердить', 'Approve')}</button>
                    <button type="button" className="btn small" disabled={busy === request.id} onClick={() => void decide(request, 'reject')}><X size={13} /> {t(language, 'Rad etish', 'Отклонить', 'Reject')}</button>
                  </div>
                ) : <span className={`tag ${st[3]}`}>{label(language, st, request.status)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The owner's journal: who did what in a school. */
export function AuditPanel({ schoolId, language }: { schoolId: string; language: Language }) {
  const [entries, setEntries] = useState<Array<{ id: string; action: string; actor: string | null; createdAt: string; details: Record<string, unknown> }>>([]);
  useEffect(() => {
    void customFetch<{ entries: typeof entries }>(`/api/admin/audit?schoolId=${schoolId}`, { method: 'GET' }).then((data) => setEntries(data.entries)).catch(() => {});
  }, [schoolId]);
  const actionText = (action: string) => {
    const [head, kind] = action.split(':');
    const k = (kind ?? head) as Kind;
    const base = KIND_TEXT[k] ? label(language, KIND_TEXT[k], k) : action === 'import' ? t(language, 'Import', 'Загрузка людей', 'Import') : action;
    return head === 'request' ? `${t(language, 'Ariza', 'Заявка', 'Request')}: ${base}` : head === 'reject' ? `${t(language, 'Rad etildi', 'Отклонено', 'Rejected')}: ${base}` : base;
  };
  return (
    <section className="panel">
      <h2><History size={16} /> {t(language, 'Harakatlar jurnali', 'Журнал действий', 'Activity log')}</h2>
      {entries.length === 0 ? <p className="muted">{t(language, 'Hali yozuv yo‘q.', 'Записей пока нет.', 'No entries yet.')}</p> : (
        <div className="people-list">
          {entries.map((entry) => (
            <div key={entry.id} className="people-row">
              <div className="people-main">
                <b>{actionText(entry.action)}</b>
                <small className="muted">{when(entry.createdAt)} · {entry.actor ?? '—'}{typeof entry.details.name === 'string' ? ` · ${entry.details.name}` : ''}{typeof entry.details.reason === 'string' && entry.details.reason ? ` · ${entry.details.reason}` : ''}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The director's / deputy's area: enrol request, people with request buttons, my requests. */
export function SchoolRequestsArea({ schoolId, language }: { schoolId: string; language: Language }) {
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((value) => value + 1);
  return (
    <>
      <EnrollRequestPanel schoolId={schoolId} language={language} onSent={bump} />
      <SchoolPeoplePanel schoolId={schoolId} language={language} mode="request" onChanged={bump} />
      <MyRequestsPanel schoolId={schoolId} language={language} revision={revision} />
    </>
  );
}
