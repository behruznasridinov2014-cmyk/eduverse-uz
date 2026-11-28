import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { ArrowRight, BookOpen, CalendarCheck2, Star, TrendingDown, TrendingUp } from 'lucide-react';
import type { Language } from './school-data';
import { LensRow } from './glass-nav';
import { Modal } from './ui/modal';
import { lessonSubjectName, openLessonPreview, type TodayLesson } from './today';
import { weekTopics, withinDays, type ClassCourse, type Week } from './schedule';
import type { CourseTopic } from './course-data';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

type Mark = { subject: string; date: string; mark: number | null; absent: boolean; comment?: string | null };
const DAY = 86_400_000;
const avg = (values: number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null);
const shortDate = (date: string) => date.slice(5).split('-').reverse().join('.');

/**
 * The pupil's overview: the average mark with its trend, attendance, the subjects at a glance
 * (details open in a window) and the topics of the next days to study ahead.
 */
export function StudentPulse({ language, onOpen }: { language: Language; onOpen: (path: string) => void }) {
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [attendance, setAttendance] = useState<{ total: number; present: number; late: number } | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  useEffect(() => {
    void customFetch<{ marks: Mark[] }>('/api/me/marks', { method: 'GET' }).then((data) => setMarks(data.marks)).catch(() => setMarks([]));
    void customFetch<{ total: number; present: number; late: number }>('/api/me/attendance-summary', { method: 'GET' }).then(setAttendance).catch(() => {});
  }, []);
  const stats = useMemo(() => {
    if (!marks) return null;
    const now = Date.now();
    const graded = marks.filter((item) => item.mark !== null && !item.absent);
    const inDays = (from: number, to: number) => graded.filter((item) => { const age = now - Date.parse(`${item.date}T12:00:00Z`); return age >= from * DAY && age < to * DAY; }).map((item) => item.mark!);
    const last = avg(inDays(0, 30));
    const before = avg(inDays(30, 60));
    const bySubject = new Map<string, number[]>();
    for (const item of graded) bySubject.set(item.subject, [...(bySubject.get(item.subject) ?? []), item.mark!]);
    const subjects = [...bySubject.entries()].map(([key, values]) => ({ key, average: avg(values)!, count: values.length })).sort((a, b) => b.average - a.average);
    const absences = marks.filter((item) => item.absent).length;
    const fives = graded.filter((item) => item.mark! >= 9).length;
    return { last: last ?? avg(graded.map((item) => item.mark!)), before, subjects, absences, fives, count: graded.length };
  }, [marks]);
  const attendancePercent = attendance && attendance.total ? Math.round(((attendance.present + attendance.late) / attendance.total) * 100) : stats ? Math.max(0, 100 - stats.absences * 2) : null;
  const trend = stats?.last != null && stats.before != null ? Math.round((stats.last - stats.before) * 10) / 10 : null;
  const ring = Math.min(100, Math.max(0, ((stats?.last ?? 0) / 10) * 100));
  const detail = subject ? (marks ?? []).filter((item) => item.subject === subject) : [];

  return (
    <section className="pulse" aria-label={t(language, 'Mening o‘qishim', 'Моя учёба', 'My learning')}>
      <h2 className="home-section-title">{t(language, 'Mening o‘qishim', 'Моя учёба', 'My learning')}</h2>
      <div className="pulse-grid">
        <div className="pulse-hero">
          <div className="pulse-ring" style={{ ['--p' as string]: `${ring}` }}><b>{stats?.last ?? '—'}</b><small>{t(language, 'o‘rtacha', 'средний', 'average')}</small></div>
          <div className="pulse-hero-text">
            <b>{t(language, 'O‘rtacha baho, 30 kun', 'Средний балл за 30 дней', 'Average, 30 days')}</b>
            {trend !== null && trend !== 0 && <span className={`pulse-trend ${trend > 0 ? 'up' : 'down'}`}>{trend > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {trend > 0 ? '+' : ''}{trend} {t(language, 'o‘tgan oyga nisbatan', 'к прошлому месяцу', 'vs last month')}</span>}
            {stats && stats.count === 0 && <span className="muted">{t(language, 'Hali baho yo‘q — birinchisi tez orada.', 'Оценок пока нет — первая скоро появится.', 'No marks yet — the first one is coming.')}</span>}
            {trend === 0 && <span className="muted">{t(language, 'O‘tgan oy bilan bir xil', 'Как в прошлом месяце', 'Same as last month')}</span>}
          </div>
        </div>
        <div className="pulse-tile"><CalendarCheck2 size={18} /><b>{attendancePercent !== null ? `${attendancePercent}%` : '—'}</b><span>{t(language, 'Davomat', 'Посещаемость', 'Attendance')}</span></div>
        {stats && stats.fives > 0
          ? <div className="pulse-tile"><Star size={18} /><b>{stats.fives}</b><span>{t(language, '9 va 10 baholar', 'Оценок 9 и 10', 'Marks of 9–10')}</span></div>
          : <div className="pulse-tile"><Star size={18} /><b>{stats?.count ?? 0}</b><span>{t(language, 'Jami baholar', 'Всего оценок', 'Marks in total')}</span></div>}
      </div>
      {stats && stats.subjects.length > 0 && (
        <div className="pulse-subjects">
          {stats.subjects.map((item) => (
            <button type="button" key={item.key} className="pulse-subject" onClick={() => setSubject(item.key)}>
              <span>{lessonSubjectName(item.key, language)}</span>
              <i style={{ width: `${Math.min(100, item.average * 10)}%` }} />
              <b>{item.average}</b>
            </button>
          ))}
        </div>
      )}
      {subject && (
        <Modal title={lessonSubjectName(subject, language)} onClose={() => setSubject(null)}>
          <ul className="pulse-marks">
            {detail.slice(0, 30).map((item, index) => (
              <li key={`${item.date}-${index}`}><span className="muted">{shortDate(item.date)}</span><b className={item.absent ? 'is-absent' : ''}>{item.absent ? t(language, 'yo‘q', 'нб', 'abs') : item.mark}</b>{item.comment && <small className="muted">{item.comment}</small>}</li>
            ))}
          </ul>
        </Modal>
      )}
      <TopicsAhead language={language} onOpen={onOpen} />
    </section>
  );
}

/** Topics of the next days by subject (3 days back and ahead): the pupil can study before the lesson. */
export function TopicsAhead({ language, onOpen }: { language: Language; onOpen: (path: string) => void }) {
  const [week, setWeek] = useState<Week | null>(null);
  const [courses, setCourses] = useState<Record<string, ClassCourse>>({});
  const [subject, setSubject] = useState('');
  useEffect(() => {
    void Promise.all([0, 1].map((offset) => customFetch<Week>(`/api/me/week?offset=${offset}`, { method: 'GET' }).catch(() => null)))
      .then(([current, next]) => { if (current) setWeek({ ...current, days: [...current.days, ...(next?.days ?? [])] }); });
  }, []);
  const classIds = useMemo(() => [...new Set((week?.days ?? []).flatMap((day) => day.lessons.map((lesson) => lesson.classId)))].sort().join(','), [week]);
  useEffect(() => {
    if (!classIds) return;
    void Promise.all(classIds.split(',').map((id) => customFetch<ClassCourse>(`/api/classes/${id}/course`, { method: 'GET' }).then((course) => [id, course] as const).catch(() => [id, null] as const)))
      .then((rows) => setCourses(Object.fromEntries(rows.filter((row) => row[1]).map(([id, course]) => [id, course!]))));
  }, [classIds]);
  const items = useMemo(() => {
    if (!week) return [];
    const topics = weekTopics(week, courses);
    return week.days.filter((day) => withinDays(day.date, week.today, 3)).flatMap((day) => day.lessons.map((lesson) => ({ day: day.date, lesson, topic: topics.get(lesson.id)?.topic })))
      .filter((item): item is { day: string; lesson: TodayLesson; topic: CourseTopic } => Boolean(item.topic))
      // Two lessons of one subject on one day share the topic: show it once.
      .filter((item, index, all) => all.findIndex((other) => other.day === item.day && other.lesson.subject === item.lesson.subject && other.topic.key === item.topic.key) === index);
  }, [week, courses]);
  const subjects = useMemo(() => [...new Set(items.map((item) => item.lesson.subject))], [items]);
  const chosen = subject && subjects.includes(subject) ? subject : subjects[0] ?? '';
  if (!week || subjects.length === 0) return null;
  const list = items.filter((item) => item.lesson.subject === chosen);
  return (
    <div className="topics-ahead">
      <div className="topics-ahead-head">
        <b><BookOpen size={16} /> {t(language, 'Mavzular: 3 kun oldin va keyin', 'Темы: 3 дня до и после', 'Topics: 3 days around today')}</b>
        <LensRow className="small" aria-label={t(language, 'Fan', 'Предмет', 'Subject')}>
          {subjects.map((key) => <button type="button" key={key} role="tab" aria-selected={key === chosen} className={key === chosen ? 'on' : ''} onClick={() => setSubject(key)}>{lessonSubjectName(key, language)}</button>)}
        </LensRow>
      </div>
      <ul className="topics-ahead-list">
        {list.map((item) => {
          const today = item.day === week.today;
          const past = item.day < week.today;
          return (
            <li key={item.lesson.id}>
              <button type="button" className={`topics-ahead-item ${today ? 'is-today' : past ? 'is-past' : ''}`} onClick={() => (today ? onOpen(`/today/${item.lesson.id}`) : openLessonPreview(item.lesson, onOpen))}>
                <span className="topics-ahead-date">{today ? t(language, 'Bugun', 'Сегодня', 'Today') : shortDate(item.day)}</span>
                <span className="topics-ahead-title"><b>§{item.topic.code}</b> {item.topic.title}</span>
                <ArrowRight size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
