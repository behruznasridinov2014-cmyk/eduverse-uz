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
type TodayResponse = { date: string; weekday: number; now: string; lessons: TodayLesson[]; next?: NextDay[] };
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

/** Lessons of the next two school days with their planned topics (only a plan: not open yet). */
export function UpcomingDays({ data, courses, language, showTeacher = false }: { data: TodayResponse; courses: Record<string, ClassCourse>; language: Language; showTeacher?: boolean }) {
  const days = (data.next ?? []).filter((day) => day.lessons.length);
  if (!days.length) return null;
  const topics = upcomingTopics(data, courses);
  return (
    <section className="upcoming-days">
      {days.map((day) => (
        <div key={day.date} className="upcoming-day">
          <h3>{dayLabel(day, data.date, language)}</h3>
          <ul>
            {day.lessons.map((lesson) => {
              const topic = topics.get(lesson.id);
              return (
                <li key={lesson.id}>
                  <span className="upcoming-time">{lesson.start}</span>
                  <span className="upcoming-what"><b>{lesson.className} · {lessonSubjectName(lesson.subject, language)}</b>{topic ? <small>§{topic.code} {topic.title}</small> : null}</span>
                  {showTeacher && lesson.teacherName && <small className="muted upcoming-teacher">{lesson.teacherName}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="muted upcoming-note">{t(language, 'Bu reja: mavzu dars kuni ochiladi.', 'Это план: тема откроется в день урока.', 'This is a plan: the topic opens on the lesson day.')}</p>
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
  const courses = useLessonCourses(data?.lessons, data?.next);
  const isManager = role === 'school_director' || role === 'school_admin';
  const isFamily = role === 'parent';
  if (failed && !data) return null;
  if (!data) return <section className="today-block"><div className="today-skeleton" /></section>;
  const lessons = data.lessons;
  const left = lessons.filter((lesson) => statusOf(lesson, now) !== 'done').length;
  return (
    <section className="today-block" aria-label={t(language, 'Bugungi darslar', 'Уроки сегодня', 'Today’s lessons')}>
      <div className="today-head">
        <div>
          <h2>{isManager ? t(language, 'Maktabda bugun', 'Сегодня в школе', 'Today at school') : t(language, 'Bugungi darslar', 'Уроки сегодня', 'Today’s lessons')}</h2>
        </div>
        {lessons.length > 0 && <span className="today-count">{left > 0 ? t(language, `Qoldi: ${left} / ${lessons.length}`, `Осталось ${left} из ${lessons.length}`, `${left} of ${lessons.length} left`) : t(language, 'Hammasi tugadi', 'Все уроки прошли', 'All done')}</span>}
      </div>
      {lessons.length === 0 ? (
        <div className="today-empty">
          <CalendarCheck2 size={22} />
          <div>
            <b>{data.weekday === 7 ? t(language, 'Bugun dam olish kuni', 'Сегодня выходной', 'Today is a day off') : t(language, 'Bugun dars yo‘q', 'Сегодня уроков нет', 'No lessons today')}</b>
            <span className="muted">{isManager
              ? t(language, 'Dars jadvali «Maktab boshqaruvi» bo‘limida to‘ldiriladi.', 'Расписание заполняется в разделе «Управление школой».', 'The timetable is filled in “School management”.')
              : t(language, 'Jadvalni maktab to‘ldiradi. Savol bo‘lsa, direktorga yozing.', 'Расписание заполняет школа. Если что-то не так, напишите завучу.', 'The school fills the timetable.')}</span>
          </div>
        </div>
      ) : (
        <div className={`today-grid ${isManager ? 'is-compact' : ''}`}>
          {lessons.map((lesson, index) => {
            const status = statusOf(lesson, now);
            const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
            return (
              <button
                type="button"
                key={lesson.id}
                className={`today-card is-${status}`}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                onClick={() => onOpen(`/today/${lesson.id}`)}
              >
                <span className="today-card-top">
                  <span className="today-class">{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)}</span>
                  <span className={`today-status is-${status}`}>{status === 'current' && <i className="today-pulse" aria-hidden="true" />}{statusLabel(status, language)}</span>
                </span>
                <span className="today-time"><Clock3 size={15} /> {lesson.start}–{lesson.end} <small>· {t(language, `${lesson.period}-dars`, `${lesson.period}-й урок`, `Period ${lesson.period}`)}</small></span>
                <span className="today-subject">{lessonSubjectName(lesson.subject, language)}</span>
                <span className="today-topic">{topic ? <><b>§{topic.code}</b> {topic.title}</> : <span className="muted">{t(language, 'Darslik mavzusi yo‘q', 'Тема по учебнику не задана', 'No textbook topic')}</span>}</span>
                <span className="today-card-foot">
                  <span className={`today-left is-${status}`}>{timeText(lesson, now, language)}</span>
                  {(isManager || isFamily) && lesson.teacherName && <span className="muted today-teacher"><UserRound size={13} /> {lesson.teacherName}</span>}
                  {lesson.room && !isManager && <span className="muted today-room"><DoorOpen size={13} /> {lesson.room}</span>}
                  <ArrowRight size={16} className="today-arrow" />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(!isManager || lessons.length === 0) && <UpcomingDays data={data} courses={courses} language={language} showTeacher={isManager || isFamily} />}
    </section>
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
  { id: 'online', icon: MonitorPlay, label: ['Onlayn dars', 'Онлайн-урок', 'Online lesson'] },
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
    const planned = upcomingTopics(data, courses);
    for (const day of data.next ?? []) add(dayLabel(day, data.date, language), day.lessons.map((lesson) => ({ lesson, topic: planned.get(lesson.id) })));
    const any = data.lessons.length + (data.next ?? []).reduce((sum, day) => sum + day.lessons.length, 0);
    return any ? groups : null;
  }, [data, courses, language]);
}
