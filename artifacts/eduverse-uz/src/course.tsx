import './scenes.css';
import { DateField } from './ui/date-field';
import { Select } from './ui/select';
import { SceneText } from './scene-text';
import { createPortal } from 'react-dom';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { User } from '@workspace/api-client-react';
import { customFetch } from '@workspace/api-client-react';
import { BookOpen, Box, CalendarCheck2, CheckCircle2, ChevronRight, GraduationCap, Lightbulb, Lock, Maximize2, Minimize2, MonitorPlay, NotebookPen, Sparkles, Target, Users } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { bookForLesson, type TodayLesson } from './today';
import { COURSE, SUBJECT_LABEL, pdfPageOf, type CourseBook, type CourseScene, type CourseTopic } from './course-data';
import type { OwnSceneId } from './course-scenes';
import { MoleculeById, ReactionView } from './chem-lab';
import { Circuit, Pendulum } from './physics-lab';
import { CollisionLab } from './collision-lab';
import { MathLab } from './studio-labs';
import { LessonStages } from './lesson-stages';
import { LoadingBlock } from './ui/loading';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* Our own scenes load on demand: each subject is a separate small chunk. */
type SceneProps = { mode?: string };
const physics = () => import('./scenes-physics');
const chem = () => import('./scenes-chem');
const bio = () => import('./scenes-bio');
const math = () => import('./scenes-math');
const OWN: Record<OwnSceneId, ComponentType<SceneProps>> = {
  lab: lazy(() => physics().then((m) => ({ default: m.LabScene }))),
  measure: lazy(() => physics().then((m) => ({ default: m.MeasureScene }))),
  motion: lazy(() => physics().then((m) => ({ default: m.MotionScene }))),
  forces: lazy(() => physics().then((m) => ({ default: m.ForcesScene }))),
  solar: lazy(() => physics().then((m) => ({ default: m.SolarScene }))),
  particles: lazy(() => chem().then((m) => ({ default: m.ParticlesScene }))),
  ph: lazy(() => chem().then((m) => ({ default: m.PhScene }))),
  mixtures: lazy(() => chem().then((m) => ({ default: m.MixturesScene }))),
  cell: lazy(() => bio().then((m) => ({ default: m.CellScene }))),
  body: lazy(() => bio().then((m) => ({ default: m.BodyScene }))),
  classify: lazy(() => bio().then((m) => ({ default: m.ClassifyScene }))),
  microbes: lazy(() => bio().then((m) => ({ default: m.MicrobesScene }))),
  foodweb: lazy(() => bio().then((m) => ({ default: m.FoodWebScene }))),
  leaf: lazy(() => bio().then((m) => ({ default: m.LeafScene }))),
  factors: lazy(() => math().then((m) => ({ default: m.FactorsScene }))),
  numberline: lazy(() => math().then((m) => ({ default: m.NumberLineScene }))),
  balance: lazy(() => math().then((m) => ({ default: m.BalanceScene }))),
  geometry: lazy(() => math().then((m) => ({ default: m.GeometryScene }))),
};

/**
 * Frame around every 3D scene: "full screen" for showing it to the whole class
 * on a projector or an interactive board. The scene is scaled to the screen.
 */
function SceneShell({ language, children }: { language: Language; children: ReactNode }) {
  const shell = useRef<HTMLDivElement | null>(null);
  // "native": the browser's real full screen; "overlay": the scene covers the window
  // (iPhone Safari and embedded views cannot put one block full screen).
  // In full screen the stage itself grows (no page zoom), so dragging and clicks stay exact.
  const [mode, setMode] = useState<'off' | 'native' | 'overlay'>('off');
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement === shell.current) setMode('native');
      else setMode((current) => (current === 'native' ? 'off' : current));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (mode === 'off') return;
    const fit = () => setScale(Math.max(1, Math.min(2.2, (window.innerHeight - 170) / 340, (window.innerWidth - 380) / 520)));
    fit();
    window.addEventListener('resize', fit);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && mode === 'overlay') setMode('off'); };
    document.addEventListener('keydown', onKey);
    if (mode === 'overlay') document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [mode]);
  const toggle = () => {
    if (mode === 'native') { void document.exitFullscreen().catch(() => setMode('off')); return; }
    if (mode === 'overlay') { setMode('off'); return; }
    const element = shell.current;
    if (element?.requestFullscreen && document.fullscreenEnabled) {
      element.requestFullscreen().catch(() => setMode('overlay'));
      // Some views accept the call but never switch: fall back after a moment.
      window.setTimeout(() => { if (document.fullscreenElement !== element) setMode((current) => (current === 'off' ? 'overlay' : current)); }, 400);
    } else {
      setMode('overlay');
    }
  };
  const full = mode !== 'off';
  const button = (
    <button type="button" className="btn small scene-full-btn" onClick={toggle}>
      {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {full ? t(language, 'Chiqish', 'Выйти', 'Exit') : t(language, 'Sinfga ko‘rsatish', 'На весь экран', 'Full screen')}
    </button>
  );
  const fullStyle = { ['--full-scale' as string]: String(scale) } as React.CSSProperties;
  if (mode === 'overlay' && typeof document !== 'undefined') {
    // Rendered at the root of the page: animated parents cannot clip a fixed layer there.
    return (
      <>
        <div ref={shell} className="scene-shell scene-placeholder" />
        {createPortal(
          <div className="scene-shell scene-full scene-overlay" role="dialog" aria-modal="true" style={fullStyle}>
            {button}
            <div className="scene-shell-body">{children}</div>
          </div>,
          document.body,
        )}
      </>
    );
  }
  return (
    <div ref={shell} className={`scene-shell ${full ? 'scene-full' : ''}`} style={full ? fullStyle : undefined}>
      {button}
      <div className="scene-shell-body">{children}</div>
    </div>
  );
}

/** The 3D part of a textbook topic. Every scene is ours and can be operated by the student. */
export function CourseScene3D({ scene, language }: { scene: CourseScene; language: Language }) {
  return <SceneShell language={language}><SceneView scene={scene} language={language} /></SceneShell>;
}

function SceneView({ scene, language }: { scene: CourseScene; language: Language }) {
  switch (scene.kind) {
    case 'own': {
      const Scene = OWN[scene.scene];
      return <SceneText language={language}><Suspense fallback={<LoadingBlock language={language} kind="3d" />}><Scene key={`${scene.scene}:${scene.mode ?? ''}`} mode={scene.mode} /></Suspense></SceneText>;
    }
    case 'molecule': return <MoleculeById id={scene.id} language={language} />;
    case 'reaction': return <ReactionView a={scene.a} b={scene.b} language={language} />;
    case 'pendulum': return <Pendulum language={language} />;
    case 'circuit': return <Circuit language={language} />;
    case 'collision': return <CollisionLab language={language} />;
    case 'solid': return <MathLab language={language} initial={scene.solid} />;
  }
}

/** Last PDF page of a topic: the page before the next topic starts (at least its first page). */
/** The essence as short points, one sentence each. */
function keyPoints(topic: CourseTopic): string[] {
  return topic.essence.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁЎҚҒҲ0-9«])/u).map((item) => item.trim()).filter((item) => item.length > 12);
}

/** Opens the topic's pages in the textbook reader (read and write). */
export function openTextbook(book: CourseBook, topic: CourseTopic, onOpen: (path: string) => void) {
  const page = pdfPageOf(book, topic);
  if (page) { try { localStorage.setItem(`eduverse:pdf-page:/books/${book.bookId}.pdf`, String(page)); localStorage.setItem(`eduverse:pdf-range:/books/${book.bookId}.pdf`, `${page}-${topicEndPage(book, topic, page)}`); } catch { /* private mode */ } }
  onOpen(`/read/${book.bookId}`);
}

export function topicEndPage(book: CourseBook, topic: CourseTopic, start: number): number {
  const later = book.topics.map((item) => item.page + book.pdfOffset).filter((page) => page > start).sort((a, b) => a - b)[0];
  return Math.min(book.pdfPages, later ? Math.max(start, later - 1) : start + 3);
}

const PdfViewerLazy = lazy(() => import('./pdf-viewer').then((m) => ({ default: m.PdfViewer })));

/**
 * Step 1 of a lesson: the textbook pages of the topic, right on the page (no switching tabs).
 * The PDF loads only when opened, so the lesson page stays fast on a tablet.
 */
export function TopicBookPages({ book, topic, language, step }: { book: CourseBook; topic: CourseTopic; language: Language; step?: number }) {
  const [open, setOpen] = useState(false);
  const start = pdfPageOf(book, topic);
  const label = `${step ? `${step} · ` : ''}${t(language, 'Darslikni oching', 'Откройте учебник', 'Open the textbook')}`;
  if (!start) {
    return (
      <section className="panel course-book" id="step-book">
        <h3><BookOpen size={17} /> {label}</h3>
        <p className="muted">{t(language, `Darslik, ${topic.page}-bet. Bu bet hali yuklanmagan — qog‘oz darslikdan oching.`, `Учебник, стр. ${topic.page}. Эта страница ещё не загружена — откройте бумажный учебник.`, `Textbook, p. ${topic.page}. This page is not uploaded yet — use the paper book.`)}</p>
      </section>
    );
  }
  const end = topicEndPage(book, topic, start);
  return (
    <section className="panel course-book" id="step-book">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3><BookOpen size={17} /> {label}</h3>
        <button type="button" className={`btn ${open ? '' : 'primary'}`} onClick={() => setOpen((value) => !value)}>
          <BookOpen size={15} /> {open ? t(language, 'Yopish', 'Закрыть', 'Close') : t(language, `${topic.page}-betni ochish`, `Открыть стр. ${topic.page}`, `Open p. ${topic.page}`)}
        </button>
      </div>
      {open && (
        <Suspense fallback={<LoadingBlock language={language} kind="book" />}>
          <PdfViewerLazy url={`/books/${book.bookId}.pdf`} title={book.title} language={language} range={{ from: start, to: end }} />
        </Suspense>
      )}
    </section>
  );
}

const studiedKey = (userId: string) => `eduverse:studied:${userId}`;

/* ------------------------------------------------------------------ */
/* School calendar and finish forecast                                  */
/* ------------------------------------------------------------------ */

const DAY = 24 * 3600 * 1000;
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export type SchoolCalendar = { quarters: Array<{ start: string; end: string }>; holidays: Array<{ from: string; to: string; name: string }> };
type Span = [number, Date, Date];
const dayOf = (value: string) => new Date(`${value}T00:00:00`);
const schoolYearOf = (date: Date) => (date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1);
/** Quarters of the school year starting in September of `year`: the school's own calendar, else the usual Uzbek one. */
function quarters(year: number, calendar?: SchoolCalendar | null): Span[] {
  if (calendar?.quarters.length === 4 && schoolYearOf(dayOf(calendar.quarters[0].start)) === year) {
    return calendar.quarters.map((item, index): Span => [index + 1, dayOf(item.start), new Date(dayOf(item.end).getTime() + DAY - 1)]);
  }
  return [
    [1, new Date(year, 8, 2), new Date(year, 9, 31)],
    [2, new Date(year, 10, 9), new Date(year, 11, 27)],
    [3, new Date(year + 1, 0, 12), new Date(year + 1, 2, 20)],
    [4, new Date(year + 1, 2, 30), new Date(year + 1, 4, 25)],
  ];
}
/** Study time of two school years with the holidays and other days off cut out. */
function studySpans(from: Date, calendar?: SchoolCalendar | null): Span[] {
  const year = schoolYearOf(from);
  const off = (calendar?.holidays ?? []).map((item) => [dayOf(item.from).getTime(), dayOf(item.to).getTime() + DAY] as const);
  const spans: Span[] = [];
  for (const [n, start, end] of [...quarters(year, calendar), ...quarters(year + 1, calendar)]) {
    let pieces: Array<[number, number]> = [[start.getTime(), end.getTime()]];
    for (const [a, b] of off) {
      pieces = pieces.flatMap(([x, y]): Array<[number, number]> => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as [number, number]] : []), ...(b < y ? [[b, y] as [number, number]] : [])]));
    }
    for (const [x, y] of pieces) spans.push([n, new Date(x), new Date(y)]);
  }
  return spans;
}
/** School weeks between two dates (holidays are skipped). */
function schoolWeeks(from: Date, to: Date, calendar?: SchoolCalendar | null): number {
  let days = 0;
  for (const [, start, end] of studySpans(from, calendar)) {
    const a = Math.max(start.getTime(), from.getTime());
    const b = Math.min(end.getTime(), to.getTime());
    if (b > a) days += (b - a) / DAY;
  }
  return days / 7;
}
/** Date after `weeks` school weeks from `from`, skipping holidays. */
function addSchoolWeeks(from: Date, weeks: number, calendar?: SchoolCalendar | null): Date {
  let left = weeks * 7 * DAY;
  for (const [, start, end] of studySpans(from, calendar)) {
    const a = Math.max(start.getTime(), from.getTime());
    if (end.getTime() <= a) continue;
    const span = end.getTime() - a;
    if (left <= span) return new Date(a + left);
    left -= span;
  }
  return new Date(from.getTime() + weeks * 7 * DAY);
}

type ClassCourse = { progress: Array<{ topicKey: string; doneOn: string }>; pace: Array<{ book: string; lessonsPerWeek: number }>; calendar?: SchoolCalendar | null; canEdit: boolean };

function useClassCourse(classId: string | null) {
  const [data, setData] = useState<ClassCourse | null>(null);
  const load = useCallback(() => {
    if (!classId) { setData(null); return; }
    void customFetch<ClassCourse>(`/api/classes/${classId}/course`, { method: 'GET' }).then(setData).catch(() => setData(null));
  }, [classId]);
  useEffect(() => { load(); }, [load]);
  return [data, load] as const;
}

/**
 * `lesson` (from today's timetable) locks the page to that lesson: its class, its subject and the
 * topic the class is on. Without it, the page is the full textbook course (schools with no timetable).
 */
export function CoursePage({ user, school, language, onOpen, lesson, lessonActions }: { user: User; school: SchoolData; language: Language; onOpen: (path: string) => void; lesson?: TodayLesson; lessonActions?: ReactNode }) {
  const isStudent = user.role === 'student';
  const isTeacher = !isStudent;
  const grades = useMemo(() => [...new Set(COURSE.map((book) => book.grade))].sort((a, b) => a - b), []);
  const studentGrade = school.classes[0]?.grade ?? null;
  const [grade, setGrade] = useState<number>(lesson?.grade ?? (isStudent ? studentGrade ?? 0 : grades[0] ?? 7));
  useEffect(() => {
    if (lesson) setGrade(lesson.grade);
    else if (isStudent && studentGrade) setGrade(studentGrade);
  }, [isStudent, studentGrade, lesson]);

  // A student only studies the books of their own grade — not the next years.
  const books = COURSE.filter((book) => book.grade === grade);
  const [bookId, setBookId] = useState<string>(() => {
    // Attendance → "Open today's topic" remembers the lesson's subject.
    let wanted: string | null = null;
    try { wanted = localStorage.getItem('eduverse:course-subject'); localStorage.removeItem('eduverse:course-subject'); } catch { /* private mode */ }
    return books.find((item) => item.subject === wanted)?.id ?? books[0]?.id ?? '';
  });
  const lessonBook = lesson ? bookForLesson(lesson) : undefined;
  const book: CourseBook | undefined = lesson ? lessonBook : books.find((item) => item.id === bookId) ?? books[0];
  const [topicKey, setTopicKey] = useState<string>(book?.topics[0]?.key ?? '');
  const topic: CourseTopic | undefined = book?.topics.find((item) => item.key === topicKey) ?? book?.topics[0];
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});
  const [selfCheck, setSelfCheck] = useState<Record<number, boolean>>({});
  const [studied, setStudied] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(studiedKey(user.id)) ?? '[]') as string[]; } catch { return []; }
  });
  const classes = school.classes.filter((item) => !item.grade || item.grade === grade);
  const savedClass = (() => { try { return localStorage.getItem('eduverse:course-class'); } catch { return null; } })();
  const [classId, setClassIdState] = useState<string | null>(classes.find((item) => item.id === savedClass)?.id ?? classes[0]?.id ?? null);
  const setClassId = (id: string | null) => { setClassIdState(id); try { if (id) localStorage.setItem('eduverse:course-class', id); } catch { /* private mode */ } };
  useEffect(() => { if (!classId || !classes.some((item) => item.id === classId)) setClassIdState(classes.find((item) => item.id === savedClass)?.id ?? classes[0]?.id ?? null); }, [classes, classId, savedClass]);
  const activeClassId = lesson?.classId ?? classId;
  const [course, reload] = useClassCourse(activeClassId);
  // The tab opens on today's topic: the one the class covered today, else the next one.
  // The whole book list stays hidden until asked for.
  const [showAll, setShowAll] = useState(false);
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !book || !course) return;
    const todayIso = iso(new Date());
    const doneToday = course.progress.filter((item) => item.doneOn === todayIso).map((item) => item.topicKey);
    const coveredKeys = new Set(course.progress.map((item) => item.topicKey));
    const lastCovered = book.topics.reduce((last, item, index) => (coveredKeys.has(item.key) ? index : last), -1);
    const today = book.topics.find((item) => doneToday.includes(item.key)) ?? book.topics[lastCovered + 1] ?? book.topics[book.topics.length - 1];
    if (today) setTopicKey(today.key);
  }, [book, course]);
  const chooseTopic = (key: string) => { picked.current = true; setTopicKey(key); };
  const [doneOn, setDoneOn] = useState(() => iso(new Date()));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(studiedKey(user.id), JSON.stringify(studied)); } catch { /* private mode */ }
  }, [studied, user.id]);
  useEffect(() => { setOpenAnswers({}); setSelfCheck({}); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }, [topicKey]);
  useEffect(() => { if (book && !book.topics.some((item) => item.key === topicKey)) setTopicKey(book.topics[0]?.key ?? ''); }, [book, topicKey]);

  if (lesson && !lessonBook) {
    return <Empty text={t(language, 'Bu fan uchun EDUVERSE’da hali darslik yo‘q.', 'Для этого предмета в EDUVERSE пока нет учебника.', 'There is no textbook for this subject in EDUVERSE yet.')} />;
  }
  if (isStudent && !lesson && school.status === 'ready' && !studentGrade) {
    return <Empty text={t(language, 'Sizni hali sinfga qo‘shishmagan. Maktab ma’muriyatiga murojaat qiling.', 'Вас ещё не добавили в класс. Обратитесь к администрации школы.', 'You are not in a class yet. Contact the school administration.')} />;
  }
  if (!book || !topic) {
    return <Empty text={t(language, `${grade}-sinf darsliklari hali yuklanmagan.`, `Учебники для ${grade} класса ещё не загружены.`, `Textbooks for grade ${grade} are not uploaded yet.`)} />;
  }

  const chapters = [...new Set(book.topics.map((item) => item.chapter))];
  const done = book.topics.filter((item) => studied.includes(item.key)).length;
  const pdfPage = pdfPageOf(book, topic);
  const isStudied = studied.includes(topic.key);
  const subjectName = (subject: CourseBook['subject']) => t(language, ...SUBJECT_LABEL[subject]);

  /* where the class stopped + forecast */
  const marks = new Map((course?.progress ?? []).map((item) => [item.topicKey, item.doneOn]));
  const covered = book.topics.filter((item) => marks.has(item.key));
  const lastIndex = book.topics.reduce((last, item, index) => (marks.has(item.key) ? index : last), -1);
  const nextTopic = book.topics[lastIndex + 1];
  const pace = course?.pace.find((item) => item.book === book.bookId)?.lessonsPerWeek ?? book.lessonsPerWeek;
  const today = new Date();
  const year = schoolYearOf(today);
  const calendar = course?.calendar ?? null;
  const yearQuarters = quarters(year, calendar);
  const quarter = yearQuarters.find(([, start, end]) => today >= start && today <= new Date(end.getTime() + DAY)) ?? yearQuarters.find(([, start]) => today < start) ?? yearQuarters[3];
  const remaining = book.topics.length - covered.length;
  const weeksLeft = remaining / Math.max(1, pace);
  const finish = addSchoolWeeks(today, weeksLeft, calendar);
  const yearEnd = yearQuarters[3][2];
  const byQuarterEnd = Math.min(book.topics.length, covered.length + Math.round(schoolWeeks(today, quarter[2], calendar) * pace));
  const MONTHS: Record<Language, string[]> = {
    Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    'Русский': ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    English: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  };
  const fmt = (date: Date) => `${date.getDate()} ${MONTHS[language][date.getMonth()]}`;
  const markDate = (key: string) => { const raw = marks.get(key); return raw ? fmt(new Date(`${raw}T12:00:00`)) : ''; };

  async function mark(target: CourseTopic, on: boolean) {
    if (!activeClassId) return;
    setBusy(true);
    try {
      await customFetch(`/api/classes/${activeClassId}/course/${target.key}`, on
        ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doneOn }) }
        : { method: 'DELETE' });
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function changePace(value: number) {
    if (!activeClassId || value < 1 || value > 10) return;
    await customFetch(`/api/classes/${activeClassId}/course-pace/${book!.bookId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonsPerWeek: value }) }).catch(() => {});
    reload();
  }

  return (
    <section className="course">
      {!lesson && <div className="course-head">
        <div>
          <div className="eyebrow">{t(language, 'Darslik bo‘yicha', 'По учебнику', 'By the textbook')} · {t(language, `${grade}-sinf`, `${grade} класс`, `Grade ${grade}`)}</div>
          <h1>{t(language, 'Dars mavzulari', 'Темы уроков', 'Lesson topics')}</h1>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isTeacher && classes.length > 1 && (
            <Select className="input" value={classId ?? ''} onChange={(event) => setClassId(event.target.value)} style={{ maxWidth: 160 }} aria-label={t(language, 'Sinf', 'Класс', 'Class')}>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
          {isTeacher && grades.length > 1 && (
            <Select className="input" value={grade} onChange={(event) => setGrade(Number(event.target.value))} style={{ maxWidth: 160 }}>
              {grades.map((g) => <option key={g} value={g}>{t(language, `${g}-sinf`, `${g} класс`, `Grade ${g}`)}</option>)}
            </Select>
          )}
        </div>
      </div>}

      {!lesson && <div className="course-subjects">
        {books.map((item) => (
          <button type="button" key={item.id} className={`studio-tab ${item.id === book.id ? 'active' : ''}`} onClick={() => { picked.current = false; setShowAll(false); setBookId(item.id); setTopicKey(item.topics[0]?.key ?? ''); }}>
            <span>●</span>{subjectName(item.subject)}
          </button>
        ))}
      </div>}

      {course && !lesson && (
        <section className="panel course-plan">
          <div className="course-plan-main">
            <span className="course-plan-icon"><CalendarCheck2 size={20} /></span>
            <div>
              <b>{nextTopic && lastIndex < 0
                ? t(language, `Bugungi mavzu: §${nextTopic.code}`, `Тема урока: §${nextTopic.code}`, `Lesson topic: §${nextTopic.code}`)
                : nextTopic
                ? t(language, `Sinf to‘xtagan joy: §${book.topics[lastIndex]?.code ?? '—'} · keyingisi §${nextTopic.code}`, `Класс остановился на §${book.topics[lastIndex]?.code ?? '—'} · дальше §${nextTopic.code}`, `Class stopped at §${book.topics[lastIndex]?.code ?? '—'} · next §${nextTopic.code}`)
                : t(language, 'Kitob to‘liq o‘tildi', 'Книга пройдена полностью', 'The book is finished')}</b>
              <span className="muted">{t(language, `O‘tildi ${covered.length} / ${book.topics.length} mavzu`, `Пройдено ${covered.length} из ${book.topics.length} тем`, `${covered.length} of ${book.topics.length} topics covered`)}{covered.length ? ` · ${t(language, 'oxirgisi', 'последняя', 'last')} ${markDate(book.topics[lastIndex]?.key ?? '')}` : ''}</span>
            </div>
          </div>
          <div className="test-progress"><span style={{ width: `${(covered.length / book.topics.length) * 100}%` }} /></div>
          {remaining > 0 && (
            <p className={`muted course-forecast ${finish > yearEnd ? 'warn' : ''}`}>
              {t(language,
                `${quarter[0]}-chorak oxiri (${fmt(quarter[2])}): §${book.topics[Math.max(0, byQuarterEnd - 1)]?.code} · kitob tugashi: ${finish > yearEnd ? 'o‘quv yilida ulgurmaydi' : fmt(finish)}`,
                `К концу ${quarter[0]}-й четверти (${fmt(quarter[2])}): §${book.topics[Math.max(0, byQuarterEnd - 1)]?.code} · книга закончится: ${finish > yearEnd ? 'не успеет до конца года' : fmt(finish)}`,
                `End of term ${quarter[0]} (${fmt(quarter[2])}): §${book.topics[Math.max(0, byQuarterEnd - 1)]?.code} · book finishes: ${finish > yearEnd ? 'not this school year' : fmt(finish)}`)}
              {' · '}{t(language, `haftasiga ${pace} dars`, `${pace} урока в неделю`, `${pace} lessons a week`)}
              {course?.canEdit && <span className="course-pace-btns"><button type="button" className="btn small" onClick={() => void changePace(pace - 1)} aria-label="−">−</button><button type="button" className="btn small" onClick={() => void changePace(pace + 1)} aria-label="+">+</button></span>}
            </p>
          )}
        </section>
      )}

      <div className={`course-layout ${lesson ? 'is-lesson' : ''}`}>
        {!lesson && <aside className="panel course-nav">
          {!showAll && (
            <div className="course-chapter">
              <small>{t(language, 'Bugungi mavzu', 'Сегодняшняя тема', 'Today’s topic')}</small>
              <button type="button" className="course-topic active is-next">
                <span className="course-code">§{topic.code}</span>
                <span className="course-name">{topic.title}</span>
                <ChevronRight size={15} />
              </button>
              {!lesson && <button type="button" className="btn small course-all-btn" onClick={() => setShowAll(true)}>{t(language, `Kitobning barcha mavzulari · ${book.topics.length}`, `Все темы книги · ${book.topics.length}`, `All topics of the book · ${book.topics.length}`)}</button>}
            </div>
          )}
          {showAll && <button type="button" className="btn small course-all-btn" onClick={() => setShowAll(false)}>{t(language, 'Faqat bugungi mavzu', 'Только сегодняшняя тема', 'Only today’s topic')}</button>}
          {showAll && chapters.map((chapter) => (
            <div key={chapter} className="course-chapter">
              <small>{chapter}</small>
              {book.topics.filter((item) => item.chapter === chapter).map((item) => (
                <button type="button" key={item.key} className={`course-topic ${item.key === topic.key ? 'active' : ''} ${marks.has(item.key) ? 'covered' : ''} ${item.key === nextTopic?.key ? 'is-next' : ''}`} onClick={() => { chooseTopic(item.key); setShowAll(false); }}>
                  <span className="course-code">§{item.code}</span>
                  <span className="course-name">{item.title}{marks.has(item.key) && <small className="course-date">{t(language, 'Sinfda', 'В классе', 'In class')} · {markDate(item.key)}</small>}</span>
                  {studied.includes(item.key) ? <CheckCircle2 size={15} className="course-done" /> : marks.has(item.key) ? <Users size={14} className="course-done" /> : <ChevronRight size={15} />}
                </button>
              ))}
            </div>
          ))}
          {isStudent && (
            <p className="muted course-lock"><Lock size={13} /> {t(language, 'Faqat o‘z sinfingiz darsliklari ochiq.', 'Открыты только учебники вашего класса.', 'Only your grade’s textbooks are open.')}</p>
          )}
        </aside>}

        <article className="course-topic-view" key={topic.key}>
          {!lesson && <header className="course-hero">
            {!lesson && <div>
              <div className="eyebrow">§{topic.code} · {topic.chapter}</div>
              <h2>{topic.title}</h2>
              {marks.has(topic.key) && <span className="tag green"><Users size={12} /> {t(language, `Sinfda o‘tildi: ${markDate(topic.key)}`, `Пройдено в классе: ${markDate(topic.key)}`, `Covered in class: ${markDate(topic.key)}`)}</span>}
            </div>}
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {pdfPage && <button type="button" className="btn" onClick={() => { try { localStorage.setItem(`eduverse:pdf-page:/books/${book.bookId}.pdf`, String(pdfPage)); localStorage.setItem(`eduverse:pdf-range:/books/${book.bookId}.pdf`, `${pdfPage}-${topicEndPage(book, topic, pdfPage)}`); } catch { /* private mode */ } onOpen(`/read/${book.bookId}`); }}><BookOpen size={15} /> {lesson ? t(language, 'Darslik', 'Учебник', 'Textbook') : t(language, `Darslikda ochish · ${topic.page}-bet`, `Открыть в учебнике · стр. ${topic.page}`, `Open in textbook · p. ${topic.page}`)}</button>}
              {isTeacher && !lesson && <button type="button" className="btn primary" onClick={() => onOpen(`/lesson/course:${topic.key}`)}><MonitorPlay size={15} /> {t(language, 'Shu mavzuda dars', 'Урок по этой теме', 'Lesson on this topic')}</button>}
            </div>
          </header>}

          {isTeacher && course?.canEdit && !lesson && (
            <section className="panel course-mark">
              <GraduationCap size={18} />
              <span>{marks.has(topic.key) ? t(language, 'Mavzu sinfda o‘tilgan deb belgilangan.', 'Тема отмечена как пройденная в классе.', 'Marked as covered in class.') : t(language, 'Mavzu dars tugagach o‘zi belgilanadi.', 'Тема отметится сама после урока.', 'Marked by itself after the lesson.')}</span>
              {!lesson && <DateField className="input" type="date" value={doneOn} onChange={(event) => setDoneOn(event.target.value)} aria-label={t(language, 'Sana', 'Дата', 'Date')} />}
              {marks.has(topic.key)
                ? <button type="button" className="btn small" disabled={busy} onClick={() => void mark(topic, false)}>{t(language, 'Belgini olib tashlash', 'Снять отметку', 'Remove mark')}</button>
                : <button type="button" className="btn small primary" disabled={busy} onClick={() => void mark(topic, true)}><CheckCircle2 size={14} /> {t(language, 'Darsda o‘tdik', 'Прошли на уроке', 'Covered in class')}</button>}
            </section>
          )}


          {lesson && <LessonStages user={user} school={school} book={book} topic={topic} classId={activeClassId} language={language} onOpen={onOpen} onFinished={reload} actions={lessonActions} />}

          {!lesson && <>
          <section className="panel course-essence" id="step-topic">
            <h3><Lightbulb size={17} /> {t(language, 'Asosiysi', 'Главное', 'The main idea')}</h3>
            {topic.hook && <p className="course-hook">❓ {topic.hook}</p>}
            <TopicEssence topic={topic} language={language} />
            <TopicExtras topic={topic} subject={book.subject} language={language} />
          </section>

          <section className="course-3d" id="step-3d">
            <div className="course-3d-head">
              <h3><Box size={17} /> {t(language, '3D da o‘rganing', 'Изучите в 3D', 'Explore in 3D')}</h3>
              <p className="muted">{topic.sceneHint}</p>
            </div>
            <div className="course-3d-body">
              <CourseScene3D scene={topic.scene} language={language} />
            </div>
          </section>

          <section className="panel course-check" id="step-check">
            <h3><NotebookPen size={17} /> {t(language, 'Topshiriqlar', 'Задания', 'Tasks')} {topic.fromBook && <span className="tag gold">{t(language, 'darslikdan', 'из учебника', 'from the textbook')}</span>}</h3>
            <ol className="course-tasks">
              {topic.tasks.map((task, index) => (
                <li key={index}>
                  <p>{task.q}</p>
                  {openAnswers[index]
                    ? <div className="course-answer">{task.a}</div>
                    : <button type="button" className="btn small" onClick={() => setOpenAnswers((current) => ({ ...current, [index]: true }))}>{t(language, 'Javobni tekshirish', 'Проверить ответ', 'Check the answer')}</button>}
                </li>
              ))}
            </ol>
          </section>

          <section className="panel course-homework">
            <h3>{t(language, 'Uy vazifasi', 'Домашнее задание', 'Homework')}</h3>
            <p>{topic.homework}</p>
            {isStudent && <button type="button" className="btn" onClick={() => onOpen('/classes')}><NotebookPen size={15} /> {t(language, 'Daftar rasmini yuborish', 'Отправить фото тетради', 'Send a notebook photo')}</button>}
          </section>
          </>}

          <div className="course-footer">
            {isStudent && !lesson && <button type="button" className={`btn ${isStudied ? '' : 'primary'}`} onClick={() => setStudied((current) => current.includes(topic.key) ? current.filter((key) => key !== topic.key) : [...current, topic.key])}>
              <CheckCircle2 size={15} /> {isStudied ? t(language, 'O‘rganildi ✓', 'Изучено ✓', 'Studied ✓') : t(language, 'Mavzuni o‘rgandim', 'Я изучил тему', 'I studied this topic')}
            </button>}
            {(() => {
              const index = book.topics.findIndex((item) => item.key === topic.key);
              const next = book.topics[index + 1];
              return next && !lesson ? <button type="button" className="btn" onClick={() => chooseTopic(next.key)}>{t(language, 'Keyingi mavzu', 'Следующая тема', 'Next topic')}: §{next.code} <ChevronRight size={15} /></button> : null;
            })()}
          </div>
        </article>
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><BookOpen /></span>
      <h2>{text}</h2>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3D studio: our own models per subject                                       */
/* -------------------------------------------------------------------------- */

type GalleryItem = [OwnSceneId, string | undefined, [string, string, string]];
export const GALLERY: Record<'chem' | 'phys' | 'math' | 'bio' | 'geo', GalleryItem[]> = {
  chem: [
    ['particles', 'states', ['Moddaning holatlari', 'Состояния вещества', 'States of matter']],
    ['particles', 'atoms', ['Atom va molekula', 'Атомы и молекулы', 'Atoms and molecules']],
    ['mixtures', 'mix', ['Aralashmalar', 'Смеси', 'Mixtures']],
    ['mixtures', 'separate', ['Ajratish usullari', 'Разделение смесей', 'Separating mixtures']],
    ['ph', 'scale', ['Kislota va ishqor', 'Кислоты и щёлочи', 'Acids and bases']],
  ],
  phys: [
    ['motion', 'speed', ['Harakat va tezlik', 'Движение и скорость', 'Motion and speed']],
    ['forces', 'arrows', ['Kuchlar', 'Силы', 'Forces']],
    ['forces', 'friction', ['Ishqalanish', 'Трение', 'Friction']],
    ['measure', 'length', ['O‘lchash', 'Измерения', 'Measuring']],
    ['lab', 'equipment', ['Laboratoriya asboblari', 'Лабораторные приборы', 'Lab equipment']],
  ],
  math: [
    ['geometry', 'triangle', ['Geometriya', 'Геометрия', 'Geometry']],
    ['factors', 'gcd', ['Bo‘luvchilar', 'Делители', 'Divisors']],
    ['numberline', 'integers', ['Sonlar o‘qi', 'Числовая прямая', 'Number line']],
    ['balance', 'equation', ['Tenglama tarozisi', 'Весы уравнения', 'Equation balance']],
  ],
  bio: [
    ['cell', 'animal', ['Hujayra', 'Клетка', 'Cell']],
    ['body', 'skeleton', ['Inson tanasi', 'Тело человека', 'Human body']],
    ['leaf', 'light', ['Barg va fotosintez', 'Лист и фотосинтез', 'Leaf and photosynthesis']],
    ['microbes', 'types', ['Mikroblar', 'Микробы', 'Microbes']],
    ['foodweb', 'web', ['Oziq zanjiri', 'Пищевая цепь', 'Food web']],
    ['classify', 'kingdoms', ['Tirik olam', 'Царства живого', 'Kingdoms of life']],
  ],
  geo: [
    ['solar', 'system', ['Quyosh tizimi', 'Солнечная система', 'Solar system']],
  ],
};

/** Our own 3D models of a subject: pick one, rotate it, change it. */
export function StudioGallery({ subject, language }: { subject: keyof typeof GALLERY; language: Language }) {
  const items = GALLERY[subject];
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [subject]);
  const item = items[index] ?? items[0]!;
  return (
    <section className="panel studio-gallery">
      {items.length > 1 && <div className="chem-presets">
        {items.map(([scene, mode, label], at) => (
          <button type="button" key={`${scene}:${mode}`} className={`tag ${at === index ? 'gold' : ''}`} onClick={() => setIndex(at)}>{t(language, ...label)}</button>
        ))}
      </div>}
      <CourseScene3D key={`${item[0]}:${item[1]}`} scene={{ kind: 'own', scene: item[0], mode: item[1] }} language={language} />
    </section>
  );
}


/** The main idea: the first two points large and clear; the rest only when asked for. */
function TopicEssence({ topic, language }: { topic: CourseTopic; language: Language }) {
  const points = keyPoints(topic);
  const [all, setAll] = useState(false);
  // One short sentence first: long text is boring and hard to read on a tablet.
  const short = (text: string) => { const first = text.split(/(?<=[.!?])\s/)[0] ?? text; return first.length > 140 ? `${first.slice(0, first.lastIndexOf(' ', 130))}…` : first; };
  const shown = all ? (points.length ? points : [topic.essence]) : [short(points[0] ?? topic.essence)];
  return (
    <>
      <ul className="course-points-short">{shown.map((point, index) => <li key={index}>{point}</li>)}</ul>
      {(points.length > 1 || topic.essence.length > 140) && <button type="button" className="btn small" onClick={() => setAll((value) => !value)}>👁 {all ? t(language, 'Qisqaroq', 'Короче', 'Shorter') : t(language, 'Batafsil', 'Подробнее', 'More')}</button>}
    </>
  );
}

const SOLVE_TIPS: Record<CourseBook['subject'], [string, string, string][]> = {
  math: [
    ['Nima berilgan va nimani topish kerak — yozing.', 'Запишите: что дано и что найти.', 'Write what is given and what to find.'],
    ['Chizma yoki jadval chizing.', 'Нарисуйте схему или таблицу.', 'Draw a sketch or a table.'],
    ['Qadamma-qadam yeching.', 'Решайте по шагам.', 'Solve step by step.'],
    ['Javobni qo‘yib tekshiring.', 'Проверьте ответ подстановкой.', 'Check the answer by putting it back.'],
  ],
  physics: [
    ['Kattaliklarni birliklari bilan yozing.', 'Выпишите величины с единицами.', 'Write the quantities with units.'],
    ['SI birliklariga o‘tkazing (sm → m, g → kg).', 'Переведите в СИ (см → м, г → кг).', 'Convert to SI (cm → m, g → kg).'],
    ['Kerakli formulani tanlang.', 'Выберите нужную формулу.', 'Pick the right formula.'],
    ['Sonlarni qo‘ying va birlikni tekshiring.', 'Подставьте числа и проверьте единицы.', 'Put in the numbers and check the units.'],
  ],
  chemistry: [
    ['Moddalarning formulalarini yozing.', 'Запишите формулы веществ.', 'Write the formulas of the substances.'],
    ['Chap va o‘ngdagi atomlarni sanang.', 'Посчитайте атомы слева и справа.', 'Count the atoms on both sides.'],
    ['Koeffitsiyentlar bilan tenglang.', 'Уравняйте коэффициентами.', 'Balance with coefficients.'],
    ['Tekshiring: atomlar soni teng.', 'Проверьте: атомов поровну.', 'Check: the atoms are equal.'],
  ],
  biology: [
    ['Mavzuning asosiy so‘zini toping.', 'Найдите главное слово темы.', 'Find the key word of the topic.'],
    ['Sxema chizing: nima nimadan iborat.', 'Нарисуйте схему: что из чего состоит.', 'Draw a scheme: what is made of what.'],
    ['Hayotdan misol bilan bog‘lang.', 'Свяжите с примером из жизни.', 'Link it to an everyday example.'],
    ['3 ta gap bilan aytib bering.', 'Перескажите тремя предложениями.', 'Retell it in three sentences.'],
  ],
};

/** Closed extras behind 👁 buttons: fun facts, how to solve it easily, an everyday example, a word explained. */
function TopicExtras({ topic, subject, language }: { topic: CourseTopic; subject: CourseBook['subject']; language: Language }) {
  const [open, setOpen] = useState<'' | 'facts' | 'tips' | 'life' | 'word'>('');
  const toggle = (key: typeof open) => setOpen((current) => (current === key ? '' : key));
  return (
    <div className="topic-extras">
      <div className="topic-extras-buttons">
        {topic.facts.length > 0 && <button type="button" className={`btn small ${open === 'facts' ? 'primary' : ''}`} onClick={() => toggle('facts')}>👁 {t(language, 'Qiziqarli faktlar', 'Интересные факты', 'Fun facts')}</button>}
        <button type="button" className={`btn small ${open === 'tips' ? 'primary' : ''}`} onClick={() => toggle('tips')}>👁 {t(language, 'Qanday oson yechish', 'Как решать легко', 'How to solve it easily')}</button>
        <button type="button" className={`btn small ${open === 'life' ? 'primary' : ''}`} onClick={() => toggle('life')}>👁 {t(language, 'Hayotda', 'Пример из жизни', 'In real life')}</button>
        <button type="button" className={`btn small ${open === 'word' ? 'primary' : ''}`} onClick={() => toggle('word')}>💬 {t(language, 'So‘zni tushunmadim', 'Не понял слово', 'I don’t get a word')}</button>
      </div>
      {open === 'facts' && <ul className="topic-extras-panel">{topic.facts.map((fact, index) => <li key={index}>✨ {fact}</li>)}</ul>}
      {open === 'tips' && <ol className="topic-extras-panel">{SOLVE_TIPS[subject].map((tip, index) => <li key={index}>{t(language, ...tip)}</li>)}</ol>}
      {open === 'life' && <p className="topic-extras-panel">🌍 {topic.life}</p>}
      {open === 'word' && <ExplainWord topicKey={topic.key} language={language} />}
    </div>
  );
}

/** "I don't understand this word": a very simple explanation from the helper. */
function ExplainWord({ topicKey, language }: { topicKey: string; language: Language }) {
  const [word, setWord] = useState('');
  const [answer, setAnswer] = useState<{ word: string; simple: string; example: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (word.trim().length < 2 || busy) return;
    setBusy(true); setError(''); setAnswer(null);
    try {
      const lang = language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru';
      setAnswer(await customFetch<{ word: string; simple: string; example: string }>('/api/ai/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: word.trim(), topicKey, lang }) }));
    } catch {
      setError(t(language, 'Hozir javob berib bo‘lmadi. Bir daqiqadan so‘ng urinib ko‘ring.', 'Сейчас не получилось. Попробуйте через минуту.', 'It did not work now. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="topic-extras-panel explain-word">
      <form className="explain-word-form" onSubmit={ask}>
        <input className="input" value={word} maxLength={60} onChange={(event) => setWord(event.target.value)} placeholder={t(language, 'Masalan: hajm', 'Например: объём', 'For example: volume')} />
        <button type="submit" className="btn primary" disabled={busy || word.trim().length < 2}>{busy ? '…' : t(language, 'Tushuntir', 'Объясни', 'Explain')}</button>
      </form>
      {busy && <LoadingBlock language={language} kind="inline" />}
      {answer && <div className="explain-word-answer"><b>{answer.word}</b><p>{answer.simple}</p>{answer.example && <p className="muted">🌍 {answer.example}</p>}</div>}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
