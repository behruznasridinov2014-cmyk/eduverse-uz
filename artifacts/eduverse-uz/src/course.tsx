import './scenes.css';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import type { User } from '@workspace/api-client-react';
import { customFetch } from '@workspace/api-client-react';
import { BookOpen, Box, CalendarCheck2, CheckCircle2, ChevronRight, GraduationCap, Lightbulb, Lock, MonitorPlay, NotebookPen, Sparkles, Target, Users } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { COURSE, SUBJECT_LABEL, pdfPageOf, type CourseBook, type CourseScene, type CourseTopic } from './course-data';
import type { OwnSceneId } from './course-scenes';
import { MoleculeById, ReactionView } from './chem-lab';
import { Circuit, Pendulum } from './physics-lab';
import { CollisionLab } from './collision-lab';
import { MathLab } from './studio-labs';

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

/** The 3D part of a textbook topic. Every scene is ours and can be operated by the student. */
export function CourseScene3D({ scene, language }: { scene: CourseScene; language: Language }) {
  switch (scene.kind) {
    case 'own': {
      const Scene = OWN[scene.scene];
      return <Suspense fallback={<div className="panel chem-stage scene-loading" />}><Scene key={`${scene.scene}:${scene.mode ?? ''}`} mode={scene.mode} /></Suspense>;
    }
    case 'molecule': return <MoleculeById id={scene.id} language={language} />;
    case 'reaction': return <ReactionView a={scene.a} b={scene.b} language={language} />;
    case 'pendulum': return <Pendulum language={language} />;
    case 'circuit': return <Circuit language={language} />;
    case 'collision': return <CollisionLab language={language} />;
    case 'solid': return <MathLab language={language} initial={scene.solid} />;
  }
}

const studiedKey = (userId: string) => `eduverse:studied:${userId}`;

/* ------------------------------------------------------------------ */
/* School calendar and finish forecast                                  */
/* ------------------------------------------------------------------ */

const DAY = 24 * 3600 * 1000;
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** Quarters of the school year (approximate Uzbek calendar), starting in September of `year`. */
function quarters(year: number): Array<[number, Date, Date]> {
  return [
    [1, new Date(year, 8, 2), new Date(year, 9, 31)],
    [2, new Date(year, 10, 9), new Date(year, 11, 27)],
    [3, new Date(year + 1, 0, 12), new Date(year + 1, 2, 20)],
    [4, new Date(year + 1, 2, 30), new Date(year + 1, 4, 25)],
  ];
}
const schoolYearOf = (date: Date) => (date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1);
/** School weeks between two dates (holidays between quarters are skipped). */
function schoolWeeks(from: Date, to: Date): number {
  let days = 0;
  for (const [, start, end] of [...quarters(schoolYearOf(from)), ...quarters(schoolYearOf(from) + 1)]) {
    const a = Math.max(start.getTime(), from.getTime());
    const b = Math.min(end.getTime(), to.getTime());
    if (b > a) days += (b - a) / DAY;
  }
  return days / 7;
}
/** Date after `weeks` school weeks from `from`, skipping holidays. */
function addSchoolWeeks(from: Date, weeks: number): Date {
  let left = weeks * 7 * DAY;
  for (const [, start, end] of [...quarters(schoolYearOf(from)), ...quarters(schoolYearOf(from) + 1)]) {
    const a = Math.max(start.getTime(), from.getTime());
    if (end.getTime() <= a) continue;
    const span = end.getTime() - a;
    if (left <= span) return new Date(a + left);
    left -= span;
  }
  return new Date(from.getTime() + weeks * 7 * DAY);
}

type ClassCourse = { progress: Array<{ topicKey: string; doneOn: string }>; pace: Array<{ book: string; lessonsPerWeek: number }>; canEdit: boolean };

function useClassCourse(classId: string | null) {
  const [data, setData] = useState<ClassCourse | null>(null);
  const load = useCallback(() => {
    if (!classId) { setData(null); return; }
    void customFetch<ClassCourse>(`/api/classes/${classId}/course`, { method: 'GET' }).then(setData).catch(() => setData(null));
  }, [classId]);
  useEffect(() => { load(); }, [load]);
  return [data, load] as const;
}

export function CoursePage({ user, school, language, onOpen }: { user: User; school: SchoolData; language: Language; onOpen: (path: string) => void }) {
  const isStudent = user.role === 'student';
  const isTeacher = !isStudent;
  const grades = useMemo(() => [...new Set(COURSE.map((book) => book.grade))].sort((a, b) => a - b), []);
  const studentGrade = school.classes[0]?.grade ?? null;
  const [grade, setGrade] = useState<number>(isStudent ? studentGrade ?? 0 : grades[0] ?? 7);
  useEffect(() => {
    if (isStudent && studentGrade) setGrade(studentGrade);
  }, [isStudent, studentGrade]);

  // A student only studies the books of their own grade — not the next years.
  const books = COURSE.filter((book) => book.grade === grade);
  const [bookId, setBookId] = useState<string>(books[0]?.id ?? '');
  const book: CourseBook | undefined = books.find((item) => item.id === bookId) ?? books[0];
  const [topicKey, setTopicKey] = useState<string>(book?.topics[0]?.key ?? '');
  const topic: CourseTopic | undefined = book?.topics.find((item) => item.key === topicKey) ?? book?.topics[0];
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});
  const [studied, setStudied] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(studiedKey(user.id)) ?? '[]') as string[]; } catch { return []; }
  });
  const classes = school.classes.filter((item) => !item.grade || item.grade === grade);
  const savedClass = (() => { try { return localStorage.getItem('eduverse:course-class'); } catch { return null; } })();
  const [classId, setClassIdState] = useState<string | null>(classes.find((item) => item.id === savedClass)?.id ?? classes[0]?.id ?? null);
  const setClassId = (id: string | null) => { setClassIdState(id); try { if (id) localStorage.setItem('eduverse:course-class', id); } catch { /* private mode */ } };
  useEffect(() => { if (!classId || !classes.some((item) => item.id === classId)) setClassIdState(classes.find((item) => item.id === savedClass)?.id ?? classes[0]?.id ?? null); }, [classes, classId, savedClass]);
  const [course, reload] = useClassCourse(classId);
  const [doneOn, setDoneOn] = useState(() => iso(new Date()));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(studiedKey(user.id), JSON.stringify(studied)); } catch { /* private mode */ }
  }, [studied, user.id]);
  useEffect(() => { setOpenAnswers({}); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }, [topicKey]);
  useEffect(() => { if (book && !book.topics.some((item) => item.key === topicKey)) setTopicKey(book.topics[0]?.key ?? ''); }, [book, topicKey]);

  if (isStudent && school.status === 'ready' && !studentGrade) {
    return <Empty text={t(language, 'Sizni hali sinfga qo‘shishmagan. O‘qituvchidan so‘rang.', 'Вас ещё не добавили в класс. Попросите учителя.', 'You are not in a class yet. Ask your teacher.')} />;
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
  const quarter = quarters(year).find(([, start, end]) => today >= start && today <= new Date(end.getTime() + DAY)) ?? quarters(year).find(([, start]) => today < start) ?? quarters(year)[3];
  const remaining = book.topics.length - covered.length;
  const weeksLeft = remaining / Math.max(1, pace);
  const finish = addSchoolWeeks(today, weeksLeft);
  const yearEnd = quarters(year)[3][2];
  const planned = Math.min(book.topics.length, Math.round(schoolWeeks(quarters(year)[0][1], today) * pace));
  const gap = covered.length - planned;
  const byQuarterEnd = Math.min(book.topics.length, covered.length + Math.round(schoolWeeks(today, quarter[2]) * pace));
  const MONTHS: Record<Language, string[]> = {
    Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    'Русский': ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    English: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  };
  const fmt = (date: Date) => `${date.getDate()} ${MONTHS[language][date.getMonth()]}`;
  const markDate = (key: string) => { const raw = marks.get(key); return raw ? fmt(new Date(`${raw}T12:00:00`)) : ''; };

  async function mark(target: CourseTopic, on: boolean) {
    if (!classId) return;
    setBusy(true);
    try {
      await customFetch(`/api/classes/${classId}/course/${target.key}`, on
        ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doneOn }) }
        : { method: 'DELETE' });
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function changePace(value: number) {
    if (!classId || value < 1 || value > 10) return;
    await customFetch(`/api/classes/${classId}/course-pace/${book!.bookId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonsPerWeek: value }) }).catch(() => {});
    reload();
  }

  return (
    <section className="course">
      <div className="course-head">
        <div>
          <div className="eyebrow">{t(language, 'Darslik bo‘yicha', 'По учебнику', 'By the textbook')} · {t(language, `${grade}-sinf`, `${grade} класс`, `Grade ${grade}`)}</div>
          <h1>{t(language, 'Dars mavzulari', 'Темы уроков', 'Lesson topics')}</h1>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isTeacher && classes.length > 1 && (
            <select className="input" value={classId ?? ''} onChange={(event) => setClassId(event.target.value)} style={{ maxWidth: 160 }} aria-label={t(language, 'Sinf', 'Класс', 'Class')}>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          {isTeacher && grades.length > 1 && (
            <select className="input" value={grade} onChange={(event) => setGrade(Number(event.target.value))} style={{ maxWidth: 160 }}>
              {grades.map((g) => <option key={g} value={g}>{t(language, `${g}-sinf`, `${g} класс`, `Grade ${g}`)}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="course-subjects">
        {books.map((item) => (
          <button type="button" key={item.id} className={`studio-tab ${item.id === book.id ? 'active' : ''}`} onClick={() => { setBookId(item.id); setTopicKey(item.topics[0]?.key ?? ''); }}>
            <span>●</span>{subjectName(item.subject)}
          </button>
        ))}
      </div>

      {course && (
        <section className="panel course-plan">
          <div className="course-plan-main">
            <span className="course-plan-icon"><CalendarCheck2 size={20} /></span>
            <div>
              <b>{nextTopic
                ? t(language, `Sinf to‘xtagan joy: §${book.topics[lastIndex]?.code ?? '—'} · keyingisi §${nextTopic.code}`, `Класс остановился на §${book.topics[lastIndex]?.code ?? '—'} · дальше §${nextTopic.code}`, `Class stopped at §${book.topics[lastIndex]?.code ?? '—'} · next §${nextTopic.code}`)
                : t(language, 'Kitob to‘liq o‘tildi', 'Книга пройдена полностью', 'The book is finished')}</b>
              <span className="muted">{t(language, `O‘tildi ${covered.length} / ${book.topics.length} mavzu`, `Пройдено ${covered.length} из ${book.topics.length} тем`, `${covered.length} of ${book.topics.length} topics covered`)}{covered.length ? ` · ${t(language, 'oxirgisi', 'последняя', 'last')} ${markDate(book.topics[lastIndex]?.key ?? '')}` : ''}</span>
            </div>
          </div>
          <div className="test-progress"><span style={{ width: `${(covered.length / book.topics.length) * 100}%` }} /></div>
        </section>
      )}

      <div className="course-layout">
        <aside className="panel course-nav">
          {chapters.map((chapter) => (
            <div key={chapter} className="course-chapter">
              <small>{chapter}</small>
              {book.topics.filter((item) => item.chapter === chapter).map((item) => (
                <button type="button" key={item.key} className={`course-topic ${item.key === topic.key ? 'active' : ''} ${marks.has(item.key) ? 'covered' : ''} ${item.key === nextTopic?.key ? 'is-next' : ''}`} onClick={() => setTopicKey(item.key)}>
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
        </aside>

        <article className="course-topic-view" key={topic.key}>
          <header className="course-hero">
            <div>
              <div className="eyebrow">§{topic.code} · {topic.chapter}</div>
              <h2>{topic.title}</h2>
              {marks.has(topic.key) && <span className="tag green"><Users size={12} /> {t(language, `Sinfda o‘tildi: ${markDate(topic.key)}`, `Пройдено в классе: ${markDate(topic.key)}`, `Covered in class: ${markDate(topic.key)}`)}</span>}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {pdfPage && <button type="button" className="btn" onClick={() => { try { localStorage.setItem(`eduverse:pdf-page:/books/${book.bookId}.pdf`, String(pdfPage)); } catch { /* private mode */ } onOpen(`/read/${book.bookId}`); }}><BookOpen size={15} /> {t(language, `Darslikda ochish · ${topic.page}-bet`, `Открыть в учебнике · стр. ${topic.page}`, `Open in textbook · p. ${topic.page}`)}</button>}
              {isTeacher && <button type="button" className="btn primary" onClick={() => onOpen(`/lesson/course:${topic.key}`)}><MonitorPlay size={15} /> {t(language, 'Shu mavzuda dars', 'Урок по этой теме', 'Lesson on this topic')}</button>}
            </div>
          </header>

          {isTeacher && course?.canEdit && (
            <section className="panel course-mark">
              <GraduationCap size={18} />
              <span>{marks.has(topic.key) ? t(language, 'Mavzu sinfda o‘tilgan deb belgilangan.', 'Тема отмечена как пройденная в классе.', 'Marked as covered in class.') : t(language, 'Darsdan keyin belgilang — o‘quvchilar va prognoz yangilanadi.', 'Отметьте после урока — ученики и прогноз обновятся.', 'Mark it after the lesson — students and the forecast update.')}</span>
              <input className="input" type="date" value={doneOn} onChange={(event) => setDoneOn(event.target.value)} aria-label={t(language, 'Sana', 'Дата', 'Date')} />
              {marks.has(topic.key)
                ? <button type="button" className="btn small" disabled={busy} onClick={() => void mark(topic, false)}>{t(language, 'Belgini olib tashlash', 'Снять отметку', 'Remove mark')}</button>
                : <button type="button" className="btn small primary" disabled={busy} onClick={() => void mark(topic, true)}><CheckCircle2 size={14} /> {t(language, 'Darsda o‘tdik', 'Прошли на уроке', 'Covered in class')}</button>}
            </section>
          )}


          <section className="panel course-essence">
            <h3><Lightbulb size={17} /> {t(language, 'Mohiyati', 'Суть темы', 'The essence')}</h3>
            {topic.hook && <p className="course-hook">{topic.hook}</p>}
            <p>{topic.essence}</p>
            <div className="course-life"><Target size={15} /> <span><b>{t(language, 'Hayotda:', 'В жизни:', 'In life:')}</b> {topic.life}</span></div>
          </section>

          <section className="course-3d">
            <div className="course-3d-head">
              <h3><Box size={17} /> {t(language, '3D da o‘rganing', 'Изучите в 3D', 'Explore in 3D')}</h3>
              <p className="muted">{topic.sceneHint}</p>
            </div>
            <CourseScene3D scene={topic.scene} language={language} />
          </section>


          <section className="panel">
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

          <div className="course-footer">
            <button type="button" className={`btn ${isStudied ? '' : 'primary'}`} onClick={() => setStudied((current) => current.includes(topic.key) ? current.filter((key) => key !== topic.key) : [...current, topic.key])}>
              <CheckCircle2 size={15} /> {isStudied ? t(language, 'O‘rganildi ✓', 'Изучено ✓', 'Studied ✓') : t(language, 'Mavzuni o‘rgandim', 'Я изучил тему', 'I studied this topic')}
            </button>
            {(() => {
              const index = book.topics.findIndex((item) => item.key === topic.key);
              const next = book.topics[index + 1];
              return next ? <button type="button" className="btn" onClick={() => setTopicKey(next.key)}>{t(language, 'Keyingi mavzu', 'Следующая тема', 'Next topic')}: §{next.code} <ChevronRight size={15} /></button> : null;
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
