import './today.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { ArrowRight, BookOpen, CalendarCheck2, Clock3, DoorOpen, MonitorPlay, Sparkles, UserRound } from 'lucide-react';
import { COURSE, SUBJECT_LABEL, type CourseBook, type CourseTopic } from './course-data';
import type { Language } from './school-data';
import { subjectLabel } from './ui/config';

/*
 * "Today": the lessons of the signed-in person for today (Tashkent time), live status and
 * the textbook topic of each lesson. Used on the overview, in "Lesson topic", in the 3D studio
 * and on the page of one lesson.
 */

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

export type TodayLesson = {
  id: string; classId: string; className: string; grade: number; period: number;
  subject: string; room: string | null; teacherName: string;
  start: string; end: string; startsAt: string; endsAt: string;
};
export type NextDay = { date: string; weekday: number; lessons: TodayLesson[] };
export type TodayResponse = { date: string; weekday: number; now: string; lessons: TodayLesson[]; next?: NextDay[]; prev?: NextDay | null };
export type LessonStatus = 'upcoming' | 'current' | 'done';
type ClassCourse = { progress: Array<{ topicKey: string; doneOn: string }> };

const WEEKDAYS: Record<Language, string[]> = {
  Uzbek: ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba'],
  'Русский': ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  English: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const MONTHS: Record<Language, string[]> = {
  Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  'Русский': ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  English: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** The subject name attendance is saved under (the same one the attendance page uses). */
export function attendanceSubject(subject: string): string {
  return ({ physics: 'Физика', chemistry: 'Химия', biology: 'Биология', math: 'Математика' } as Record<string, string>)[subject] ?? subject;
}

/** Subjects without a textbook in EDUVERSE are shown by their own name. */
export function lessonSubjectName(subject: string, language: Language): string {
  const label = SUBJECT_LABEL[subject as CourseBook['subject']];
  return label ? t(language, ...label) : subjectLabel(subject, language);
}

export function bookForLesson(lesson: Pick<TodayLesson, 'subject' | 'grade'>): CourseBook | undefined {
  return COURSE.find((book) => book.subject === lesson.subject && book.grade === lesson.grade)
    ?? COURSE.find((book) => book.subject === lesson.subject);
}

/** The topic of a lesson: the one the class covered today, else the next one after the last covered. */
export function topicForLesson(lesson: TodayLesson, course: ClassCourse | null | undefined, today: string): CourseTopic | undefined {
  const book = bookForLesson(lesson);
  if (!book) return undefined;
  const progress = course?.progress ?? [];
  const doneToday = new Set(progress.filter((item) => item.doneOn === today).map((item) => item.topicKey));
  const covered = new Set(progress.map((item) => item.topicKey));
  const coveredToday = book.topics.find((item) => doneToday.has(item.key));
  if (coveredToday) return coveredToday;
  const last = book.topics.reduce((index, item, i) => (covered.has(item.key) ? i : index), -1);
  return book.topics[last + 1] ?? book.topics[book.topics.length - 1];
}

/**
 * Topics of the next school days: each day that has the subject moves one topic on from today's
 * (the teacher has not explained them yet — they are shown only as a plan).
 */
export function upcomingTopics(data: Pick<TodayResponse, 'date' | 'lessons' | 'next'>, courses: Record<string, ClassCourse>): Map<string, CourseTopic | undefined> {
  const out = new Map<string, CourseTopic | undefined>();
  const step = new Map<string, number>();
  for (const day of data.next ?? []) {
    const seenToday = new Set<string>();
    for (const lesson of day.lessons) {
      const book = bookForLesson(lesson);
      if (!book) { out.set(lesson.id, undefined); continue; }
      const key = `${lesson.classId}:${lesson.subject}`;
      if (!seenToday.has(key)) { seenToday.add(key); step.set(key, (step.get(key) ?? 0) + 1); }
      const base = topicForLesson(lesson, courses[lesson.classId], data.date);
      const index = base ? book.topics.findIndex((item) => item.key === base.key) : -1;
      out.set(lesson.id, book.topics[Math.min(book.topics.length - 1, index + (step.get(key) ?? 1))]);
    }
  }
  return out;
}

export function statusOf(lesson: TodayLesson, now: number): LessonStatus {
  if (now >= Date.parse(lesson.endsAt)) return 'done';
  if (now >= Date.parse(lesson.startsAt)) return 'current';
  return 'upcoming';
}

/** "через 25 мин", "через 1 ч 10 мин", "осталось 12 мин". */
export function timeText(lesson: TodayLesson, now: number, language: Language): string {
  const status = statusOf(lesson, now);
  if (status === 'done') return t(language, 'Tugadi', 'Закончился', 'Finished');
  const target = status === 'current' ? Date.parse(lesson.endsAt) : Date.parse(lesson.startsAt);
  const minutes = Math.max(1, Math.ceil((target - now) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const span = h ? t(language, `${h} soat ${m} daq`, `${h} ч ${m} мин`, `${h} h ${m} min`) : t(language, `${m} daq`, `${m} мин`, `${m} min`);
  return status === 'current'
    ? t(language, `Tugashiga ${span}`, `Осталось ${span}`, `${span} left`)
    : t(language, `${span}dan keyin`, `Через ${span}`, `In ${span}`);
}

export function statusLabel(status: LessonStatus, language: Language): string {
  if (status === 'current') return t(language, 'Hozirgi dars', 'Идёт сейчас', 'Now');
  if (status === 'done') return t(language, 'Tugallangan', 'Закончился', 'Finished');
  return t(language, 'Kutilmoqda', 'Ожидается', 'Upcoming');
}

export function dayLabel(day: NextDay, todayDate: string, language: Language): string {
  const diff = Math.round((Date.parse(day.date) - Date.parse(todayDate)) / 86400000);
  const name = WEEKDAYS[language][day.weekday - 1] ?? '';
  if (diff === 1) return `${t(language, 'Ertaga', 'Завтра', 'Tomorrow')}, ${name}`;
  if (diff === 2) return `${t(language, 'Indinga', 'Послезавтра', 'Day after tomorrow')}, ${name}`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The next school day: only the timetable (time, subject, class), no topics — they open on the day. */
export function UpcomingDays({ data, language, showTeacher = false, showClass = true }: { data: TodayResponse; courses?: Record<string, ClassCourse>; language: Language; showTeacher?: boolean; showClass?: boolean }) {
  const day = (data.next ?? []).find((item) => item.lessons.length);
  if (!day) return null;
  const last = day.lessons[day.lessons.length - 1];
  return (
    <section className="upcoming-days">
      <div className="upcoming-day">
        <h3>{t(language, 'Keyingi darslar', 'Следующие уроки', 'Next lessons')}: {dayLabel(day, data.date, language)}</h3>
        <ul>
          {day.lessons.map((lesson) => (
            <li key={lesson.id}>
              <span className="upcoming-time">{lesson.start}–{lesson.end}</span>
              <span className="upcoming-what"><b>{lessonSubjectName(lesson.subject, language)}</b>{showClass ? <small>{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)}</small> : null}</span>
              {showTeacher && lesson.teacherName && <small className="muted upcoming-teacher">{lesson.teacherName}</small>}
            </li>
          ))}
        </ul>
        {last && <p className="muted upcoming-note">{t(language, `Darslar ${last.end} da tugaydi.`, `Уроки закончатся в ${last.end}.`, `Lessons end at ${last.end}.`)}</p>}
      </div>
    </section>
  );
}

export function todayTitle(date: string, weekday: number, language: Language): string {
  const [, month, day] = date.split('-').map(Number);
  const name = WEEKDAYS[language][weekday - 1] ?? '';
  return language === 'English' ? `${name}, ${MONTHS.English[(month ?? 1) - 1]} ${day}` : `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${day} ${MONTHS[language][(month ?? 1) - 1]}`;
}

/** Today's lessons with a clock that ticks every 20 seconds. Reloads when the tab comes back. */
export function useToday() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => {
    void customFetch<TodayResponse>('/api/me/today', { method: 'GET' })
      .then((response) => { setData(response); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    const tick = window.setInterval(() => setNow(Date.now()), 20000);
    const reload = window.setInterval(load, 5 * 60 * 1000);
    const onFocus = () => { setNow(Date.now()); load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(tick); window.clearInterval(reload); window.removeEventListener('focus', onFocus); };
  }, [load]);
  return { data, failed, now, reload: load };
}

/** Course progress of the classes in today's lessons, for the topic of each lesson. */
export function useLessonCourses(lessons: TodayLesson[] | undefined, next?: NextDay[]) {
  const all = useMemo(() => [...(lessons ?? []), ...(next ?? []).flatMap((day) => day.lessons)], [lessons, next]);
  const classIds = useMemo(() => [...new Set(all.map((item) => item.classId))].sort().join(','), [all]);
  const [courses, setCourses] = useState<Record<string, ClassCourse>>({});
  useEffect(() => {
    if (!classIds) return;
    let alive = true;
    void Promise.all(classIds.split(',').map((id) =>
      customFetch<ClassCourse>(`/api/classes/${id}/course`, { method: 'GET' }).then((course) => [id, course] as const).catch(() => [id, null] as const),
    )).then((rows) => {
      if (!alive) return;
      const next: Record<string, ClassCourse> = {};
      for (const [id, course] of rows) if (course) next[id] = course;
      setCourses(next);
    });
    return () => { alive = false; };
  }, [classIds]);
  return courses;
}

/** The lesson that matters now: the one going on, else the next one today. */
export function currentOrNext(lessons: TodayLesson[], now: number): TodayLesson | undefined {
  return lessons.find((lesson) => statusOf(lesson, now) === 'current') ?? lessons.find((lesson) => statusOf(lesson, now) === 'upcoming');
}

/* ------------------------------------------------------------------ */
/* Big lesson cards (overview)                                          */
/* ------------------------------------------------------------------ */

export function TodayLessons({ language, onOpen, role }: { language: Language; onOpen: (path: string) => void; role: string }) {
  const { data, failed, now } = useToday();
  const courses = useLessonCourses(data?.lessons);
  const isManager = role === 'school_director' || role === 'school_admin';
  const isFamily = role === 'parent';
  const isStudent = role === 'student';
  if (failed && !data) return null;
  if (!data) return <section className="today-block"><div className="today-skeleton" /></section>;
  if (isManager) return <SchoolToday data={data} now={now} language={language} />;
  const lessons = data.lessons;
  const left = lessons.filter((lesson) => statusOf(lesson, now) !== 'done').length;
  const finished = lessons.length > 0 && left === 0;
  const lastEnd = lessons[lessons.length - 1]?.end;
  return (
    <section className="today-block" aria-label={t(language, 'Bugungi darslar', 'Уроки сегодня', 'Today’s lessons')}>
      <div className="today-head">
        <div><h2>{t(language, 'Bugungi darslar', 'Уроки сегодня', 'Today’s lessons')}</h2></div>
        {lessons.length > 0 && !finished && <span className="today-count">{t(language, `Qoldi: ${left} / ${lessons.length} · ${lastEnd} da tugaydi`, `Осталось ${left} из ${lessons.length} · до ${lastEnd}`, `${left} of ${lessons.length} left · until ${lastEnd}`)}</span>}
      </div>
      {lessons.length === 0 || finished ? (
        <div className="today-empty">
          <CalendarCheck2 size={22} />
          <div>
            <b>{finished
              ? t(language, 'Bugungi darslar tugadi', 'Уроки на сегодня закончились', 'Today’s lessons are over')
              : data.weekday === 7 ? t(language, 'Bugun dam olish kuni', 'Сегодня выходной', 'Today is a day off') : t(language, 'Bugun dars yo‘q', 'Сегодня уроков нет', 'No lessons today')}</b>
            <span className="muted">{finished
              ? t(language, `${lessons.length} ta dars o‘tdi, oxirgisi ${lastEnd} da tugadi.`, `Прошло ${lessons.length} уроков, последний закончился в ${lastEnd}.`, `${lessons.length} lessons, the last ended at ${lastEnd}.`)
              : t(language, 'Jadvalni maktab to‘ldiradi.', 'Расписание заполняет школа.', 'The school fills the timetable.')}</span>
          </div>
        </div>
      ) : (
        <div className="today-grid">
          {lessons.map((lesson, index) => {
            const status = statusOf(lesson, now);
            const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
            const open = status !== 'done';
            return (
              <button
                type="button"
                key={lesson.id}
                className={`today-card is-${status}`}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                disabled={!open}
                onClick={() => open && onOpen(`/today/${lesson.id}`)}
              >
                <span className="today-card-top">
                  <span className="today-class">{isStudent || isFamily ? lessonSubjectName(lesson.subject, language) : t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)}</span>
                  <span className={`today-status is-${status}`}>{status === 'current' && <i className="today-pulse" aria-hidden="true" />}{statusLabel(status, language)}</span>
                </span>
                <span className="today-time"><Clock3 size={15} /> {lesson.start}–{lesson.end} <small>· {t(language, `${lesson.period}-dars`, `${lesson.period}-й урок`, `Period ${lesson.period}`)}</small></span>
                {!(isStudent || isFamily) && <span className="today-subject">{lessonSubjectName(lesson.subject, language)}</span>}
                {open && topic && <span className="today-topic"><b>§{topic.code}</b> {topic.title}</span>}
                <span className="today-card-foot">
                  <span className={`today-left is-${status}`}>{status === 'done' ? t(language, 'Dars tugadi', 'Урок закончился', 'Lesson over') : timeText(lesson, now, language)}</span>
                  {isFamily && lesson.teacherName && <span className="muted today-teacher"><UserRound size={13} /> {lesson.teacherName}</span>}
                  {lesson.room && <span className="muted today-room"><DoorOpen size={13} /> {lesson.room}</span>}
                  {open && <ArrowRight size={16} className="today-arrow" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(lessons.length === 0 || finished) && <UpcomingDays data={data} language={language} showClass={!(isStudent || isFamily)} />}
    </section>
  );
}

type AttendanceRow = { studentId: string; studentName: string; status: string };

/** Director and deputy: today's classes. A class opens its lessons, teachers and who came. */
function SchoolToday({ data, now, language }: { data: TodayResponse; now: number; language: Language }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byClass = useMemo(() => {
    const map = new Map<string, { classId: string; className: string; lessons: TodayLesson[] }>();
    for (const lesson of data.lessons) {
      const row = map.get(lesson.classId) ?? { classId: lesson.classId, className: lesson.className, lessons: [] };
      row.lessons.push(lesson);
      map.set(lesson.classId, row);
    }
    return [...map.values()].sort((a, b) => a.className.localeCompare(b.className, 'ru', { numeric: true }));
  }, [data.lessons]);
  const opened = byClass.find((row) => row.classId === openId) ?? null;
  return (
    <section className="today-block" aria-label={t(language, 'Maktabda bugun', 'Сегодня в школе', 'Today at school')}>
      <div className="today-head"><div><h2>{t(language, 'Bugun sinflar', 'Классы сегодня', 'Classes today')}</h2></div></div>
      {byClass.length === 0 ? (
        <div className="today-empty">
          <CalendarCheck2 size={22} />
          <div>
            <b>{data.weekday === 7 ? t(language, 'Bugun dam olish kuni', 'Сегодня выходной', 'Today is a day off') : t(language, 'Bugun dars yo‘q', 'Сегодня уроков нет', 'No lessons today')}</b>
            <span className="muted">{t(language, 'Dars jadvali «Maktab boshqaruvi» bo‘limida.', 'Расписание — в разделе «Управление школой».', 'The timetable is in “School”.')}</span>
          </div>
        </div>
      ) : (
        <div className="school-today-grid">
          {byClass.map((row) => {
            const current = row.lessons.find((lesson) => statusOf(lesson, now) === 'current');
            const upcoming = row.lessons.find((lesson) => statusOf(lesson, now) === 'upcoming');
            const last = row.lessons[row.lessons.length - 1]!;
            return (
              <button type="button" key={row.classId} className={`school-today-card ${row.classId === openId ? 'active' : ''} ${current ? 'is-current' : ''}`} onClick={() => setOpenId(row.classId === openId ? null : row.classId)}>
                <b>{t(language, `${row.className} sinf`, `${row.className} класс`, `Class ${row.className}`)}</b>
                <small className="muted">{t(language, `${row.lessons.length} ta dars · ${row.lessons[0]!.start}–${last.end}`, `${row.lessons.length} уроков · ${row.lessons[0]!.start}–${last.end}`, `${row.lessons.length} lessons · ${row.lessons[0]!.start}–${last.end}`)}</small>
                <span className="school-today-now">{current
                  ? <>{t(language, 'Hozir', 'Сейчас', 'Now')}: {lessonSubjectName(current.subject, language)}{current.teacherName ? ` · ${current.teacherName}` : ''}</>
                  : upcoming ? <>{t(language, 'Keyingi', 'Дальше', 'Next')}: {upcoming.start} · {lessonSubjectName(upcoming.subject, language)}</>
                  : t(language, 'Darslar tugadi', 'Уроки закончились', 'Lessons are over')}</span>
              </button>
            );
          })}
        </div>
      )}
      {opened && <ClassTodayDetail key={opened.classId} row={opened} date={data.date} now={now} language={language} />}
    </section>
  );
}

function ClassTodayDetail({ row, date, now, language }: { row: { classId: string; className: string; lessons: TodayLesson[] }; date: string; now: number; language: Language }) {
  // Who came: the marks of the lesson going on, else of the last lesson that started.
  const started = row.lessons.filter((lesson) => statusOf(lesson, now) !== 'upcoming');
  const lesson = started[started.length - 1] ?? row.lessons[0]!;
  const [records, setRecords] = useState<AttendanceRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void customFetch<{ records: AttendanceRow[] }>(`/api/classes/${row.classId}/attendance?date=${date}&subject=${encodeURIComponent(attendanceSubject(lesson.subject))}`, { method: 'GET' })
      .then((response) => { if (alive) setRecords(response.records); })
      .catch(() => { if (alive) setRecords([]); });
    return () => { alive = false; };
  }, [row.classId, date, lesson.subject]);
  const teachers = [...new Set(row.lessons.map((item) => item.teacherName).filter(Boolean))];
  const came = records?.filter((item) => item.status === 'present' || item.status === 'late').length ?? 0;
  const marked = records?.some((item) => item.status !== 'unmarked') ?? false;
  const STATUS: Record<string, [string, string, string, string]> = {
    present: ['Keldi', 'Пришёл', 'Present', 'green'], late: ['Kechikdi', 'Опоздал', 'Late', 'gold'],
    absent: ['Kelmadi', 'Нет', 'Absent', 'red'], excused: ['Sababli', 'По причине', 'Excused', 'blue'], unmarked: ['—', '—', '—', ''],
  };
  return (
    <div className="panel school-today-detail">
      <h3>{t(language, `${row.className} sinf`, `${row.className} класс`, `Class ${row.className}`)}</h3>
      <div className="school-today-cols">
        <div>
          <small className="muted">{t(language, 'Bugungi darslar', 'Уроки сегодня', 'Lessons today')}</small>
          <ul className="school-today-lessons">
            {row.lessons.map((item) => (
              <li key={item.id} className={`is-${statusOf(item, now)}`}>
                <span>{item.start}–{item.end}</span>
                <b>{lessonSubjectName(item.subject, language)}</b>
                <small className="muted">{item.teacherName}</small>
              </li>
            ))}
          </ul>
          <small className="muted">{t(language, 'O‘qituvchilar', 'Учителя', 'Teachers')}: {teachers.join(', ') || '—'}</small>
        </div>
        <div>
          <small className="muted">{t(language, `O‘quvchilar · ${lessonSubjectName(lesson.subject, language)} darsi`, `Ученики · урок «${lessonSubjectName(lesson.subject, language)}»`, `Students · ${lessonSubjectName(lesson.subject, language)} lesson`)}</small>
          {records === null ? <p className="muted">…</p> : (
            <>
              <p className="school-today-came">{marked
                ? t(language, `Keldi: ${came} / ${records.length}`, `Пришли ${came} из ${records.length}`, `Present ${came} of ${records.length}`)
                : t(language, `${records.length} o‘quvchi · davomat hali belgilanmagan`, `${records.length} учеников · давомат ещё не отмечен`, `${records.length} students · not marked yet`)}</p>
              <ul className="school-today-students">
                {records.map((item) => {
                  const st = STATUS[item.status] ?? STATUS.unmarked!;
                  return <li key={item.studentId}><span>{item.studentName}</span>{item.status !== 'unmarked' && <span className={`tag ${st[3]}`}>{t(language, st[0], st[1], st[2])}</span>}</li>;
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page of one lesson: topic, attendance, online lesson, textbook   */
/* ------------------------------------------------------------------ */

export function LessonDayHeader({ lesson, topic, status, now, language }: { lesson: TodayLesson; topic?: CourseTopic; status: LessonStatus; now: number; language: Language }) {
  return (
    <header className={`lesson-day-head is-${status}`}>
      <div>
        <span className="eyebrow">{t(language, `${lesson.period}-dars`, `${lesson.period}-й урок`, `Period ${lesson.period}`)} · {lesson.start}–{lesson.end}{lesson.room ? ` · ${t(language, 'xona', 'каб.', 'room')} ${lesson.room}` : ''}</span>
        <h1>{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)} · {lessonSubjectName(lesson.subject, language)}</h1>
        {topic && <p className="lesson-day-topic"><Sparkles size={15} /> §{topic.code} {topic.title}</p>}
      </div>
      <div className="lesson-day-status">
        <span className={`today-status is-${status}`}>{status === 'current' && <i className="today-pulse" aria-hidden="true" />}{statusLabel(status, language)}</span>
        <b>{timeText(lesson, now, language)}</b>
      </div>
    </header>
  );
}

export const LESSON_TABS = [
  { id: 'topic', icon: BookOpen, label: ['Mavzu', 'Тема урока', 'Topic'] },
  { id: 'attendance', icon: CalendarCheck2, label: ['Davomat', 'Давомат', 'Attendance'] },
] as const;

/**
 * Topics for the online lesson: only the lessons of today, tomorrow and the day after,
 * each with its textbook topic. null = no timetable yet (the full list is shown then).
 */
export function useLessonPlanTopics(language: Language): Array<{ label: string; items: Array<{ value: string; label: string }> }> | null {
  const { data } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.next);
  return useMemo(() => {
    if (!data) return null;
    const groups: Array<{ label: string; items: Array<{ value: string; label: string }> }> = [];
    const seen = new Set<string>();
    const add = (label: string, rows: Array<{ lesson: TodayLesson; topic?: CourseTopic }>) => {
      const items: Array<{ value: string; label: string }> = [];
      for (const row of rows) {
        if (!row.topic) continue;
        const key = `${label}:${row.lesson.classId}:${row.topic.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ value: `course:${row.topic.key}`, label: `${row.lesson.start} · ${row.lesson.className} · ${lessonSubjectName(row.lesson.subject, language)} — §${row.topic.code} ${row.topic.title}` });
      }
      if (items.length) groups.push({ label, items });
    };
    add(t(language, 'Bugun', 'Сегодня', 'Today'), data.lessons.map((lesson) => ({ lesson, topic: topicForLesson(lesson, courses[lesson.classId], data.date) })));
    // Only today's topics: tomorrow's topic opens tomorrow.
    const any = data.lessons.length + (data.next ?? []).reduce((sum, day) => sum + day.lessons.length, 0);
    return any ? groups : null;
  }, [data, courses, language]);
}
