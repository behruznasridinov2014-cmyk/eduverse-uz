import { useState, type ReactNode } from 'react';
import type { User } from '@workspace/api-client-react';
import { ArrowLeft, Box, CalendarCheck2, Lock, PartyPopper } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { CoursePage, CourseScene3D } from './course';
import { AttendancePage } from './attendance-page';
import {
  LESSON_TABS, LessonDayHeader, nextBookLesson, openLessonPreview, UpcomingDays, bookForLesson, currentOrNext, statusOf, timeText, topicForLesson,
  lessonSubjectName, useLessonCourses, useToday, type TodayLesson,
} from './today';
import { LoadingBlock } from './ui/loading';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

function Loading({ language }: { language?: Language }) {
  return <LoadingBlock language={language} />;
}

/** Remembers which lesson the 3D studio should open on. */
export function rememberLessonFor3D(lesson: TodayLesson) {
  try { sessionStorage.setItem('eduverse:3d-lesson', lesson.id); } catch { /* private mode */ }
}

function UpNext({ lessons, now, current, language }: { lessons: TodayLesson[]; now: number; current?: TodayLesson; language: Language }) {
  const later = lessons.filter((lesson) => lesson.id !== current?.id && statusOf(lesson, now) === 'upcoming');
  if (!later.length) return null;
  return (
    <p className="today-upnext muted">
      {t(language, 'Keyin:', 'Дальше сегодня:', 'Later today:')}{' '}
      {later.map((lesson) => `${lesson.start} ${lesson.className} · ${lessonSubjectName(lesson.subject, language)}`).join('  ·  ')}
    </p>
  );
}

/**
 * "Lesson topic": only the lesson that is going on now (or the next one today).
 * When it ends, the next lesson takes its place; after the last lesson the day is closed.
 * A school with no timetable keeps the full textbook course.
 */
export function TodayCoursePage({ user, school, language, onOpen }: { user: User; school: SchoolData; language: Language; onOpen: (path: string) => void }) {
  const { data, failed, now } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.next);
  if (!data && !failed) return <Loading language={language} />;
  const lessons = data?.lessons ?? [];
  // Only the lesson of today: no lessons today → nothing to open, only the plan for the next days.
  const lesson = currentOrNext(lessons, now);
  if (!data || !lesson) {
    const none = lessons.length === 0;
    return (
      <section className="today-course">
        <div className="empty-state today-finished">
          <span className="empty-icon"><PartyPopper /></span>
          <h2>{none
            ? (data?.weekday === 7 ? t(language, 'Bugun dam olish kuni', 'Сегодня выходной', 'Today is a day off') : t(language, 'Bugun dars yo‘q', 'Сегодня уроков нет', 'No lessons today'))
            : t(language, 'Bugungi darslar tugadi', 'На сегодня уроки закончились', 'Today’s lessons are over')}</h2>
          <p>{t(language, 'Mavzu dars kuni, dars vaqtida ochiladi. Quyida keyingi darslar rejasi.', 'Тема открывается в день урока, во время урока. Ниже план следующих уроков.', 'A topic opens on the lesson day, during the lesson. Below is the plan of the next lessons.')}</p>
        </div>
        {data && nextBookLesson(data) && <div className="lesson-day-actions" style={{ justifyContent: 'center' }}><button type="button" className="btn primary" onClick={() => openLessonPreview(nextBookLesson(data)!, onOpen)}><CalendarCheck2 size={15} /> {t(language, 'Dars qanday ko‘rinishini ko‘rish', 'Посмотреть, как будет выглядеть урок', 'See how the lesson will look')}</button></div>}
        {data && <UpcomingDays data={data} courses={courses} language={language} />}
      </section>
    );
  }
  const status = statusOf(lesson, now);
  const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
  return (
    <section className="today-course">
      <LessonDayHeader lesson={lesson} topic={topic} status={status} now={now} language={language} />
      <div className="lesson-day-actions">
        <button type="button" className="btn" onClick={() => onOpen(`/today/${lesson.id}`)}><CalendarCheck2 size={15} /> {t(language, 'Dars sahifasi', 'Страница урока', 'Lesson page')}</button>
        {bookForLesson(lesson) && <button type="button" className="btn" onClick={() => { rememberLessonFor3D(lesson); onOpen('/lab'); }}><Box size={15} /> {t(language, '3D studiyada ochish', 'Открыть в 3D-студии', 'Open in the 3D studio')}</button>}
      </div>
      <UpNext lessons={lessons} now={now} current={lesson} language={language} />
      <CoursePage key={lesson.id} user={user} school={school} language={language} onOpen={onOpen} lesson={lesson} />
    </section>
  );
}

/** The page of one lesson from today's cards: topic and attendance. */
export function LessonDayPage({ lessonId, user, school, language, onOpen }: { lessonId: string; user: User; school: SchoolData; language: Language; onOpen: (path: string) => void }) {
  const { data, failed, now } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.next);
  const canAttend = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';
  const tabs = LESSON_TABS.filter((tab) => (tab.id === 'attendance' ? canAttend : true));
  const [tab, setTab] = useState<string>('topic');
  if (!data && !failed) return <Loading language={language} />;
  const lesson = data?.lessons.find((item) => item.id === lessonId);
  if (!data || !lesson) {
    return (
      <div className="empty-state">
        <h2>{t(language, 'Bu dars bugungi jadvalda yo‘q', 'Этого урока нет в сегодняшнем расписании', 'This lesson is not in today’s timetable')}</h2>
        <button type="button" className="btn primary" onClick={() => onOpen('/dashboard')}><ArrowLeft size={15} /> {t(language, 'Bugungi darslar', 'К урокам на сегодня', 'Back to today')}</button>
      </div>
    );
  }
  const status = statusOf(lesson, now);
  const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
  if (status === 'done') {
    return (
      <div className="empty-state">
        <span className="empty-icon"><PartyPopper /></span>
        <h2>{t(language, 'Bu dars tugadi', 'Этот урок закончился', 'This lesson is over')}</h2>
        <p>{lesson.start}–{lesson.end} · {lesson.className} · {lessonSubjectName(lesson.subject, language)}</p>
        <button type="button" className="btn primary" onClick={() => onOpen('/dashboard')}><ArrowLeft size={15} /> {t(language, 'Bugungi darslar', 'К урокам на сегодня', 'Back to today')}</button>
      </div>
    );
  }
  return (
    <section className="lesson-day">
      <button type="button" className="btn small lesson-day-back" onClick={() => onOpen('/dashboard')}><ArrowLeft size={14} /> {t(language, 'Bugungi darslar', 'Уроки на сегодня', 'Today’s lessons')}</button>
      <LessonDayHeader lesson={lesson} topic={topic} status={status} now={now} language={language} />
      {tabs.length > 1 && <div className="lesson-day-tabs" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={`studio-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>
              <Icon size={15} /> {t(language, item.label[0], item.label[1], item.label[2])}
            </button>
          );
        })}
      </div>}
      {tab === 'topic' && <CoursePage key={lesson.id} user={user} school={school} language={language} onOpen={onOpen} lesson={lesson} />}
      {tab === 'attendance' && canAttend && <AttendancePage key={lesson.id} user={user} language={language} lesson={{ classId: lesson.classId, subject: lesson.subject }} />}
    </section>
  );
}

/**
 * Top of the 3D studio: the 3D object of today's lesson topic.
 * Opens on the lesson chosen on "Lesson topic" (remembered), else the lesson going on now / next.
 */
export function LabTodayScene({ language, locked = false }: { language: Language; locked?: boolean }) {
  const { data, now } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.next);
  const [picked, setPicked] = useState<string>(() => { try { return sessionStorage.getItem('eduverse:3d-lesson') ?? ''; } catch { return ''; } });
  const withBook = (data?.lessons ?? []).filter((lesson) => bookForLesson(lesson));
  if (!data || withBook.length === 0) return null;
  const open = withBook.filter((lesson) => statusOf(lesson, now) !== 'done');
  // Locked (a pupil during the school day): only the lesson going on now, or the next one.
  const lesson = locked
    ? withBook.find((item) => statusOf(item, now) === 'current') ?? currentOrNext(withBook, now)
    : withBook.find((item) => item.id === picked) ?? currentOrNext(withBook, now);
  if (!lesson) return null;
  const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
  const status = statusOf(lesson, now);
  return (
    <section className="panel lab-today">
      <div className="lab-today-head">
        <div>
          <span className="eyebrow"><Box size={14} /> {t(language, 'Bugungi dars mavzusi', 'Тема сегодняшнего урока', 'Today’s lesson topic')}</span>
          <h2>{topic ? <>§{topic.code} {topic.title}</> : lessonSubjectName(lesson.subject, language)}</h2>
          <p className="muted">{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)} · {lessonSubjectName(lesson.subject, language)} · {lesson.start}–{lesson.end} · {timeText(lesson, now, language)}</p>
        </div>
        {!locked && open.length > 1 && (
          <div className="lab-today-pick" role="tablist">
            {open.map((item) => (
              <button type="button" role="tab" key={item.id} aria-selected={item.id === lesson.id} className={`studio-tab ${item.id === lesson.id ? 'active' : ''}`} onClick={() => { setPicked(item.id); rememberLessonFor3D(item); }}>
                {item.start} · {item.className} · {lessonSubjectName(item.subject, language)}
              </button>
            ))}
          </div>
        )}
      </div>
      {topic ? (
        <>
          <CourseScene3D key={`${lesson.id}:${topic.key}`} scene={topic.scene} language={language} />
          {topic.sceneHint && <p className="muted lab-today-hint">{topic.sceneHint}</p>}
        </>
      ) : <p className="muted">{t(language, 'Bu dars uchun 3D mavzu yo‘q.', 'Для этого урока нет 3D-темы.', 'No 3D topic for this lesson.')}</p>}
      {status === 'done' && <p className="muted">{t(language, 'Bu dars tugagan.', 'Этот урок уже закончился.', 'This lesson is over.')}</p>}
      {!locked && <p className="muted lab-today-more">{t(language, 'Pastda — boshqa mavzular uchun erkin 3D studiya.', 'Ниже — свободная 3D-студия для любых тем.', 'Below is the free 3D studio for any topic.')}</p>}
    </section>
  );
}

/**
 * The 3D studio page. A pupil, while today's lessons go on, sees only the 3D of the lesson topic,
 * so the studio does not take attention from the lesson. After the last lesson everything is open.
 */
export function LabPage({ user, language, children }: { user: User; language: Language; children: ReactNode }) {
  const { data, failed, now } = useToday();
  if (user.role !== 'student') return <><LabTodayScene language={language} />{children}</>;
  if (!data && !failed) return <Loading language={language} />;
  const lessons = data?.lessons ?? [];
  const firstStart = lessons.length ? Math.min(...lessons.map((lesson) => Date.parse(lesson.startsAt))) : 0;
  const lastEnd = lessons.length ? Math.max(...lessons.map((lesson) => Date.parse(lesson.endsAt))) : 0;
  const schoolDay = lessons.length > 0 && now >= firstStart && now < lastEnd;
  // In the demo school lessons are always going on, so the studio stays open there.
  const demo = Boolean((data as { demo?: boolean } | undefined)?.demo);
  if (!schoolDay || demo) return <><LabTodayScene language={language} />{children}</>;
  const end = new Date(lastEnd).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  return (
    <>
      <div className="notice lab-locked"><Lock size={16} /><span>{t(language,
        `Dars vaqtida faqat dars mavzusining 3D modeli ochiq. Erkin 3D studiya darslardan keyin (${end} dan) ochiladi.`,
        `Во время уроков открыта только 3D-модель темы урока. Свободная 3D-студия откроется после уроков, в ${end}.`,
        `During lessons only the 3D of the lesson topic is open. The free 3D studio opens after lessons, at ${end}.`)}</span></div>
      <LabTodayScene language={language} locked />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Preview of a lesson that is not going on now                        */
/* ------------------------------------------------------------------ */

export function LessonPreviewPage({ user, school, language, onOpen }: { user: User; school: SchoolData; language: Language; onOpen: (path: string) => void }) {
  const [lesson] = useState<TodayLesson | null>(() => { try { const raw = sessionStorage.getItem('eduverse:preview-lesson'); return raw ? JSON.parse(raw) as TodayLesson : null; } catch { return null; } });
  if (!lesson) {
    return (
      <div className="empty-state">
        <h2>{t(language, 'Dars tanlanmagan', 'Урок не выбран', 'No lesson chosen')}</h2>
        <button type="button" className="btn primary" onClick={() => onOpen('/schedule')}><ArrowLeft size={15} /> {t(language, 'Jadvalga', 'К расписанию', 'To the timetable')}</button>
      </div>
    );
  }
  const date = lesson.startsAt.slice(0, 10);
  return (
    <section className="lesson-day lesson-preview">
      <button type="button" className="btn small lesson-day-back" onClick={() => onOpen('/schedule')}><ArrowLeft size={14} /> {t(language, 'Jadval', 'Расписание', 'Timetable')}</button>
      <div className="notice lesson-preview-note"><CalendarCheck2 size={16} /><span>{t(language,
        `Oldindan ko‘rish: ${date.split('-').reverse().join('.')} ${lesson.start} dagi dars shunday ko‘rinadi. Davomat va uy vazifasi dars vaqtida ishlaydi.`,
        `Предпросмотр: так будет выглядеть урок ${date.split('-').reverse().join('.')} в ${lesson.start}. Давомат и домашка заработают во время урока.`,
        `Preview: this is how the lesson on ${date.split('-').reverse().join('.')} at ${lesson.start} will look. Attendance and homework work during the lesson.`)}</span></div>
      <header className="lesson-day-head is-upcoming">
        <div>
          <span className="eyebrow">{t(language, `${lesson.period}-dars`, `${lesson.period}-й урок`, `Period ${lesson.period}`)} · {lesson.start}–{lesson.end}{lesson.room ? ` · ${t(language, 'xona', 'каб.', 'room')} ${lesson.room}` : ''}</span>
          <h1>{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)} · {lessonSubjectName(lesson.subject, language)}</h1>
        </div>
      </header>
      <CoursePage key={lesson.id} user={user} school={school} language={language} onOpen={onOpen} lesson={lesson} />
    </section>
  );
}
