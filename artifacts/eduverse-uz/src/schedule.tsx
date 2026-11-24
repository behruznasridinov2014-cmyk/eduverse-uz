import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { ArrowRight, BookOpen, Box, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, DoorOpen, MonitorPlay, NotebookPen, UserRound } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import type { CourseTopic } from './course-data';
import { TimetableEditor } from './timetable-editor';
import { LoadingBlock } from './ui/loading';
import { LessonChangeTag, bookForLesson, lessonSubjectName, openLessonPreview, statusOf, topicForLesson, type TodayLesson } from './today';

/*
 * "Timetable" tab.
 *  - Director / deputy: they write the weekly timetable (lesson, class, teacher, room, bell times).
 *  - Teacher / pupil / parent: their week, Monday to Saturday: time, class, room and the textbook
 *    topic of each lesson, so the teacher knows what to teach and where.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type WeekDay = { date: string; weekday: number; lessons: TodayLesson[] };
type Week = { today: string; now: string; offset: number; days: WeekDay[] };
type ClassCourse = { progress: Array<{ topicKey: string; doneOn: string }> };

const DAY_NAMES: Record<Language, string[]> = {
  Uzbek: ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
  'Русский': ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  English: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const MONTHS: Record<Language, string[]> = {
  Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  'Русский': ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  English: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const dayText = (date: string, language: Language) => { const [, m, d] = date.split('-').map(Number); return language === 'English' ? `${MONTHS.English[(m ?? 1) - 1]} ${d}` : `${d} ${MONTHS[language][(m ?? 1) - 1]}`; };

/**
 * The textbook topic of every lesson of the week: a past lesson shows what the class covered that
 * day, today's lesson today's topic, the next days the following topics in order (the plan).
 */
function weekTopics(week: Week, courses: Record<string, ClassCourse>): Map<string, { topic?: CourseTopic; plan: boolean }> {
  const out = new Map<string, { topic?: CourseTopic; plan: boolean }>();
  const steps = new Map<string, { last: string; step: number }>();
  const all = week.days.flatMap((day) => day.lessons.map((lesson) => ({ day, lesson })));
  const hasToday = new Set(all.filter((row) => row.day.date === week.today).map((row) => `${row.lesson.classId}:${row.lesson.subject}`));
  for (const { day, lesson } of all) {
    const book = bookForLesson(lesson);
    if (!book) continue;
    const course = courses[lesson.classId];
    if (day.date < week.today) {
      const done = new Set((course?.progress ?? []).filter((item) => item.doneOn === day.date).map((item) => item.topicKey));
      out.set(lesson.id, { topic: book.topics.find((item) => done.has(item.key)), plan: false });
      continue;
    }
    const base = topicForLesson(lesson, course, week.today);
    if (day.date === week.today || !base) { out.set(lesson.id, { topic: base, plan: day.date !== week.today }); continue; }
    const key = `${lesson.classId}:${lesson.subject}`;
    const state = steps.get(key) ?? { last: '', step: hasToday.has(key) ? 1 : 0 };
    if (state.last && state.last !== day.date) state.step += 1;
    state.last = day.date;
    steps.set(key, state);
    const index = book.topics.findIndex((item) => item.key === base.key);
    out.set(lesson.id, { topic: book.topics[Math.min(book.topics.length - 1, index + state.step)], plan: true });
  }
  return out;
}

export function SchedulePage({ user, school, language, onOpen }: { user: User; school: SchoolData; language: Language; onOpen: (path: string) => void }) {
  const manager = user.role === 'school_director' || user.role === 'school_admin';
  const schoolId = school.memberships[0]?.schoolId;
  return (
    <section className="schedule-page">
      <div className="page-heading">
        <div>
          <h1>{t(language, 'Dars jadvali', 'Расписание', 'Timetable')}</h1>
        </div>
      </div>
      {manager
        ? (schoolId ? <TimetableEditor schoolId={schoolId} language={language} /> : <LoadingBlock language={language} />)
        : <MyWeek user={user} language={language} onOpen={onOpen} />}
    </section>
  );
}

function MyWeek({ user, language, onOpen }: { user: User; language: Language; onOpen: (path: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [week, setWeek] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [courses, setCourses] = useState<Record<string, ClassCourse>>({});
  const teacher = user.role === 'teacher';
  const load = useCallback(() => {
    setFailed(false);
    void customFetch<Week>(`/api/me/week?offset=${offset}`, { method: 'GET' }).then(setWeek).catch(() => setFailed(true));
  }, [offset]);
  useEffect(() => { setWeek(null); load(); }, [load]);
  const classIds = useMemo(() => [...new Set((week?.days ?? []).flatMap((day) => day.lessons.map((lesson) => lesson.classId)))].sort().join(','), [week]);
  useEffect(() => {
    if (!classIds) return;
    let alive = true;
    void Promise.all(classIds.split(',').map((id) => customFetch<ClassCourse>(`/api/classes/${id}/course`, { method: 'GET' }).then((course) => [id, course] as const).catch(() => [id, null] as const)))
      .then((rows) => { if (alive) setCourses(Object.fromEntries(rows.filter((row) => row[1]).map(([id, course]) => [id, course!]))); });
    return () => { alive = false; };
  }, [classIds]);
  const topics = useMemo(() => (week ? weekTopics(week, courses) : new Map()), [week, courses]);
  const now = Date.now();
  const total = week?.days.reduce((sum, day) => sum + day.lessons.length, 0) ?? 0;
  const monday = week?.days[0]?.date;
  const saturday = week?.days[5]?.date;

  return (
    <>
      <div className="schedule-weekbar">
        <button type="button" className="btn" onClick={() => setOffset((value) => value - 1)} aria-label={t(language, 'Oldingi hafta', 'Прошлая неделя', 'Previous week')}><ChevronLeft size={16} /></button>
        <div className="schedule-weekbar-title">
          <b>{offset === 0 ? t(language, 'Shu hafta', 'Эта неделя', 'This week') : offset === 1 ? t(language, 'Keyingi hafta', 'Следующая неделя', 'Next week') : offset === -1 ? t(language, 'O‘tgan hafta', 'Прошлая неделя', 'Last week') : offset > 0 ? t(language, `${offset} hafta keyin`, `Через ${offset} нед.`, `In ${offset} weeks`) : t(language, `${-offset} hafta oldin`, `${-offset} нед. назад`, `${-offset} weeks ago`)}</b>
          {monday && saturday && <span className="muted">{dayText(monday, language)} — {dayText(saturday, language)}</span>}
        </div>
        <button type="button" className="btn" onClick={() => setOffset((value) => value + 1)} aria-label={t(language, 'Keyingi hafta', 'Следующая неделя', 'Next week')}><ChevronRight size={16} /></button>
        {offset !== 0 && <button type="button" className="btn small" onClick={() => setOffset(0)}>{t(language, 'Bugun', 'Сегодня', 'Today')}</button>}
      </div>
      {failed && <div className="notice" role="alert">{t(language, 'Aloqa yo‘q. Bir daqiqadan so‘ng urinib ko‘ring.', 'Нет связи. Попробуйте через минуту.', 'No connection. Try again in a minute.')}</div>}
      {!week && !failed && <LoadingBlock language={language} />}
      {week && total === 0 && (
        <div className="today-empty"><CalendarDays size={22} /><div><b>{t(language, 'Bu haftada dars yo‘q', 'На этой неделе уроков нет', 'No lessons this week')}</b><span className="muted">{t(language, 'Jadvalni direktor yoki zavuch to‘ldiradi.', 'Расписание заполняет директор или завуч.', 'The director or deputy fills the timetable.')}</span></div></div>
      )}
      {week && total > 0 && (
        <div className="schedule-week">
          {week.days.map((day) => {
            const isToday = day.date === week.today;
            const past = day.date < week.today;
            return (
              <section key={day.date} className={`schedule-day ${isToday ? 'is-today' : ''} ${past ? 'is-past' : ''}`}>
                <header>
                  <b>{DAY_NAMES[language][day.weekday - 1]}</b>
                  <span className="muted">{dayText(day.date, language)}{isToday ? ` · ${t(language, 'bugun', 'сегодня', 'today')}` : ''}</span>
                </header>
                {day.lessons.length === 0 ? <p className="muted schedule-free">{t(language, 'Dars yo‘q', 'Нет уроков', 'No lessons')}</p> : (
                  <ol className="schedule-lessons">
                    {day.lessons.map((lesson) => {
                      const info = topics.get(lesson.id);
                      const status = isToday ? statusOf(lesson, now) : past ? 'done' : 'upcoming';
                      const open = isToday && status !== 'done';
                      return (
                        <li key={lesson.id} className={`schedule-lesson is-${status}`}>
                          <div className="schedule-lesson-time"><Clock3 size={13} /> {lesson.start}–{lesson.end}</div>
                          <div className="schedule-lesson-main">
                            <b>{lessonSubjectName(lesson.subject, language)}</b>
                            {lesson.change && <LessonChangeTag change={lesson.change} language={language} />}
                            <span className="schedule-lesson-meta">
                              {teacher ? <span>{t(language, `${lesson.className} sinf`, `${lesson.className} класс`, `Class ${lesson.className}`)}</span> : lesson.teacherName ? <span><UserRound size={12} /> {lesson.teacherName}</span> : null}
                              {lesson.room && <span><DoorOpen size={12} /> {t(language, `${lesson.room}-xona`, `каб. ${lesson.room}`, `room ${lesson.room}`)}</span>}
                            </span>
                            {info?.topic && <span className="schedule-topic">{past ? <CheckCircle2 size={13} /> : <BookOpen size={13} />} §{info.topic.code} {info.topic.title}{info.plan && <small className="muted"> · {t(language, 'reja', 'по плану', 'planned')}</small>}</span>}
                            {status === 'current' && <span className="tag green schedule-now">{t(language, 'Hozir', 'Сейчас идёт', 'Now')}</span>}
                          </div>
                          {!open && info?.topic && (user.role === 'teacher' || user.role === 'student') && (
                            <div className="schedule-lesson-actions">
                              <button type="button" className="btn small" onClick={() => openLessonPreview(lesson, onOpen)}>{past ? t(language, 'Darsni ko‘rish', 'Посмотреть урок', 'View lesson') : t(language, 'Oldindan ko‘rish', 'Предпросмотр урока', 'Preview the lesson')} <ArrowRight size={14} /></button>
                            </div>
                          )}
                          {open && (
                            <div className="schedule-lesson-actions">
                              <button type="button" className="btn small primary" onClick={() => onOpen(`/today/${lesson.id}`)}>{t(language, 'Darsni ochish', 'Открыть урок', 'Open lesson')} <ArrowRight size={14} /></button>
                              {teacher && info?.topic && <button type="button" className="btn small" onClick={() => onOpen(`/lesson/course:${info.topic!.key}`)}><MonitorPlay size={14} /> {t(language, 'Onlayn', 'Онлайн', 'Online')}</button>}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/** How a lesson goes on EDUVERSE, in four steps. */
function LessonHowTo({ language }: { language: Language }) {
  const steps: Array<[typeof BookOpen, string]> = [
    [BookOpen, t(language, 'Darslikni oching — mavzu betlari o‘zi ochiladi', 'Откройте учебник — страницы темы откроются сами', 'Open the textbook — the topic pages open by themselves')],
    [Box, t(language, 'Tushuntiring va 3D da ko‘rsating', 'Объясните и покажите в 3D', 'Explain and show it in 3D')],
    [CheckCircle2, t(language, 'Tekshiring: 3–5 savol, esda qoldimi', 'Проверьте: 3–5 вопросов — запомнили ли', 'Check: 3–5 questions — did it stick')],
    [NotebookPen, t(language, 'Uy vazifasi darslikdan o‘zi yuboriladi', 'Домашка из учебника уйдёт классу сама', 'Homework from the book goes out by itself')],
  ];
  return (
    <ol className="lesson-howto">
      {steps.map(([Icon, label], index) => (
        <li key={index}><span className="lesson-howto-num">{index + 1}</span><Icon size={16} /><span>{label}</span></li>
      ))}
    </ol>
  );
}
