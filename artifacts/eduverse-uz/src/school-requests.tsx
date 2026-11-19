import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from './ui/select';
import { customFetch } from '@workspace/api-client-react';
import { Check, ClipboardList, History, Inbox, Pencil, RefreshCw, UserMinus, UserPlus, X } from 'lucide-react';
import type { Language } from './school-data';
import { parseTable } from './school-tools';
import { friendlyError } from './errors';

/*
 * People of a school:
 *  - the director / deputy makes the change at once (it is kept in the journal);
 *  - the owner can also change a person directly.
 * Nothing is deleted: an expelled pupil keeps grades and attendance.
 */

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

type Kind = 'enroll' | 'expel' | 'transfer' | 'graduate' | 'restore' | 'edit';
type Person = { id: string; name: string; login: string; role: string; phone: string | null; status: string; statusReason: string; classes: string[] };
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
export function SchoolPeoplePanel({ schoolId, language, mode, onChanged }: { schoolId: string; language: Language; mode: 'request' | 'owner'; onChanged?: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('student');
  const [statusFilter, setStatusFilter] = useState('active');
  const [action, setAction] = useState<{ person: Person; kind: Kind } | null>(null);
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState({ name: '', phone: '', className: '', toSchool: '' });
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
    setEdit({ name: person.name, phone: person.phone ?? '', className: person.classes[0] ?? '', toSchool: '' });
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
      <div className="people-filters">
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'F.I.Sh., login, sinf yoki telefon', 'ФИО, логин, класс или телефон', 'Name, login, class or phone')} />
        <Select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="all">{t(language, 'Hammasi', 'Все роли', 'All roles')}</option>
          {Object.entries(ROLE_TEXT).map(([key, value]) => <option key={key} value={key}>{label(language, value, key)}</option>)}
        </Select>
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
                <small className="muted">{label(language, ROLE_TEXT[person.role], person.role)}{person.classes.length ? ` · ${person.classes.join(', ')}` : ''} · {person.login}{person.phone ? ` · ${person.phone}` : ''}</small>
                {person.status !== 'active' && person.statusReason && <small className="muted">{person.statusReason}</small>}
              </div>
              <span className={`tag ${status[3]}`}>{label(language, status, person.status)}</span>
              {(!isDirector || mode === 'owner') && (
                <div className="people-actions">
                  <button type="button" className="btn small" onClick={() => open(person, 'edit')}><Pencil size={13} /> {t(language, 'Tuzatish', 'Исправить', 'Edit')}</button>
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

export function EnrollRequestPanel({ schoolId, language, onSent }: { schoolId: string; language: Language; onSent?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created[]>([]);
  const parsed = useMemo(() => parseTable(text), [text]);
  async function send() {
    if (parsed.rows.length === 0) return;
    if (!window.confirm(t(language, `${parsed.rows.length} kishi qabul qilinsinmi?`, `Принять в школу: ${parsed.rows.length} чел.?`, `Enrol ${parsed.rows.length} people?`))) return;
    setBusy(true); setError(''); setMessage(''); setCreated([]);
    try {
      const response = await customFetch<{ result?: { created?: Created[]; skipped?: unknown[] } }>(`/api/schools/${schoolId}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'enroll', rows: parsed.rows }) });
      setText('');
      setCreated(response.result?.created ?? []);
      setMessage(t(language, 'Qabul qilindi. Loginlar va parollar pastda.', 'Готово, ученики приняты. Логины и пароли ниже.', 'Done. Logins and passwords are below.'));
      onSent?.();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2><UserPlus size={16} /> {t(language, 'Yangi o‘quvchilarni qabul qilish', 'Принять новых учеников', 'Enrol new pupils')}</h2>
      <p className="muted">{t(language, 'Excel’dan qo‘ying: F.I.Sh. · Sinf · Ota-ona telefoni · Ota-ona F.I.Sh. O‘qituvchi uchun birinchi ustunda «o‘qituvchi».', 'Вставьте из Excel: ФИО · Класс · Телефон родителя · ФИО родителя. Для учителя в первом столбце «учитель», для завуча — «завуч».', 'Paste from Excel: Name · Class · Parent phone · Parent name.')}</p>
      <textarea className="import-area" rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder={'Азиз Каримов\t7-А\t+998 90 123 45 67\tКарим Каримов'} spellCheck={false} />
      {text.trim() && <p className="muted">{t(language, `Tayyor: ${parsed.rows.length} qator`, `Распознано строк: ${parsed.rows.length}`, `Rows: ${parsed.rows.length}`)}{parsed.errors.length ? ` · ${t(language, 'xato qatorlar', 'ошибки в строках', 'bad rows')}: ${parsed.errors.join(', ')}` : ''}</p>}
      <button type="button" className="btn primary" disabled={busy || parsed.rows.length === 0} onClick={() => void send()}><UserPlus size={14} /> {t(language, 'Qabul qilish', 'Принять', 'Enrol')}</button>
      {message && <div className="notice success" style={{ marginTop: 8 }}>{message}</div>}
      {created.length > 0 && (
        <div className="notice success owner-created" style={{ marginTop: 8 }}>
          <small>{t(language, 'Parollar faqat hozir ko‘rinadi — chop eting yoki saqlang.', 'Пароли видны только сейчас — распечатайте или сохраните.', 'Passwords are shown only now.')}</small>
          <div className="owner-created-list">
            {created.map((person) => <div key={person.login}><b>{person.name}</b> {person.className && `· ${person.className}`} · {label(language, ROLE_TEXT[person.role], person.role)} · {t(language, 'login', 'логин', 'login')}: <code>{person.login}</code> · {t(language, 'parol', 'пароль', 'password')}: <code>{person.password}</code></div>)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => window.print()}>{t(language, 'Chop etish', 'Распечатать', 'Print')}</button>
            <button type="button" className="btn small" onClick={() => setCreated([])}>{t(language, 'Yopish', 'Закрыть', 'Close')}</button>
          </div>
        </div>
      )}
      {error && <div className="notice" style={{ marginTop: 8 }}>{error}</div>}
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
        <div className="notice success owner-created">
          <b>{created.school}: {t(language, 'yaratildi', 'созданы аккаунты', 'accounts created')} · {created.people.length}</b>
          <small>{t(language, 'Parollar faqat hozir ko‘rinadi — chop eting yoki saqlang.', 'Пароли видны только сейчас — распечатайте или сохраните и передайте школе.', 'Passwords are shown only now.')}</small>
          <div className="owner-created-list">
            {created.people.map((person) => <div key={person.login}><b>{person.name}</b> {person.className && `· ${person.className}`} · {label(language, ROLE_TEXT[person.role], person.role)} · {t(language, 'login', 'логин', 'login')}: <code>{person.login}</code> · {t(language, 'parol', 'пароль', 'password')}: <code>{person.password}</code></div>)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => window.print()}>{t(language, 'Chop etish', 'Распечатать', 'Print')}</button>
            <button type="button" className="btn small" onClick={() => setCreated(null)}>{t(language, 'Yopish', 'Закрыть', 'Close')}</button>
          </div>
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
