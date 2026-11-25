import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { BookOpenCheck, RefreshCw } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { Select } from './ui/select';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';
import { lessonSubjectName } from './today';
import { MARKS, markBand } from './marks';
import { GradeJournal } from './extras';

/*
 * Class journal like the electronic school journal: columns are the lesson dates of one subject
 * (from the timetable), rows are pupils. Tap a cell → 2…10 or «нб». Nothing below 2.
 * A pupil marked absent at attendance shows «нб» by itself.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Kind = 'class' | 'homework';
type Mark = { kind?: Kind; studentId: string; date: string; mark: number | null; absent: boolean; comment?: string | null };
type Data = { subject: string; subjects: string[]; today: string; dates: string[]; students: Array<{ id: string; name: string }>; marks: Mark[]; absences: Array<{ studentId: string; date: string }> };

const MONTHS_SHORT: Record<Language, string[]> = {
  Uzbek: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  'Русский': ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  English: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export function ClassJournal({ school, language }: { school: SchoolData; language: Language }) {
  const [classId, setClassId] = useState(school.classes[0]?.id ?? '');
  // Until the teacher picks a class, skip classes without lessons of theirs (opens on a class with a timetable).
  const picked = useRef(false);
  const tried = useRef(new Set<string>());
  const [subject, setSubject] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [hideAsked, setHideAsked] = useState(false);

  // One table: for every lesson the mark for the lesson and the mark for homework, side by side.
  const load = useCallback(async () => {
    if (!classId) return;
    setError('');
    try {
      const query = `${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`;
      const lesson = await customFetch<Data>(`/api/classes/${classId}/marks?kind=class${query}`, { method: 'GET' });
      tried.current.add(classId);
      if (!picked.current && lesson.dates.length === 0) {
        const other = school.classes.find((item) => !tried.current.has(item.id));
        if (other) { setClassId(other.id); setSubject(''); return; }
      }
      const home = lesson.subject
        ? await customFetch<Data>(`/api/classes/${classId}/marks?kind=homework&subject=${encodeURIComponent(lesson.subject)}`, { method: 'GET' })
        : null;
      const dates = [...new Set([...lesson.dates, ...(home?.dates ?? [])])].sort();
      setData({ ...lesson, dates, marks: [...lesson.marks.map((mark): Mark => ({ ...mark, kind: 'class' })), ...(home?.marks ?? []).map((mark): Mark => ({ ...mark, kind: 'homework' }))] });
      if (lesson.subject !== subject) setSubject(lesson.subject);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [classId, subject, language]);
  useEffect(() => { setData(null); void load(); }, [load]);

  const cells = useMemo(() => {
    const map = new Map<string, Mark>();
    for (const mark of data?.marks ?? []) map.set(`${mark.kind}:${mark.studentId}:${mark.date}`, mark);
    return map;
  }, [data]);
  const absentAt = useMemo(() => new Set((data?.absences ?? []).map((row) => `${row.studentId}:${row.date}`)), [data]);

  async function put(kind: Kind, studentId: string, date: string, mark: number | null, absent = false, note = comment) {
    if (!data) return;
    setSaving(true); setError('');
    try {
      await customFetch(`/api/classes/${classId}/marks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: data.subject, kind, date, studentId, mark, absent, comment: note.trim() }) });
      setData((current) => {
        if (!current) return current;
        const rest = current.marks.filter((item) => !(item.kind === kind && item.studentId === studentId && item.date === date));
        return { ...current, marks: mark === null && !absent ? rest : [...rest, { kind, studentId, date, mark, absent, comment: note.trim() || null }] };
      });
      const who = data.students.find((item) => item.id === studentId)?.name ?? '';
      const label = kind === 'homework' ? t(language, 'uy vazifasi', 'домашка', 'homework') : t(language, 'dars', 'урок', 'lesson');
      setSaved(mark === null && !absent ? '' : `✓ ${who} — ${label}: ${absent ? t(language, 'nb', 'нб', 'ab') : mark}`);
      window.setTimeout(() => setSaved(''), 2600);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setSaving(false);
    }
  }
  /** The comment is saved with the marks already in the cell. */
  async function saveComment(studentId: string, date: string) {
    for (const kind of ['class', 'homework'] as Kind[]) {
      const cell = cells.get(`${kind}:${studentId}:${date}`);
      if (cell && (cell.comment ?? '') !== comment.trim()) await put(kind, studentId, date, cell.mark, cell.absent, comment);
    }
    setEditing(null);
  }
  const open = (studentId: string, date: string) => {
    const lessonCell = cells.get(`class:${studentId}:${date}`);
    const homeCell = cells.get(`homework:${studentId}:${date}`);
    setComment(lessonCell?.comment ?? homeCell?.comment ?? '');
    setEditing(`${studentId}:${date}`);
  };

  if (!school.classes.length) return null;
  const dateLabel = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${d} ${MONTHS_SHORT[language][(m ?? 1) - 1]}`; };
  const picker = (kind: Kind, studentId: string, date: string) => {
    const cell = cells.get(`${kind}:${studentId}:${date}`);
    return (
      <div className="journal-pick-row">
        <span className="journal-pick-label">{kind === 'homework' ? t(language, 'Uy vazifasi', 'Домашка', 'Homework') : t(language, 'Dars', 'За урок', 'Lesson')}</span>
        <span className="journal-marks">
          {MARKS.map((mark) => <button type="button" key={mark} className={`grade-pick ${markBand(mark)} ${cell?.mark === mark ? 'on' : ''}`} disabled={saving} onClick={() => void put(kind, studentId, date, mark)}>{mark}</button>)}
          {kind === 'class' && <button type="button" className={`grade-pick nb ${cell?.absent ? 'on' : ''}`} disabled={saving} onClick={() => void put(kind, studentId, date, null, true)}>{t(language, 'nb', 'нб', 'ab')}</button>}
          {cell && <button type="button" className="grade-pick cancel" disabled={saving} onClick={() => void put(kind, studentId, date, null)} aria-label={t(language, 'O‘chirish', 'Стереть', 'Clear')}>⌫</button>}
        </span>
      </div>
    );
  };
  return (
    <section className="panel journal class-journal">
      <div className="section-head">
        <h2><BookOpenCheck size={16} /> {t(language, 'Sinf jurnali', 'Классный журнал', 'Class journal')}</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {school.classes.length > 1 && (
            <Select value={classId} onChange={(_event, value) => { picked.current = true; setClassId(value); setSubject(''); }} options={school.classes.map((item) => ({ value: item.id, label: t(language, `${item.name} sinf`, `${item.name} класс`, `Class ${item.name}`) }))} aria-label={t(language, 'Sinf', 'Класс', 'Class')} style={{ width: 150 }} />
          )}
          {data && data.subjects.length > 0 && (
            <Select value={data.subject} onChange={(_event, value) => setSubject(value)} options={data.subjects.map((value) => ({ value, label: lessonSubjectName(value, language) }))} aria-label={t(language, 'Fan', 'Предмет', 'Subject')} style={{ width: 170 }} />
          )}
          <button type="button" className="btn small" onClick={() => void load()} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={14} /></button>
        </div>
      </div>
      <div className="row journal-legend">
        <span><span className="journal-kind-dot" /> {t(language, 'dars', 'за урок', 'lesson')}</span>
        <span><span className="journal-kind-dot hw" /> {t(language, 'uy vazifasi', 'домашка', 'homework')}</span>
        {data?.dates.includes(data.today) && (
          <label className="journal-hide-asked"><input type="checkbox" checked={hideAsked} onChange={(event) => setHideAsked(event.target.checked)} /> {t(language, 'Bugun so‘ralganlarni yashirish', 'Скрыть уже спрошенных сегодня', 'Hide pupils already asked today')}</label>
        )}
      </div>
      {saved && <div className="notice school-inline-success journal-saved" role="status">{saved}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
      {!data && !error && <LoadingBlock language={language} kind="inline" />}
      {data && data.students.length === 0 && <p className="muted">{t(language, 'Sinfda hali o‘quvchi yo‘q.', 'В классе пока нет учеников.', 'No students in this class yet.')}</p>}
      {data && data.students.length > 0 && data.dates.length === 0 && <div className="notice">{t(language, 'Bu fan jadvalda yo‘q — jadvalni direktor yoki zavuch to‘ldiradi.', 'Этого предмета нет в расписании — расписание заполняет директор или завуч.', 'This subject is not in the timetable yet.')}</div>}
      {data && data.students.length > 0 && data.dates.length > 0 && (
        <div className="journal-scroll">
          <table className="grade-table journal-table class-journal-table">
            <thead>
              <tr>
                <th className="journal-name">{t(language, 'O‘quvchi', 'Ученик', 'Student')}</th>
                {data.dates.map((date) => <th key={date} className={date === data.today ? 'is-today' : ''}>{dateLabel(date)}</th>)}
                <th>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</th>
              </tr>
            </thead>
            <tbody>
              {data.students.filter((student) => !hideAsked || !cells.get(`class:${student.id}:${data.today}`)).map((student, index) => {
                const asked = Boolean(cells.get(`class:${student.id}:${data.today}`));
                const marks = data.marks.filter((mark) => mark.studentId === student.id && typeof mark.mark === 'number').map((mark) => mark.mark as number);
                const average = marks.length ? marks.reduce((sum, mark) => sum + mark, 0) / marks.length : null;
                return (
                  <tr key={student.id}>
                    <td className={`journal-name ${asked ? 'is-asked' : ''}`}><span className="muted">{index + 1}.</span> <b>{student.name}</b>{asked && <span className="tag green journal-asked">✓</span>}</td>
                    {data.dates.map((date) => {
                      const key = `${student.id}:${date}`;
                      const lessonCell = cells.get(`class:${key}`);
                      const homeCell = cells.get(`homework:${key}`);
                      const absent = lessonCell?.absent || (!lessonCell && absentAt.has(key));
                      const note = lessonCell?.comment || homeCell?.comment || '';
                      return (
                        <td key={date} className={`journal-cell ${date === data.today ? 'is-today' : ''}`}>
                          <button type="button" className="journal-cell-btn journal-two" onClick={() => open(student.id, date)} title={note || undefined}>
                            <span className="journal-half">{typeof lessonCell?.mark === 'number' ? <span className={`grade-mark ${markBand(lessonCell.mark)}`}>{lessonCell.mark}</span> : absent ? <span className="journal-nb">{t(language, 'nb', 'нб', 'ab')}</span> : <span className="journal-empty">·</span>}</span>
                            <span className="journal-half hw">{typeof homeCell?.mark === 'number' ? <span className={`grade-mark ${markBand(homeCell.mark)}`}>{homeCell.mark}</span> : <span className="journal-empty">·</span>}</span>
                            {note && <span className="journal-note-dot" aria-label={note} />}
                          </button>
                        </td>
                      );
                    })}
                    <td>{average !== null ? <b className="journal-average">{average.toFixed(1)}</b> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && data && (() => {
        const [studentId, date] = [editing.slice(0, editing.lastIndexOf(':')), editing.slice(editing.lastIndexOf(':') + 1)];
        const who = data.students.find((item) => item.id === studentId)?.name ?? '';
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
            <section className="modal journal-editor" role="dialog" aria-modal="true" aria-label={who}>
              <div className="row-between"><b>{who}</b><span className="muted">{dateLabel(date)}</span></div>
              {picker('class', studentId, date)}
              {picker('homework', studentId, date)}
              <input className="input" value={comment} maxLength={200} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveComment(studentId, date); }} placeholder={t(language, 'Izoh: nima uchun (ixtiyoriy)', 'Комментарий: за что (по желанию)', 'Comment: what for (optional)')} />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn primary" disabled={saving} onClick={() => void saveComment(studentId, date)}>{t(language, 'Tayyor', 'Готово', 'Done')}</button>
              </div>
            </section>
          </div>
        );
      })()}
      <details className="journal-assignments">
        <summary>{t(language, 'Topshirilgan vazifalar baholari', 'Оценки за сданные задания', 'Marks for handed-in work')}</summary>
        <GradeJournal school={school} language={language} />
      </details>
    </section>
  );
}
