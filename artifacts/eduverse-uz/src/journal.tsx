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

type Mark = { studentId: string; date: string; mark: number | null; absent: boolean };
type Kind = 'class' | 'behavior' | 'homework';
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
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<Kind>('class');
  const [saved, setSaved] = useState('');
  const [hideAsked, setHideAsked] = useState(false);

  const load = useCallback(async () => {
    if (!classId || kind === 'homework') return;
    setError('');
    try {
      const next = await customFetch<Data>(`/api/classes/${classId}/marks?kind=${kind}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`, { method: 'GET' });
      tried.current.add(classId);
      if (!picked.current && next.dates.length === 0) {
        const other = school.classes.find((item) => !tried.current.has(item.id));
        if (other) { setClassId(other.id); setSubject(''); return; }
      }
      setData(next);
      if (next.subject !== subject) setSubject(next.subject);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [classId, subject, kind, language]);
  useEffect(() => { setData(null); void load(); }, [load]);

  const cells = useMemo(() => {
    const map = new Map<string, Mark>();
    for (const mark of data?.marks ?? []) map.set(`${mark.studentId}:${mark.date}`, mark);
    return map;
  }, [data]);
  const absentAt = useMemo(() => new Set((data?.absences ?? []).map((row) => `${row.studentId}:${row.date}`)), [data]);

  async function put(studentId: string, date: string, mark: number | null, absent = false) {
    if (!data) return;
    setSaving(true); setError('');
    try {
      await customFetch(`/api/classes/${classId}/marks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: data.subject, kind, date, studentId, mark, absent }) });
      setData((current) => {
        if (!current) return current;
        const rest = current.marks.filter((item) => !(item.studentId === studentId && item.date === date));
        return { ...current, marks: mark === null && !absent ? rest : [...rest, { studentId, date, mark, absent }] };
      });
      setEditing(null);
      const who = data.students.find((item) => item.id === studentId)?.name ?? '';
      setSaved(mark === null && !absent ? '' : `✓ ${t(language, 'Saqlandi', 'Сохранено', 'Saved')}: ${who} — ${absent ? t(language, 'nb', 'нб', 'ab') : mark}`);
      window.setTimeout(() => setSaved(''), 2600);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setSaving(false);
    }
  }

  if (!school.classes.length) return null;
  const dateLabel = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${d} ${MONTHS_SHORT[language][(m ?? 1) - 1]}`; };
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
      <div className="row journal-kinds" role="tablist">
        {([['class', t(language, 'Darsdagi baho', 'За урок', 'Lesson')], ['behavior', t(language, 'Xulq', 'Поведение', 'Behaviour')], ['homework', t(language, 'Uy vazifasi', 'Домашка', 'Homework')]] as Array<[Kind, string]>).map(([value, label]) => (
          <button type="button" role="tab" key={value} aria-selected={kind === value} className={`studio-tab ${kind === value ? 'active' : ''}`} onClick={() => { setKind(value); setEditing(null); setData(null); }}>{label}</button>
        ))}
        {kind !== 'homework' && data?.dates.includes(data.today) && (
          <label className="journal-hide-asked"><input type="checkbox" checked={hideAsked} onChange={(event) => setHideAsked(event.target.checked)} /> {t(language, 'Bugun so‘ralganlarni yashirish', 'Скрыть уже спрошенных сегодня', 'Hide pupils already asked today')}</label>
        )}
      </div>
      {saved && <div className="notice school-inline-success journal-saved" role="status">{saved}</div>}
      {kind === 'homework' && <GradeJournal school={school} language={language} />}
      {error && <div className="notice" role="alert">{error}</div>}
      {kind !== 'homework' && !data && !error && <LoadingBlock language={language} kind="inline" />}
      {data && data.students.length === 0 && <p className="muted">{t(language, 'Sinfda hali o‘quvchi yo‘q.', 'В классе пока нет учеников.', 'No students in this class yet.')}</p>}
      {data && data.students.length > 0 && data.dates.length === 0 && <div className="notice">{t(language, 'Bu fan jadvalda yo‘q — jadvalni direktor yoki zavuch to‘ldiradi.', 'Этого предмета нет в расписании — расписание заполняет директор или завуч.', 'This subject is not in the timetable yet.')}</div>}
      {kind !== 'homework' && data && data.students.length > 0 && data.dates.length > 0 && (
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
              {data.students.filter((student) => !hideAsked || !cells.get(`${student.id}:${data.today}`)).map((student, index) => {
                const asked = Boolean(cells.get(`${student.id}:${data.today}`));
                const marks = data.dates.map((date) => cells.get(`${student.id}:${date}`)?.mark).filter((mark): mark is number => typeof mark === 'number');
                const average = marks.length ? marks.reduce((sum, mark) => sum + mark, 0) / marks.length : null;
                return (
                  <tr key={student.id}>
                    <td className={`journal-name ${asked ? 'is-asked' : ''}`}><span className="muted">{index + 1}.</span> <b>{student.name}</b>{asked && <span className="tag green journal-asked">✓ {t(language, 'so‘raldi', 'спрошен', 'asked')}</span>}</td>
                    {data.dates.map((date) => {
                      const key = `${student.id}:${date}`;
                      const cell = cells.get(key);
                      const absent = cell?.absent || (kind === 'class' && !cell && absentAt.has(key));
                      return (
                        <td key={date} className={`journal-cell ${date === data.today ? 'is-today' : ''}`}>
                          {editing === key ? (
                            <span className="journal-marks">
                              {MARKS.map((mark) => <button type="button" key={mark} className={`grade-pick ${markBand(mark)} ${cell?.mark === mark ? 'on' : ''}`} disabled={saving} onClick={() => void put(student.id, date, mark)}>{mark}</button>)}
                              {kind === 'class' && <button type="button" className={`grade-pick nb ${cell?.absent ? 'on' : ''}`} disabled={saving} onClick={() => void put(student.id, date, null, true)}>{t(language, 'nb', 'нб', 'ab')}</button>}
                              {cell && <button type="button" className="grade-pick cancel" disabled={saving} onClick={() => void put(student.id, date, null)} aria-label={t(language, 'O‘chirish', 'Стереть', 'Clear')}>⌫</button>}
                              <button type="button" className="grade-pick cancel" onClick={() => setEditing(null)} aria-label={t(language, 'Bekor', 'Отмена', 'Cancel')}>×</button>
                            </span>
                          ) : (
                            <button type="button" className="journal-cell-btn" onClick={() => setEditing(key)}>
                              {typeof cell?.mark === 'number' ? <span className={`grade-mark ${markBand(cell.mark)}`}>{cell.mark}</span> : absent ? <span className="journal-nb">{t(language, 'nb', 'нб', 'ab')}</span> : <span className="journal-empty">·</span>}
                            </button>
                          )}
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
    </section>
  );
}
