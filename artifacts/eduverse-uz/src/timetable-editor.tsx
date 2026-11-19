import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CalendarDays, Clock3, RefreshCw, Save, Sparkles } from 'lucide-react';
import type { Language } from './school-data';
import { Select } from './ui/select';
import { friendlyError } from './errors';
import { lessonSubjectName } from './today';

/*
 * Weekly timetable of a school, kept by the director or deputy.
 * Pick a class → a grid of weekdays × periods; each cell has a subject and a teacher.
 * Bell times are shared by the whole school.
 */

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

type Slot = { classId: string; weekday: number; period: number; subject: string; teacherId: string | null; room: string | null };
type Bell = { start: string; end: string };
type Timetable = { slots: Slot[]; classes: Array<{ id: string; name: string; grade: number }>; teachers: Array<{ id: string; name: string }>; bells: Bell[]; canEdit: boolean };

const DAYS: Array<[string, string, string]> = [
  ['Dushanba', 'Понедельник', 'Monday'], ['Seshanba', 'Вторник', 'Tuesday'], ['Chorshanba', 'Среда', 'Wednesday'],
  ['Payshanba', 'Четверг', 'Thursday'], ['Juma', 'Пятница', 'Friday'], ['Shanba', 'Суббота', 'Saturday'],
];
/** Textbook subjects first (they open topics and 3D), then the other school subjects. */
const SUBJECT_CHOICES = ['math', 'physics', 'chemistry', 'biology', 'Узбекский язык', 'Русский язык', 'Английский язык', 'История', 'География', 'Информатика', 'Литература', 'Физкультура'];

export function TimetableEditor({ schoolId, language }: { schoolId: string; language: Language }) {
  const [data, setData] = useState<Timetable | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bells, setBells] = useState<Bell[]>([]);
  const [classId, setClassId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const apply = useCallback((next: Timetable) => {
    setData(next); setSlots(next.slots); setBells(next.bells); setDirty(false);
    setClassId((current) => (next.classes.some((item) => item.id === current) ? current : next.classes[0]?.id ?? ''));
  }, []);
  const load = useCallback(() => {
    void customFetch<Timetable>(`/api/schools/${schoolId}/timetable`, { method: 'GET' }).then(apply).catch((requestError) => setError(friendlyError(requestError, language)));
  }, [schoolId, language, apply]);
  useEffect(() => { load(); }, [load]);

  const cell = (weekday: number, period: number) => slots.find((slot) => slot.classId === classId && slot.weekday === weekday && slot.period === period);
  const setCell = (weekday: number, period: number, patch: Partial<Slot> | null) => {
    setDirty(true); setMessage('');
    setSlots((current) => {
      const rest = current.filter((slot) => !(slot.classId === classId && slot.weekday === weekday && slot.period === period));
      if (patch === null) return rest;
      const old = current.find((slot) => slot.classId === classId && slot.weekday === weekday && slot.period === period);
      return [...rest, { classId, weekday, period, subject: 'math', teacherId: null, room: null, ...old, ...patch }];
    });
  };
  /** A teacher who already has a lesson at that time in another class. */
  const clash = (weekday: number, period: number, teacherId: string | null) =>
    Boolean(teacherId) && slots.some((slot) => slot.classId !== classId && slot.weekday === weekday && slot.period === period && slot.teacherId === teacherId);

  const subjectOptions = useMemo(() => [
    { value: '', label: t(language, '— dars yo‘q —', '— нет урока —', '— no lesson —') },
    ...SUBJECT_CHOICES.map((value) => ({ value, label: lessonSubjectName(value, language) })),
  ], [language]);
  const teacherOptions = useMemo(() => [
    { value: '', label: t(language, 'O‘qituvchi tanlanmagan', 'Учитель не выбран', 'No teacher') },
    ...(data?.teachers ?? []).map((item) => ({ value: item.id, label: item.name })),
  ], [data, language]);

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await customFetch<Timetable>(`/api/schools/${schoolId}/timetable`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots, bells }) });
      apply(next);
      setMessage(t(language, 'Jadval saqlandi. O‘qituvchi va o‘quvchilar bugungi darslarni ko‘radi.', 'Расписание сохранено. Учителя и ученики сразу видят свои уроки на сегодня.', 'Saved. Teachers and students now see today’s lessons.'));
    } catch (requestError) { setError(friendlyError(requestError, language)); } finally { setBusy(false); }
  }
  async function fillDemo() {
    if (slots.length && !window.confirm(t(language, 'Hozirgi jadval namunaga almashtirilsinmi?', 'Заменить текущее расписание примером?', 'Replace the current timetable with an example?'))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      apply(await customFetch<Timetable>(`/api/schools/${schoolId}/timetable/demo`, { method: 'POST' }));
      setMessage(t(language, 'Namuna jadval to‘ldirildi. Uni o‘zgartirib, saqlang.', 'Пример расписания заполнен. Поправьте под школу и сохраните.', 'An example timetable is filled in.'));
    } catch (requestError) { setError(friendlyError(requestError, language)); } finally { setBusy(false); }
  }

  if (!data) return <section className="panel"><h2><CalendarDays size={16} /> {t(language, 'Dars jadvali', 'Расписание уроков', 'Timetable')}</h2>{error ? <div className="notice" role="alert">{error}</div> : <p className="muted">…</p>}</section>;
  const editable = data.canEdit;
  const periods = bells.length;
  return (
    <section className="panel tt-panel">
      <div className="section-head">
        <h2><CalendarDays size={16} /> {t(language, 'Dars jadvali', 'Расписание уроков', 'Timetable')}</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {data.classes.length > 0 && <Select value={classId} onChange={(_event, value) => setClassId(value)} options={data.classes.map((item) => ({ value: item.id, label: t(language, `${item.name} sinf`, `${item.name} класс`, `Class ${item.name}`) }))} aria-label={t(language, 'Sinf', 'Класс', 'Class')} style={{ width: 170 }} />}
          <button type="button" className="btn small" onClick={load} aria-label={t(language, 'Yangilash', 'Обновить', 'Reload')}><RefreshCw size={13} /></button>
        </div>
      </div>
      <p className="muted">{t(language, 'Har bir katakda fan va o‘qituvchi. Saqlangandan keyin har kim «Umumiy ko‘rinish»da bugungi darslarini ko‘radi.', 'В каждой клетке — предмет и учитель. После сохранения каждый видит свои уроки на сегодня на главной странице.', 'Each cell has a subject and a teacher. After saving, everyone sees today’s lessons on the overview.')}</p>
      {data.classes.length === 0 ? <div className="notice">{t(language, 'Avval sinflarni qo‘shing.', 'Сначала добавьте классы.', 'Add classes first.')}</div> : (
        <div className="tt-scroll">
          <table className="tt-grid">
            <thead>
              <tr><th className="tt-corner"><Clock3 size={14} /></th>{DAYS.map((day) => <th key={day[2]}>{t(language, ...day)}</th>)}</tr>
            </thead>
            <tbody>
              {Array.from({ length: periods }, (_, index) => index + 1).map((period) => (
                <tr key={period}>
                  <th className="tt-period">
                    <b>{period}</b>
                    {editable ? (
                      <span className="tt-bell">
                        <input className="input" type="time" value={bells[period - 1]?.start ?? ''} aria-label={t(language, 'Boshlanishi', 'Начало', 'Start')} onChange={(event) => { setDirty(true); setBells((current) => current.map((bell, i) => (i === period - 1 ? { ...bell, start: event.target.value } : bell))); }} />
                        <input className="input" type="time" value={bells[period - 1]?.end ?? ''} aria-label={t(language, 'Tugashi', 'Конец', 'End')} onChange={(event) => { setDirty(true); setBells((current) => current.map((bell, i) => (i === period - 1 ? { ...bell, end: event.target.value } : bell))); }} />
                      </span>
                    ) : <small>{bells[period - 1]?.start}–{bells[period - 1]?.end}</small>}
                  </th>
                  {DAYS.map((_, dayIndex) => {
                    const weekday = dayIndex + 1;
                    const slot = cell(weekday, period);
                    const conflict = slot ? clash(weekday, period, slot.teacherId) : false;
                    return (
                      <td key={weekday} className={`${slot ? 'has-lesson' : ''} ${conflict ? 'is-clash' : ''}`}>
                        {editable ? (
                          <div className="tt-cell">
                            <Select value={slot?.subject ?? ''} options={subjectOptions} aria-label={t(language, 'Fan', 'Предмет', 'Subject')} onChange={(_event, value) => setCell(weekday, period, value ? { subject: value } : null)} />
                            {slot && <Select value={slot.teacherId ?? ''} options={teacherOptions} aria-label={t(language, 'O‘qituvchi', 'Учитель', 'Teacher')} onChange={(_event, value) => setCell(weekday, period, { teacherId: value || null })} />}
                            {conflict && <small className="tt-clash-note">{t(language, 'Bu vaqtda boshqa sinfda', 'В это время уже в другом классе', 'Busy in another class')}</small>}
                          </div>
                        ) : slot ? (
                          <div className="tt-cell-view"><b>{lessonSubjectName(slot.subject, language)}</b><small>{data.teachers.find((item) => item.id === slot.teacherId)?.name ?? ''}</small></div>
                        ) : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="row tt-actions">
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}><Save size={15} /> {t(language, 'Saqlash', 'Сохранить расписание', 'Save timetable')}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void fillDemo()}><Sparkles size={15} /> {t(language, 'Namuna bilan to‘ldirish', 'Заполнить примером', 'Fill with an example')}</button>
          {dirty && <span className="muted">{t(language, 'Saqlanmagan o‘zgarishlar bor', 'Есть несохранённые изменения', 'Unsaved changes')}</span>}
        </div>
      )}
      {message && <div className="notice success" role="status">{message}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
