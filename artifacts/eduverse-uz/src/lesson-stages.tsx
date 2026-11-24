import './lesson-stages.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createAssignment, customFetch, submitAssignment, type User } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Box, Camera, CheckCircle2, Clock3, ExternalLink, Flag, GripVertical, Highlighter,
  Lightbulb, MessageCircle, Minus, Play, Plus, RotateCcw, Send, Sparkles, Square, Target, Timer, Trophy, Volume2, X, XCircle, Zap,
} from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import type { CourseBook, CourseTopic } from './course-data';
import { pdfPageOf } from './course-data';
import { CourseScene3D, TopicBookPages } from './course';
import {
  STAGES, checkShortAnswer, findTheMistake, glossary, localHelp, matchingPairs, missionScenarios, orderingSteps, sentences, topicQuestions, trueFalse, tx,
  type Choice, type Scenario,
} from './lesson-engine';
import { PhotoPicker } from './homework';
import { friendlyError } from './errors';
import { LoadingBlock } from './ui/loading';
import { LessonBuilder, ClassProgressPanel, BoardControls, StudentBoard, useLive, type LessonContent } from './lesson-teacher';

/*
 * The seven-stage lesson of a textbook topic:
 *  1 mission · 2 textbook · 3 visual & 3D · 4 practice · 5 assessment · 6 reinforcement · 7 homework.
 * Every answer is saved for the pupil (and the teacher sees the class), the lesson helper
 * knows the topic, the stage and the pupil's mistakes, and the teacher can run the class board.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
const langCode = (language: Language) => (language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru');
const SUBJECT: Record<CourseBook['subject'], [string, string, string]> = {
  physics: ['Fizika', 'Физика', 'Physics'], chemistry: ['Kimyo', 'Химия', 'Chemistry'], biology: ['Biologiya', 'Биология', 'Biology'], math: ['Matematika', 'Математика', 'Mathematics'],
};
const WELCOME: Record<CourseBook['subject'], [string, string, string]> = {
  chemistry: ['Kimyo laboratoriyasiga xush kelibsiz!', 'Добро пожаловать в химическую лабораторию!', 'Welcome to the chemistry laboratory!'],
  physics: ['Fizika tajribaxonasiga xush kelibsiz!', 'Добро пожаловать в физическую лабораторию!', 'Welcome to the physics lab!'],
  biology: ['Tirik tabiat dunyosiga xush kelibsiz!', 'Добро пожаловать в мир живой природы!', 'Welcome to the world of living things!'],
  math: ['Matematik sirlar xonasiga xush kelibsiz!', 'Добро пожаловать в комнату математических загадок!', 'Welcome to the room of maths puzzles!'],
};

export type Answer = { id: string; ok: boolean; v?: string; q?: string };
export type StageResult = { stage: number; score: number; total: number; done: boolean; answers: Answer[]; attempts?: number };

function useLessonProgress(topicKey: string, classId: string | null, enabled: boolean) {
  const [stages, setStages] = useState<Record<number, StageResult>>({});
  const [loaded, setLoaded] = useState(!enabled);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoaded(false);
    customFetch<{ stages: StageResult[] }>(`/api/me/lesson-progress/${topicKey}`, { method: 'GET' })
      .then((response) => { if (alive) setStages(Object.fromEntries(response.stages.map((item) => [item.stage, item]))); })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [topicKey, enabled]);
  const save = useCallback(async (stage: number, result: Omit<StageResult, 'stage'>) => {
    setStages((current) => ({ ...current, [stage]: { ...result, stage, done: result.done || Boolean(current[stage]?.done) } }));
    if (!enabled) return;
    try {
      await customFetch(`/api/me/lesson-progress/${topicKey}/${stage}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...result, classId }) });
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [topicKey, classId, enabled]);
  return { stages, loaded, save, saveError };
}

function useLessonContent(topicKey: string, classId: string | null) {
  const [content, setContent] = useState<LessonContent | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    customFetch<{ content: LessonContent | null; author: string | null }>(`/api/lesson-content/${topicKey}${classId ? `?classId=${classId}` : ''}`, { method: 'GET' })
      .then((response) => { if (alive) { setContent(response.content); setAuthor(response.author); } })
      .catch(() => { if (alive) setContent(null); });
    return () => { alive = false; };
  }, [topicKey, classId, revision]);
  return { content, author, reload: () => setRevision((value) => value + 1) };
}

export function LessonStages({ user, school, book, topic, classId, language, onOpen }: {
  user: User; school: SchoolData; book: CourseBook; topic: CourseTopic; classId: string | null; language: Language; onOpen: (path: string) => void;
}) {
  const isStudent = user.role === 'student';
  const isTeacher = !isStudent && user.role !== 'parent';
  const progress = useLessonProgress(topic.key, classId, isStudent || isTeacher);
  const { content, author, reload } = useLessonContent(topic.key, classId);
  const live = useLive(classId, isStudent || isTeacher);
  const [stage, setStage] = useState(1);
  const [view, setView] = useState<'lesson' | 'builder' | 'class'>('lesson');
  const [follow, setFollow] = useState(true);
  const [helperOpen, setHelperOpen] = useState(false);
  const [helperSeed, setHelperSeed] = useState<{ action: string; question?: string } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const liveHere = live.state && live.state.topicKey === topic.key ? live.state : null;

  // The pupil follows the stage the teacher shows on the board (can be switched off).
  useEffect(() => { if (isStudent && follow && liveHere && liveHere.stage !== stage) setStage(liveHere.stage); }, [isStudent, follow, liveHere?.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: number) => {
    setStage(Math.max(1, Math.min(7, next)));
    if (isStudent && liveHere) setFollow(next === liveHere.stage);
    window.setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const minutes = STAGES.map((item, index) => content?.minutes?.[index] || item.minutes);
  const totalMinutes = minutes.reduce((sum, value) => sum + value, 0);
  const doneCount = STAGES.filter((item) => progress.stages[item.n]?.done).length;
  const mistakes = useMemo(() => Object.values(progress.stages).flatMap((item) => (item.answers ?? []).filter((answer) => !answer.ok && answer.q).map((answer) => answer.q!)).slice(0, 8), [progress.stages]);
  const ask = (action: string, question?: string) => { setHelperSeed({ action, question }); setHelperOpen(true); };
  const subject = t(language, ...SUBJECT[book.subject]);
  const props = { topic, book, language, save: progress.save, result: (n: number) => progress.stages[n], next: () => go(stage + 1), ask, content };

  return (
    <div className="ls" ref={top}>
      {isTeacher && (
        <div className="ls-teacher-tabs" role="tablist">
          {([['lesson', t(language, 'Dars', 'Урок', 'Lesson'), Play], ['builder', t(language, 'Dars konstruktori', 'Конструктор урока', 'Lesson builder'), Plus], ['class', t(language, 'Sinf natijalari', 'Результаты класса', 'Class results'), Target]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`studio-tab ${view === key ? 'active' : ''}`} onClick={() => setView(key)} disabled={key !== 'lesson' && !classId && key === 'class'}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {view === 'builder' && isTeacher && <LessonBuilder topic={topic} language={language} initial={content} onSaved={reload} />}
      {view === 'class' && isTeacher && classId && <ClassProgressPanel classId={classId} topic={topic} language={language} />}
      {view === 'lesson' && <>
        <nav className="ls-rail" aria-label={t(language, 'Dars bosqichlari', 'Этапы урока', 'Lesson stages')}>
          {STAGES.map((item) => {
            const result = progress.stages[item.n];
            return (
              <button key={item.n} type="button" className={`ls-rail-step ${stage === item.n ? 'on' : ''} ${result?.done ? 'done' : ''} ${liveHere?.stage === item.n ? 'live' : ''}`} onClick={() => go(item.n)} aria-current={stage === item.n ? 'step' : undefined}>
                <span className="ls-rail-num">{result?.done ? <CheckCircle2 size={15} /> : item.n}</span>
                <span className="ls-rail-text"><b>{tx(language, item.title)}</b><small>{minutes[item.n - 1]} {t(language, 'daq', 'мин', 'min')}</small></span>
              </button>
            );
          })}
        </nav>
        <div className="ls-meter">
          <div className="test-progress"><span style={{ width: `${(doneCount / 7) * 100}%` }} /></div>
          <span className="muted">{t(language, `${doneCount} / 7 bosqich`, `${doneCount} из 7 этапов`, `${doneCount} of 7 stages`)} · ~{totalMinutes} {t(language, 'daqiqa', 'мин', 'min')}{progress.saveError ? ` · ${t(language, 'saqlanmadi, internetni tekshiring', 'не сохранилось, проверьте интернет', 'not saved, check the internet')}` : ''}</span>
        </div>
        {isTeacher && classId && <BoardControls classId={classId} topic={topic} stage={stage} language={language} live={live} content={content} />}
        {isStudent && liveHere && <StudentBoard classId={classId!} state={liveHere} language={language} follow={follow} onFollow={() => { setFollow(true); setStage(liveHere.stage); }} onAnswered={live.refresh} />}
        {!progress.loaded ? <LoadingBlock language={language} /> : (
          <section className={`ls-stage ls-stage-${stage}`} key={stage}>
            <header className="ls-stage-head">
              <span className="eyebrow">{t(language, `${stage}-bosqich`, `Этап ${stage}`, `Stage ${stage}`)} · {tx(language, STAGES[stage - 1]!.goal)}</span>
              <h2>{tx(language, STAGES[stage - 1]!.title)}</h2>
            </header>
            {stage === 1 && <MissionStage {...props} subject={subject} welcome={t(language, ...WELCOME[book.subject])} totalMinutes={totalMinutes} />}
            {stage === 2 && <BookStage {...props} />}
            {stage === 3 && <VisualStage {...props} />}
            {stage === 4 && <PracticeStage {...props} />}
            {stage === 5 && <TestStage {...props} goTo={go} />}
            {stage === 6 && <ChallengeStage {...props} stages={progress.stages} />}
            {stage === 7 && <HomeworkStage {...props} user={user} school={school} classId={classId} isTeacher={isTeacher} stages={progress.stages} onOpen={onOpen} />}
            <footer className="ls-stage-nav">
              <button type="button" className="btn" disabled={stage === 1} onClick={() => go(stage - 1)}><ArrowLeft size={15} /> {t(language, 'Oldingi', 'Назад', 'Back')}</button>
              {stage < 7 && <button type="button" className="btn primary" onClick={() => go(stage + 1)}>{t(language, 'Keyingi bosqich', 'Следующий этап', 'Next stage')}: {tx(language, STAGES[stage]!.title)} <ArrowRight size={15} /></button>}
            </footer>
          </section>
        )}
        {author && content && !isTeacher && <p className="muted ls-author">{t(language, `O‘qituvchi qo‘shgan materiallar: ${author}`, `Материалы учителя: ${author}`, `Teacher’s materials: ${author}`)}</p>}
      </>}
      <button type="button" className="ls-helper-fab" onClick={() => { setHelperSeed(null); setHelperOpen((value) => !value); }} aria-expanded={helperOpen}>
        <MessageCircle size={18} /> <span>{t(language, 'Yordamchi', 'Помощник', 'Helper')}</span>
      </button>
      {helperOpen && <LessonHelper topic={topic} language={language} stageName={tx(language, STAGES[stage - 1]!.title)} mistakes={mistakes} seed={helperSeed} onClose={() => setHelperOpen(false)} />}
    </div>
  );
}

type StageProps = {
  topic: CourseTopic; book: CourseBook; language: Language; content: LessonContent | null;
  save: (stage: number, result: Omit<StageResult, 'stage'>) => Promise<void>;
  result: (stage: number) => StageResult | undefined;
  next: () => void;
  ask: (action: string, question?: string) => void;
};

/* ------------------------------------------------------------------ */
/* One multiple-choice card with instant feedback and retry             */
/* ------------------------------------------------------------------ */
function ChoiceCard({ prompt, choices, correct, why, language, onFirstAnswer, onDone, doneLabel, ask }: {
  prompt: string; choices: string[]; correct: number; why: string; language: Language;
  onFirstAnswer: (ok: boolean, value: string) => void; onDone: () => void; doneLabel: string; ask?: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const ok = picked === correct;
  const choose = (index: number) => {
    if (picked !== null && ok) return;
    setPicked(index);
    if (tries === 0) onFirstAnswer(index === correct, choices[index] ?? '');
    setTries((value) => value + 1);
  };
  return (
    <div className="ls-card">
      <p className="ls-prompt">{prompt}</p>
      <div className="ls-choices" role="radiogroup">
        {choices.map((choice, index) => (
          <button key={index} type="button" role="radio" aria-checked={picked === index}
            className={`ls-choice ${picked === index ? (index === correct ? 'right' : 'wrong') : ''} ${picked !== null && ok && index === correct ? 'right' : ''}`}
            onClick={() => choose(index)} disabled={picked !== null && ok}>
            <span className="ls-choice-key">{String.fromCharCode(65 + index)}</span>
            <span>{choice}</span>
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className={`ls-feedback ${ok ? 'good' : 'bad'}`} role="status">
          <b>{ok ? <><CheckCircle2 size={16} /> {t(language, 'To‘g‘ri!', 'Верно!', 'Correct!')}</> : <><XCircle size={16} /> {t(language, 'Hali emas — yana o‘ylab ko‘ring.', 'Пока нет — подумайте ещё.', 'Not yet — think again.')}</>}</b>
          {ok ? <p>{why}</p> : <p className="muted">{t(language, 'Har bir javobni tekshirib chiqing: qaysi biri mavzuga mos?', 'Проверьте каждый вариант: какой подходит к теме?', 'Check each option: which one fits the topic?')}</p>}
          <div className="ls-feedback-actions">
            {!ok && <button type="button" className="btn small" onClick={() => setPicked(null)}><RotateCcw size={13} /> {t(language, 'Qayta urinish', 'Ещё раз', 'Try again')}</button>}
            {!ok && tries >= 2 && <button type="button" className="btn small" onClick={() => setPicked(correct)}>{t(language, 'Javobni ko‘rsatish', 'Показать ответ', 'Show the answer')}</button>}
            {!ok && ask && <button type="button" className="btn small" onClick={ask}><MessageCircle size={13} /> {t(language, 'Tushuntirib bering', 'Объясните мне', 'Explain to me')}</button>}
            {ok && <button type="button" className="btn small primary" onClick={onDone}>{doneLabel} <ArrowRight size={13} /></button>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Mission                                                           */
/* ------------------------------------------------------------------ */
function MissionStage({ topic, book, language, save, result, next, ask, content, subject, welcome, totalMinutes }: StageProps & { subject: string; welcome: string; totalMinutes: number }) {
  const scenarios: Scenario[] = useMemo(() => missionScenarios(topic, book.subject, language), [topic, book.subject, language]);
  const previous = result(1);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const answers = useRef<Answer[]>([]);
  const finished = index >= scenarios.length;
  const record = (scenario: Scenario, ok: boolean, value: string) => {
    answers.current = [...answers.current.filter((item) => item.id !== scenario.id), { id: scenario.id, ok, v: value, q: scenario.situation.slice(0, 280) }];
  };
  const advance = () => {
    const nextIndex = index + 1;
    setIndex(nextIndex);
    const score = answers.current.filter((item) => item.ok).length;
    void save(1, { score, total: scenarios.length, done: nextIndex >= scenarios.length, answers: answers.current });
  };
  if (!started) {
    return (
      <div className={`ls-mission-hero subject-${book.subject}`}>
        <div className="ls-particles" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}</div>
        <div className="ls-mission-inner">
          <span className="ls-mission-no"><Flag size={14} /> {t(language, `Missiya §${topic.code}`, `Миссия §${topic.code}`, `Mission §${topic.code}`)}</span>
          <h3>{content?.intro?.title || welcome}</h3>
          <p className="ls-mission-topic">{topic.title}</p>
          {content?.intro?.text && <p className="ls-mission-text">{content.intro.text}</p>}
          <div className="ls-mission-meta">
            <span>{subject} · {t(language, `${book.grade}-sinf`, `${book.grade} класс`, `Grade ${book.grade}`)}</span>
            <span><Clock3 size={13} /> ~{totalMinutes} {t(language, 'daqiqa', 'мин', 'min')}</span>
            <span><Target size={13} /> {t(language, `${scenarios.length} ta vaziyat`, `${scenarios.length} ситуации`, `${scenarios.length} scenarios`)}</span>
          </div>
          {previous?.done && <p className="ls-mission-prev"><CheckCircle2 size={14} /> {t(language, `Avval bajarilgan: ${previous.score} / ${previous.total}`, `Уже пройдено: ${previous.score} из ${previous.total}`, `Done before: ${previous.score} of ${previous.total}`)}</p>}
          <button type="button" className="btn primary ls-start" onClick={() => setStarted(true)}><Play size={16} /> {t(language, 'Missiyani boshlash', 'Начать миссию', 'Start mission')}</button>
        </div>
      </div>
    );
  }
  if (finished) {
    const score = answers.current.filter((item) => item.ok).length;
    return (
      <div className="ls-summary">
        <Trophy size={28} />
        <h3>{t(language, 'Missiya bajarildi!', 'Миссия выполнена!', 'Mission complete!')}</h3>
        <p>{t(language, `Birinchi urinishda to‘g‘ri: ${score} / ${scenarios.length}`, `С первой попытки верно: ${score} из ${scenarios.length}`, `Right at first try: ${score} of ${scenarios.length}`)}</p>
        <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => { answers.current = []; setIndex(0); }}><RotateCcw size={14} /> {t(language, 'Qaytadan', 'Пройти заново', 'Again')}</button>
          <button type="button" className="btn primary" onClick={next}>{t(language, 'Darslikka o‘tish', 'К учебнику', 'To the textbook')} <ArrowRight size={14} /></button>
        </div>
      </div>
    );
  }
  const scenario = scenarios[index]!;
  return (
    <div className="ls-mission-play">
      <div className="ls-step-dots" aria-hidden="true">{scenarios.map((item, i) => <span key={item.id} className={i < index ? 'done' : i === index ? 'on' : ''} />)}</div>
      <ChoiceCard key={scenario.id} prompt={scenario.situation} choices={scenario.choices} correct={scenario.correct} why={scenario.why} language={language}
        onFirstAnswer={(ok, value) => record(scenario, ok, value)} onDone={advance}
        doneLabel={index + 1 < scenarios.length ? t(language, 'Keyingi vaziyat', 'Следующая ситуация', 'Next scenario') : t(language, 'Yakunlash', 'Завершить', 'Finish')}
        ask={() => ask('mistake', scenario.situation)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Interactive textbook                                              */
/* ------------------------------------------------------------------ */
function useSpeech(language: Language) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);
  const speak = (text: string) => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // The topics are written in Russian; the interface language only changes the voice when it matches.
    utterance.lang = /[а-яё]/i.test(text) ? 'ru-RU' : language === 'Uzbek' ? 'uz-UZ' : 'en-US';
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };
  const stop = () => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false); };
  return { supported, speaking, speak, stop };
}

function BookStage({ topic, book, language, save, result, ask, content }: StageProps) {
  const parts = useMemo(() => sentences(topic.essence), [topic.essence]);
  const terms = useMemo(() => glossary(topic), [topic]);
  const notes = (content?.blocks ?? []).filter((block) => block.kind === 'text');
  const pages = useMemo(() => {
    const out: Array<{ title: string; lines: string[]; kind: 'main' | 'note' }> = [];
    for (let i = 0; i < Math.max(1, parts.length); i += 2) out.push({ title: i === 0 ? t(language, 'Asosiysi', 'Главное', 'The main idea') : t(language, 'Davomi', 'Дальше', 'Next'), lines: parts.slice(i, i + 2), kind: 'main' });
    for (const note of notes) if (note.kind === 'text') out.push({ title: note.title || t(language, 'O‘qituvchidan', 'От учителя', 'From the teacher'), lines: sentences(note.text).length ? sentences(note.text) : [note.text], kind: 'note' });
    return out;
  }, [parts, notes, language]);
  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const [zoom, setZoom] = useState(1);
  const [marking, setMarking] = useState(false);
  const markKey = `eduverse:marks:${topic.key}`;
  const [marks, setMarks] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(markKey) ?? '[]') as string[]; } catch { return []; } });
  const [popover, setPopover] = useState<{ term: string; meaning: string } | null>(null);
  const [extra, setExtra] = useState<'' | 'life' | 'facts' | 'hard'>('');
  const speech = useSpeech(language);
  useEffect(() => { try { localStorage.setItem(markKey, JSON.stringify(marks)); } catch { /* private mode */ } }, [marks, markKey]);
  const done = Boolean(result(2)?.done);
  const goPage = (next: number) => {
    const target = Math.max(0, Math.min(pages.length - 1, next));
    setPage(target);
    setPopover(null);
    setSeen((current) => {
      const updated = new Set(current); updated.add(target);
      if (updated.size === pages.length && !done) void save(2, { score: updated.size, total: pages.length, done: true, answers: [] });
      return updated;
    });
  };
  // Words with a definition become buttons that open a small explanation.
  const renderLine = (line: string) => {
    if (!terms.length) return line;
    const pattern = new RegExp(`(${terms.map((item) => item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
    return line.split(pattern).map((piece, index) => {
      const term = terms.find((item) => item.term.toLowerCase() === piece.toLowerCase());
      return term ? <button key={index} type="button" className="ls-term" onClick={(event) => { event.stopPropagation(); setPopover(term); }}>{piece}</button> : <span key={index}>{piece}</span>;
    });
  };
  const current = pages[page]!;
  return (
    <div className="ls-book">
      <div className="ls-book-tools">
        <span className="muted">{t(language, `Darslik, ${topic.page}-bet`, `Учебник, стр. ${topic.page}`, `Textbook, p. ${topic.page}`)}</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => setZoom((value) => Math.max(0.85, value - 0.15))} aria-label={t(language, 'Kichraytirish', 'Уменьшить текст', 'Smaller text')}><Minus size={13} /> A</button>
          <button type="button" className="btn small" onClick={() => setZoom((value) => Math.min(1.9, value + 0.15))} aria-label={t(language, 'Kattalashtirish', 'Увеличить текст', 'Bigger text')}><Plus size={13} /> A</button>
          <button type="button" className={`btn small ${marking ? 'primary' : ''}`} onClick={() => setMarking((value) => !value)} aria-pressed={marking}><Highlighter size={13} /> {t(language, 'Belgilash', 'Выделять', 'Highlight')}</button>
          {speech.supported && (speech.speaking
            ? <button type="button" className="btn small primary" onClick={speech.stop}><Square size={13} /> {t(language, 'To‘xtatish', 'Стоп', 'Stop')}</button>
            : <button type="button" className="btn small" onClick={() => speech.speak(current.lines.join(' '))}><Volume2 size={13} /> {t(language, 'Ovozli o‘qish', 'Прочитать вслух', 'Read aloud')}</button>)}
        </div>
      </div>
      <article className={`ls-page ${current.kind === 'note' ? 'is-note' : ''}`} style={{ fontSize: `${zoom}em` }} onClick={() => setPopover(null)}>
        <h3>{current.title}</h3>
        {current.lines.map((line, index) => (
          <p key={index} className={`ls-line ${marks.includes(line) ? 'marked' : ''} ${marking ? 'can-mark' : ''}`}
            onClick={(event) => { if (!marking) return; event.stopPropagation(); setMarks((list) => (list.includes(line) ? list.filter((item) => item !== line) : [...list, line])); }}>
            {renderLine(line)}
          </p>
        ))}
        {popover && (
          <div className="ls-popover" role="dialog" onClick={(event) => event.stopPropagation()}>
            <b>{popover.term}</b>
            <p>{popover.meaning}</p>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small" onClick={() => ask('word', popover.term)}><Sparkles size={13} /> {t(language, 'Soddaroq', 'Объясни проще', 'Simpler')}</button>
              <button type="button" className="btn small" onClick={() => setPopover(null)}><X size={13} /></button>
            </div>
          </div>
        )}
      </article>
      <div className="ls-pager">
        <button type="button" className="btn small" disabled={page === 0} onClick={() => goPage(page - 1)}><ArrowLeft size={14} /></button>
        <div className="ls-pager-dots">{pages.map((_, index) => <button key={index} type="button" className={`${index === page ? 'on' : ''} ${seen.has(index) ? 'seen' : ''}`} onClick={() => goPage(index)} aria-label={`${index + 1}`} />)}</div>
        <button type="button" className="btn small" disabled={page === pages.length - 1} onClick={() => goPage(page + 1)}><ArrowRight size={14} /></button>
      </div>
      {terms.length > 0 && (
        <div className="ls-definitions">
          <b>{t(language, 'Muhim ta’riflar', 'Важные определения', 'Key definitions')}</b>
          <dl>{terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
        </div>
      )}
      <div className="topic-extras-buttons">
        <button type="button" className={`btn small ${extra === 'life' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'life' ? '' : 'life')}>🌍 {t(language, 'Hayotda', 'Пример из жизни', 'In real life')}</button>
        {topic.facts.length > 0 && <button type="button" className={`btn small ${extra === 'facts' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'facts' ? '' : 'facts')}>✨ {t(language, 'Qo‘shimcha', 'Дополнительно', 'Extra')}</button>}
        <button type="button" className={`btn small ${extra === 'hard' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'hard' ? '' : 'hard')}><Lightbulb size={13} /> {t(language, 'Qiyin joy', 'Сложное понятие', 'Hard part')}</button>
        <button type="button" className="btn small" onClick={() => ask('simple')}><MessageCircle size={13} /> {t(language, 'Soddaroq tushuntiring', 'Объясните проще', 'Explain simply')}</button>
      </div>
      {extra === 'life' && <p className="topic-extras-panel">🌍 {topic.life}</p>}
      {extra === 'facts' && <ul className="topic-extras-panel">{topic.facts.map((fact, index) => <li key={index}>✨ {fact}</li>)}</ul>}
      {extra === 'hard' && (
        <div className="topic-extras-panel">
          <p>{parts.reduce((longest, item) => (item.length > longest.length ? item : longest), '')}</p>
          <button type="button" className="btn small" onClick={() => ask('detail')}><Sparkles size={13} /> {t(language, 'Bosqichma-bosqich tushuntirish', 'Разобрать по шагам', 'Step by step')}</button>
        </div>
      )}
      {marks.length > 0 && <p className="muted ls-marks-count"><Highlighter size={13} /> {t(language, `Belgilangan: ${marks.length}`, `Выделено: ${marks.length}`, `Highlighted: ${marks.length}`)}</p>}
      <TopicBookPages book={book} topic={topic} language={language} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Visual learning and 3D                                            */
/* ------------------------------------------------------------------ */
function videoEmbed(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
  return null;
}
function modelEmbed(url: string): string | null {
  const sketchfab = url.match(/sketchfab\.com\/(?:3d-models\/[^/?#]*-|models\/)([0-9a-f]{32})/i);
  if (sketchfab) return `https://sketchfab.com/models/${sketchfab[1]}/embed?autostart=1&ui_infos=0&ui_watermark=0`;
  if (/^https:\/\/(phet\.colorado\.edu|www\.geogebra\.org|biodigital\.com|human\.biodigital\.com)\//.test(url)) return url;
  return null;
}

function VisualStage({ topic, language, save, result, ask, content }: StageProps) {
  const [touched, setTouched] = useState(false);
  const done = Boolean(result(3)?.done);
  const media = (content?.blocks ?? []).filter((block) => block.kind !== 'text');
  const finish = () => void save(3, { score: 1, total: 1, done: true, answers: [] });
  return (
    <div className="ls-visual">
      <div className="ls-visual-hint"><Box size={16} /> <span>{topic.sceneHint}</span></div>
      <div onPointerDown={() => setTouched(true)}>
        <CourseScene3D scene={topic.scene} language={language} />
      </div>
      <div className="ls-visual-actions">
        <span className="muted">{t(language, 'Barmoq yoki sichqoncha bilan aylantiring, tugmalar bilan o‘zgartiring. «To‘liq ekran» — doskada ko‘rsatish uchun.', 'Крутите пальцем или мышью, меняйте кнопками. «На весь экран» — для доски.', 'Rotate with a finger or mouse, change with the buttons. “Full screen” is for the board.')}</span>
        <button type="button" className={`btn small ${done ? '' : 'primary'}`} disabled={!touched && !done} onClick={finish}>
          <CheckCircle2 size={14} /> {done ? t(language, 'Ko‘rildi ✓', 'Изучено ✓', 'Explored ✓') : touched ? t(language, 'Modelni o‘rgandim', 'Я изучил модель', 'I explored the model') : t(language, 'Avval modelni aylantiring', 'Сначала покрутите модель', 'Rotate the model first')}
        </button>
      </div>
      {media.length > 0 && (
        <div className="ls-media">
          {media.map((block) => {
            if (block.kind === 'image') return <figure key={block.id} className="ls-media-item"><img src={block.url} alt={block.title} loading="lazy" />{block.title && <figcaption>{block.title}</figcaption>}</figure>;
            const src = block.kind === 'video' ? videoEmbed(block.url) : modelEmbed(block.url);
            return (
              <figure key={block.id} className="ls-media-item">
                {src
                  ? <div className="ls-embed"><iframe src={src} title={block.title || block.kind} loading="lazy" allow="autoplay; fullscreen; xr-spatial-tracking; picture-in-picture" allowFullScreen /></div>
                  : <a className="btn" href={block.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {block.title || block.url}</a>}
                {block.title && src && <figcaption>{block.title}</figcaption>}
              </figure>
            );
          })}
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn small" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic.title} 7 класс`)}`} target="_blank" rel="noreferrer"><Play size={13} /> {t(language, 'Mavzu bo‘yicha video', 'Видео по теме', 'Videos on the topic')}</a>
        <button type="button" className="btn small" onClick={() => ask('example')}><Lightbulb size={13} /> {t(language, 'Yana bir misol', 'Ещё пример', 'Another example')}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Practice: matching (drag or tap) and step ordering                */
/* ------------------------------------------------------------------ */
function MatchingActivity({ topic, language, onResult }: { topic: CourseTopic; language: Language; onResult: (score: number, total: number, answers: Answer[]) => void }) {
  const pairs = useMemo(() => matchingPairs(topic), [topic]);
  const rights = useMemo(() => [...pairs.map((pair, index) => ({ text: pair.right, index }))].sort((a, b) => (a.text.length * 7 + a.index * 13) % 11 - (b.text.length * 7 + b.index * 13) % 11), [pairs]);
  const [selected, setSelected] = useState<number | null>(null);
  const [matched, setMatched] = useState<Record<number, number>>({});
  const [wrong, setWrong] = useState<{ left: number; right: number } | null>(null);
  const misses = useRef<Set<number>>(new Set());
  const reported = useRef(false);
  const tryMatch = (left: number, right: number) => {
    if (matched[left] !== undefined) return;
    if (left === right) {
      const next = { ...matched, [left]: right };
      setMatched(next); setSelected(null); setWrong(null);
      if (Object.keys(next).length === pairs.length && !reported.current) {
        reported.current = true;
        onResult(pairs.length - misses.current.size, pairs.length, pairs.map((pair, index) => ({ id: `match:${index}`, ok: !misses.current.has(index), q: pair.left.slice(0, 280) })));
      }
    } else {
      misses.current.add(left);
      setWrong({ left, right });
      window.setTimeout(() => setWrong(null), 900);
    }
  };
  if (pairs.length < 2) return null;
  const complete = Object.keys(matched).length === pairs.length;
  return (
    <div className="ls-activity">
      <h4><GripVertical size={16} /> {t(language, 'Juftini toping', 'Найдите пару', 'Match the pairs')}</h4>
      <p className="muted">{t(language, 'Chapdan bittasini tanlang, keyin o‘ngdan unga mosini bosing yoki sudrab olib boring.', 'Выберите слева, затем нажмите подходящее справа или перетащите на него.', 'Pick one on the left, then tap or drag onto the match on the right.')}</p>
      <div className="ls-match">
        <div className="ls-match-col">
          {pairs.map((pair, index) => (
            <button key={index} type="button" draggable={matched[index] === undefined}
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(index)); setSelected(index); }}
              className={`ls-match-item ${selected === index ? 'on' : ''} ${matched[index] !== undefined ? 'matched' : ''} ${wrong?.left === index ? 'shake' : ''}`}
              onClick={() => setSelected(matched[index] !== undefined ? null : index)}>{pair.left}</button>
          ))}
        </div>
        <div className="ls-match-col">
          {rights.map((item) => {
            const isMatched = Object.values(matched).includes(item.index);
            return (
              <button key={item.index} type="button"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); const left = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(left)) tryMatch(left, item.index); }}
                className={`ls-match-item right ${isMatched ? 'matched' : ''} ${wrong?.right === item.index ? 'shake' : ''}`}
                disabled={isMatched || selected === null} onClick={() => selected !== null && tryMatch(selected, item.index)}>{item.text}</button>
            );
          })}
        </div>
      </div>
      {complete && <div className="ls-feedback good"><b><CheckCircle2 size={16} /> {t(language, `Hammasi topildi! Birinchi urinishda: ${pairs.length - misses.current.size} / ${pairs.length}`, `Все пары найдены! С первой попытки: ${pairs.length - misses.current.size} из ${pairs.length}`, `All matched! First try: ${pairs.length - misses.current.size} of ${pairs.length}`)}</b></div>}
    </div>
  );
}

function OrderingActivity({ topic, language, onResult }: { topic: CourseTopic; language: Language; onResult: (ok: boolean) => void }) {
  const steps = useMemo(() => orderingSteps(topic), [topic]);
  const [order, setOrder] = useState<number[]>(() => steps.map((_, index) => index).sort((a, b) => ((a * 7 + 3) % 5) - ((b * 7 + 3) % 5)));
  const [checked, setChecked] = useState<boolean | null>(null);
  const reported = useRef(false);
  if (steps.length < 3) return null;
  const move = (at: number, delta: number) => {
    const to = at + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order]; [next[at], next[to]] = [next[to]!, next[at]!]; setOrder(next); setChecked(null);
  };
  const check = () => {
    const ok = order.every((value, index) => value === index);
    setChecked(ok);
    if (!reported.current) { reported.current = true; onResult(ok); }
  };
  return (
    <div className="ls-activity">
      <h4><Target size={16} /> {t(language, 'To‘g‘ri tartibga qo‘ying', 'Расставьте по порядку', 'Put in the right order')}</h4>
      <p className="muted">{t(language, 'Tushuntirish qismlari aralashib ketdi. Strelkalar bilan tartibga keltiring.', 'Части объяснения перепутались. Расставьте их стрелками.', 'The explanation got mixed up. Order it with the arrows.')}</p>
      <ol className="ls-order">
        {order.map((value, at) => (
          <li key={value} className={checked === null ? '' : value === at ? 'right' : 'wrong'}>
            <span>{steps[value]}</span>
            <span className="ls-order-btns">
              <button type="button" className="btn small" onClick={() => move(at, -1)} disabled={at === 0} aria-label="↑">↑</button>
              <button type="button" className="btn small" onClick={() => move(at, 1)} disabled={at === order.length - 1} aria-label="↓">↓</button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn primary small" onClick={check}><CheckCircle2 size={14} /> {t(language, 'Tekshirish', 'Проверить', 'Check')}</button>
      {checked !== null && <div className={`ls-feedback ${checked ? 'good' : 'bad'}`}><b>{checked ? t(language, 'To‘g‘ri tartib!', 'Порядок верный!', 'Right order!') : t(language, 'Qizil qatorlar joyida emas. Mantiqni o‘ylang: avval nima, keyin nima?', 'Красные строки не на месте. Подумайте: что сначала, что потом?', 'The red lines are misplaced. What comes first, what next?')}</b></div>}
    </div>
  );
}

function PracticeStage({ topic, language, save }: StageProps) {
  const results = useRef<{ match?: { score: number; total: number; answers: Answer[] }; order?: boolean }>({});
  const hasOrder = orderingSteps(topic).length >= 3;
  const hasMatch = matchingPairs(topic).length >= 2;
  const store = () => {
    const match = results.current.match;
    const order = results.current.order;
    const score = (match?.score ?? 0) + (order ? 1 : 0);
    const total = (hasMatch ? match?.total ?? 0 : 0) + (hasOrder ? 1 : 0);
    const answers = [...(match?.answers ?? []), ...(order === undefined ? [] : [{ id: 'order', ok: order, q: t(language, 'Tartib', 'Порядок объяснения', 'Order of the explanation') }])];
    const done = (!hasMatch || Boolean(match)) && (!hasOrder || order !== undefined);
    void save(4, { score, total: Math.max(total, score), done, answers });
  };
  return (
    <div className="ls-practice">
      {hasMatch && <MatchingActivity topic={topic} language={language} onResult={(score, total, answers) => { results.current.match = { score, total, answers }; store(); }} />}
      {hasOrder && <OrderingActivity topic={topic} language={language} onResult={(ok) => { results.current.order = ok; store(); }} />}
      {!hasMatch && !hasOrder && <div className="notice">{t(language, 'Bu mavzu uchun amaliy topshiriqlar 3D bosqichida.', 'Практика по этой теме — в 3D-модели на этапе 3.', 'Practice for this topic is in the 3D stage.')}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Assessment                                                        */
/* ------------------------------------------------------------------ */
type TestItem =
  | { kind: 'choice'; id: string; prompt: string; choices: string[]; correct: number; why: string }
  | { kind: 'tf'; id: string; prompt: string; answer: boolean; why: string }
  | { kind: 'short'; id: string; prompt: string; reference: string }
  | { kind: 'written'; id: string; prompt: string; reference: string };

function buildTest(topic: CourseTopic, content: LessonContent | null, language: Language): TestItem[] {
  const choices: Choice[] = topicQuestions(topic, 3, 'test');
  const tfs = trueFalse(topic, 3);
  const numeric = topic.tasks.find((task) => /\d/.test(task.a) && task.a.length < 120);
  const items: TestItem[] = [
    ...choices.map((item) => ({ kind: 'choice' as const, id: item.id, prompt: item.prompt, choices: item.choices, correct: item.correct, why: item.why })),
    ...tfs.map((item) => ({ kind: 'tf' as const, id: item.id, prompt: item.text, answer: item.answer, why: item.answer ? t(language, `Bu «${topic.title}» mavzusiga tegishli.`, `Это относится к теме «${topic.title}».`, `This belongs to “${topic.title}”.`) : t(language, `Bu boshqa mavzu: «${item.why}».`, `Это из другой темы: «${item.why}».`, `This is from another topic: “${item.why}”.`) })),
  ];
  if (numeric) items.push({ kind: 'short', id: 'short', prompt: numeric.q, reference: numeric.a });
  items.push({ kind: 'written', id: 'written', prompt: t(language, `O‘z so‘zingiz bilan tushuntiring: ${topic.title}`, `Объясните своими словами: ${topic.title.replace(/\?$/, '')}?`.replace('??', '?'), `Explain in your own words: ${topic.title}`), reference: topic.essence });
  for (const question of content?.questions ?? []) items.push({ kind: 'choice', id: `teacher:${question.id}`, prompt: question.prompt, choices: question.choices, correct: question.correct, why: question.explain || question.choices[question.correct] || '' });
  return items;
}

function TestStage({ topic, book, language, save, result, ask, content, goTo }: StageProps & { goTo: (stage: number) => void }) {
  const items = useMemo(() => buildTest(topic, content, language), [topic, content, language]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [shown, setShown] = useState<{ ok: boolean; close?: boolean; text: string } | null>(null);
  const [typed, setTyped] = useState('');
  const previous = result(5);
  const [review, setReview] = useState(Boolean(previous?.done));
  const item = items[index];
  const answer = (ok: boolean, value: string, feedback: string, close = false) => {
    const next = [...answers.filter((entry) => entry.id !== item!.id), { id: item!.id, ok, v: value.slice(0, 280), q: item!.prompt.slice(0, 280) }];
    setAnswers(next);
    setShown({ ok, close, text: feedback });
  };
  const advance = () => {
    setShown(null); setTyped('');
    const nextIndex = index + 1;
    setIndex(nextIndex);
    if (nextIndex >= items.length) void save(5, { score: answers.filter((entry) => entry.ok).length, total: items.length, done: true, answers });
  };
  if (review && previous) {
    return <TestSummary topic={topic} book={book} language={language} answers={(previous.answers ?? []) as Answer[]} score={previous.score} total={previous.total} onRetry={() => { setReview(false); setAnswers([]); setIndex(0); }} goTo={goTo} ask={ask} />;
  }
  if (!item) {
    return <TestSummary topic={topic} book={book} language={language} answers={answers} score={answers.filter((entry) => entry.ok).length} total={items.length} onRetry={() => { setAnswers([]); setIndex(0); }} goTo={goTo} ask={ask} />;
  }
  return (
    <div className="ls-test">
      <div className="ls-test-head">
        <span>{t(language, `Savol ${index + 1} / ${items.length}`, `Вопрос ${index + 1} из ${items.length}`, `Question ${index + 1} of ${items.length}`)}</span>
        <span className="tag">{item.kind === 'choice' ? t(language, 'Variantli', 'Выбор ответа', 'Multiple choice') : item.kind === 'tf' ? t(language, 'Ha / Yo‘q', 'Верно / Неверно', 'True / False') : item.kind === 'short' ? t(language, 'Qisqa javob', 'Короткий ответ', 'Short answer') : t(language, 'Yozma tushuntirish', 'Письменное объяснение', 'Written explanation')}</span>
      </div>
      <div className="test-progress"><span style={{ width: `${(index / items.length) * 100}%` }} /></div>
      <div className="ls-card">
        <p className="ls-prompt">{item.kind === 'tf' ? t(language, `Bu fikr «${topic.title}» mavzusiga tegishlimi?`, `Это утверждение относится к теме «${topic.title}»?`, `Does this belong to “${topic.title}”?`) : item.prompt}</p>
        {item.kind === 'tf' && <blockquote className="ls-quote">{item.prompt}</blockquote>}
        {item.kind === 'choice' && (
          <div className="ls-choices">
            {item.choices.map((choice, at) => (
              <button key={at} type="button" disabled={Boolean(shown)} className={`ls-choice ${shown && at === item.correct ? 'right' : ''} ${shown && !shown.ok && answers.find((entry) => entry.id === item.id)?.v === choice ? 'wrong' : ''}`}
                onClick={() => answer(at === item.correct, choice, item.why)}>
                <span className="ls-choice-key">{String.fromCharCode(65 + at)}</span><span>{choice}</span>
              </button>
            ))}
          </div>
        )}
        {item.kind === 'tf' && (
          <div className="ls-tf">
            <button type="button" className="btn" disabled={Boolean(shown)} onClick={() => answer(item.answer, 'true', item.why)}><CheckCircle2 size={15} /> {t(language, 'Ha, tegishli', 'Да, относится', 'Yes')}</button>
            <button type="button" className="btn" disabled={Boolean(shown)} onClick={() => answer(!item.answer, 'false', item.why)}><XCircle size={15} /> {t(language, 'Yo‘q', 'Нет', 'No')}</button>
          </div>
        )}
        {(item.kind === 'short' || item.kind === 'written') && (
          <form className="ls-typed" onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim().length < (item.kind === 'written' ? 15 : 1) || shown) return;
            const check = checkShortAnswer(typed, item.reference);
            answer(check.ok, typed, item.kind === 'short' ? item.reference : sentences(item.reference).slice(0, 2).join(' '), check.close);
          }}>
            {item.kind === 'short'
              ? <input className="input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t(language, 'Javobingiz', 'Ваш ответ', 'Your answer')} disabled={Boolean(shown)} />
              : <textarea className="input" rows={4} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t(language, 'Kamida 2 ta gap…', 'Хотя бы 2 предложения…', 'At least 2 sentences…')} disabled={Boolean(shown)} />}
            {!shown && <button type="submit" className="btn primary" disabled={typed.trim().length < (item.kind === 'written' ? 15 : 1)}><Send size={14} /> {t(language, 'Javob berish', 'Ответить', 'Answer')}</button>}
          </form>
        )}
        {shown && (
          <div className={`ls-feedback ${shown.ok ? 'good' : 'bad'}`} role="status">
            <b>{shown.ok ? <><CheckCircle2 size={16} /> {t(language, 'To‘g‘ri!', 'Верно!', 'Correct!')}</> : shown.close ? <><Lightbulb size={16} /> {t(language, 'Yaqin, lekin to‘liq emas.', 'Близко, но не полностью.', 'Close, but not complete.')}</> : <><XCircle size={16} /> {t(language, 'Noto‘g‘ri.', 'Неверно.', 'Not right.')}</>}</b>
            <p>{(item.kind === 'short' || item.kind === 'written') ? `${t(language, 'Namuna', 'Образец', 'Model answer')}: ${shown.text}` : shown.text}</p>
            <div className="ls-feedback-actions">
              {!shown.ok && <button type="button" className="btn small" onClick={() => ask('mistake', item.prompt)}><MessageCircle size={13} /> {t(language, 'Xatoni tushunish', 'Понять ошибку', 'Understand the mistake')}</button>}
              <button type="button" className="btn small primary" onClick={advance}>{index + 1 < items.length ? t(language, 'Keyingi savol', 'Следующий вопрос', 'Next question') : t(language, 'Natija', 'Результат', 'Result')} <ArrowRight size={13} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TestSummary({ topic, book, language, answers, score, total, onRetry, goTo, ask }: { topic: CourseTopic; book: CourseBook; language: Language; answers: Answer[]; score: number; total: number; onRetry: () => void; goTo: (stage: number) => void; ask: (action: string, question?: string) => void }) {
  const wrong = answers.filter((entry) => !entry.ok);
  const share = total ? score / total : 0;
  const page = pdfPageOf(book, topic);
  return (
    <div className="ls-result">
      <div className={`ls-score ${share >= 0.8 ? 'good' : share >= 0.5 ? 'mid' : 'low'}`}>
        <b>{Math.round(share * 100)}%</b>
        <span>{t(language, `${score} / ${total} to‘g‘ri`, `${score} из ${total} верно`, `${score} of ${total} right`)}</span>
      </div>
      <div className="ls-result-grid">
        <div className="ls-result-box good"><CheckCircle2 size={16} /> <b>{score}</b> {t(language, 'to‘g‘ri', 'верных', 'right')}</div>
        <div className="ls-result-box bad"><XCircle size={16} /> <b>{total - score}</b> {t(language, 'xato', 'ошибок', 'wrong')}</div>
      </div>
      {wrong.length > 0 ? (
        <div className="ls-improve">
          <b>{t(language, 'Takrorlash kerak', 'Что повторить', 'Needs review')}</b>
          <ul>{wrong.map((entry) => <li key={entry.id}>{entry.q}</li>)}</ul>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => goTo(2)}><BookOpen size={13} /> {t(language, 'Darslikni qayta o‘qish', 'Перечитать учебник', 'Re-read the textbook')}{page ? ` · ${t(language, `${topic.page}-bet`, `стр. ${topic.page}`, `p. ${topic.page}`)}` : ''}</button>
            <button type="button" className="btn small" onClick={() => goTo(3)}><Box size={13} /> {t(language, '3D ni qayta ko‘rish', 'Посмотреть 3D', 'See the 3D again')}</button>
            <button type="button" className="btn small" onClick={() => ask('review')}><MessageCircle size={13} /> {t(language, 'Nimani takrorlash kerak?', 'Что мне повторить?', 'What should I review?')}</button>
          </div>
        </div>
      ) : <p className="ls-feedback good"><b><Trophy size={16} /> {t(language, 'Xatosiz! Mavzu o‘zlashtirildi.', 'Без ошибок! Тема усвоена.', 'No mistakes! Topic mastered.')}</b></p>}
      <button type="button" className="btn" onClick={onRetry}><RotateCcw size={14} /> {t(language, 'Qayta topshirish', 'Пройти ещё раз', 'Try again')}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Reinforcement: speed round, find the mistake, achievements        */
/* ------------------------------------------------------------------ */
function SpeedRound({ topic, language, onDone }: { topic: CourseTopic; language: Language; onDone: (score: number, total: number) => void }) {
  const items = useMemo(() => trueFalse(topic, 8), [topic]);
  const [state, setState] = useState<'idle' | 'run' | 'end'>('idle');
  const [left, setLeft] = useState(30);
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<'' | 'good' | 'bad'>('');
  useEffect(() => {
    if (state !== 'run') return;
    const timer = window.setInterval(() => setLeft((value) => { if (value <= 1) { window.clearInterval(timer); setState('end'); return 0; } return value - 1; }), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  const reported = useRef(false);
  useEffect(() => { if (state === 'end' && !reported.current) { reported.current = true; onDone(score, items.length); } }, [state, score, items.length, onDone]);
  const reply = (value: boolean) => {
    const ok = items[at]!.answer === value;
    if (ok) setScore((current) => current + 1);
    setFlash(ok ? 'good' : 'bad');
    window.setTimeout(() => setFlash(''), 250);
    if (at + 1 >= items.length) setState('end'); else setAt(at + 1);
  };
  if (items.length < 3) return null;
  return (
    <div className={`ls-activity ls-speed ${flash}`}>
      <h4><Zap size={16} /> {t(language, 'Tezkor raund: 30 soniya', 'Блиц: 30 секунд', 'Speed round: 30 seconds')}</h4>
      {state === 'idle' && <button type="button" className="btn primary" onClick={() => { reported.current = false; setScore(0); setAt(0); setLeft(30); setState('run'); }}><Timer size={14} /> {t(language, 'Boshlash', 'Старт', 'Start')}</button>}
      {state === 'run' && <>
        <div className="ls-speed-top"><span><Timer size={14} /> {left}</span><span>{score} ✓</span></div>
        <blockquote className="ls-quote">{items[at]!.text}</blockquote>
        <p className="muted">{t(language, `Bu «${topic.title}» mavzusidanmi?`, `Это из темы «${topic.title}»?`, `Is this from “${topic.title}”?`)}</p>
        <div className="ls-tf"><button type="button" className="btn" onClick={() => reply(true)}>{t(language, 'Ha', 'Да', 'Yes')}</button><button type="button" className="btn" onClick={() => reply(false)}>{t(language, 'Yo‘q', 'Нет', 'No')}</button></div>
      </>}
      {state === 'end' && <div className="ls-feedback good"><b><Zap size={16} /> {t(language, `Natija: ${score} / ${items.length}`, `Результат: ${score} из ${items.length}`, `Score: ${score} of ${items.length}`)}</b><button type="button" className="btn small" onClick={() => setState('idle')}><RotateCcw size={13} /> {t(language, 'Yana', 'Ещё раз', 'Again')}</button></div>}
    </div>
  );
}

function MistakeHunt({ topic, language, onDone }: { topic: CourseTopic; language: Language; onDone: (ok: boolean) => void }) {
  const puzzle = useMemo(() => findTheMistake(topic), [topic]);
  const [picked, setPicked] = useState<number | null>(null);
  if (!puzzle) return null;
  return (
    <div className="ls-activity">
      <h4><Target size={16} /> {t(language, 'Xatoni toping', 'Найдите ошибку', 'Find the mistake')}</h4>
      <p className="muted">{t(language, 'Bitta gapda son noto‘g‘ri. Qaysi biri?', 'В одном утверждении неверное число. В каком?', 'One statement has a wrong number. Which one?')}</p>
      <div className="ls-choices">
        {puzzle.items.map((item, index) => (
          <button key={index} type="button" disabled={picked !== null} className={`ls-choice ${picked !== null && index === puzzle.wrong ? 'wrong-target' : ''} ${picked === index && index !== puzzle.wrong ? 'wrong' : ''}`}
            onClick={() => { setPicked(index); onDone(index === puzzle.wrong); }}>
            <span className="ls-choice-key">{index + 1}</span><span>{item}</span>
          </button>
        ))}
      </div>
      {picked !== null && <div className={`ls-feedback ${picked === puzzle.wrong ? 'good' : 'bad'}`}><b>{picked === puzzle.wrong ? t(language, 'Topdingiz!', 'Нашли!', 'Found it!') : t(language, 'Bu gap to‘g‘ri edi.', 'Это утверждение было верным.', 'That one was right.')}</b><p>{t(language, 'To‘g‘risi', 'Правильно', 'Correct')}: {puzzle.right}</p></div>}
    </div>
  );
}

const BADGES: Array<{ id: string; icon: ReactNode; title: [string, string, string]; test: (stages: Record<number, StageResult>) => boolean }> = [
  { id: 'mission', icon: <Flag size={18} />, title: ['Xatosiz missiya', 'Миссия без ошибок', 'Flawless mission'], test: (s) => Boolean(s[1]?.done && s[1].total > 0 && s[1].score === s[1].total) },
  { id: 'reader', icon: <BookOpen size={18} />, title: ['Diqqatli kitobxon', 'Внимательный читатель', 'Careful reader'], test: (s) => Boolean(s[2]?.done) },
  { id: 'explorer', icon: <Box size={18} />, title: ['3D tadqiqotchi', '3D-исследователь', '3D explorer'], test: (s) => Boolean(s[3]?.done) },
  { id: 'practice', icon: <GripVertical size={18} />, title: ['Usta amaliyotchi', 'Мастер практики', 'Practice master'], test: (s) => Boolean(s[4]?.done && s[4].total > 0 && s[4].score / s[4].total >= 0.8) },
  { id: 'test', icon: <Award size={18} />, title: ['Bilimdon: 80%+', 'Знаток: 80%+', 'Expert: 80%+'], test: (s) => Boolean(s[5]?.done && s[5].total > 0 && s[5].score / s[5].total >= 0.8) },
  { id: 'speed', icon: <Zap size={18} />, title: ['Chaqmoq', 'Молния', 'Lightning'], test: (s) => Boolean(s[6]?.answers?.some((item) => item.id === 'speed' && item.ok)) },
];

function ChallengeStage({ topic, language, save, stages }: StageProps & { stages: Record<number, StageResult> }) {
  const state = useRef<{ speed?: { score: number; total: number }; hunt?: boolean }>({});
  const store = useCallback(() => {
    const { speed, hunt } = state.current;
    const answers: Answer[] = [];
    if (speed) answers.push({ id: 'speed', ok: speed.total > 0 && speed.score / speed.total >= 0.75, v: `${speed.score}/${speed.total}`, q: t(language, 'Tezkor raund', 'Блиц', 'Speed round') });
    if (hunt !== undefined) answers.push({ id: 'hunt', ok: hunt, q: t(language, 'Xatoni toping', 'Найдите ошибку', 'Find the mistake') });
    void save(6, { score: (speed?.score ?? 0) + (hunt ? 1 : 0), total: (speed?.total ?? 0) + (hunt === undefined ? 0 : 1), done: Boolean(speed) || hunt !== undefined, answers });
  }, [save, language]);
  const onSpeed = useCallback((score: number, total: number) => { state.current.speed = { score, total }; store(); }, [store]);
  return (
    <div className="ls-challenge">
      <SpeedRound topic={topic} language={language} onDone={onSpeed} />
      <MistakeHunt topic={topic} language={language} onDone={(ok) => { state.current.hunt = ok; store(); }} />
      <div className="ls-activity">
        <h4><Trophy size={16} /> {t(language, 'Yutuqlar', 'Достижения', 'Achievements')}</h4>
        <p className="muted">{t(language, 'Yutuqlar faqat to‘g‘ri javoblar va bajarilgan bosqichlar uchun beriladi.', 'Награды даются только за верные ответы и пройденные этапы.', 'Awards are given only for right answers and finished stages.')}</p>
        <div className="ls-badges">
          {BADGES.map((badge) => {
            const earned = badge.test(stages);
            return <div key={badge.id} className={`ls-badge ${earned ? 'earned' : ''}`}>{badge.icon}<span>{t(language, ...badge.title)}</span></div>;
          })}
        </div>
        <p className="muted">{t(language, 'Sinf musobaqasi: o‘qituvchi doskada savol chiqaradi — telefoningizdan javob bering.', 'Соревнование класса: учитель выводит вопрос на доску — отвечайте с телефона.', 'Class contest: the teacher shows a question on the board — answer from your phone.')}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Homework and personal learning                                    */
/* ------------------------------------------------------------------ */
const SUBJECT_RU: Record<CourseBook['subject'], string> = { physics: 'Физика', chemistry: 'Химия', biology: 'Биология', math: 'Математика' };

function HomeworkStage({ topic, book, language, save, content, user, school, classId, isTeacher, stages, onOpen, ask }: StageProps & {
  user: User; school: SchoolData; classId: string | null; isTeacher: boolean; stages: Record<number, StageResult>; onOpen: (path: string) => void;
}) {
  const text = content?.homework || topic.homework;
  const assignment = school.assignments.find((item) => item.topicId === `course:${topic.key}` && (!classId || item.classId === classId));
  const submission = assignment?.mySubmission ?? null;
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const weak = Object.values(stages).flatMap((item) => (item.answers ?? []).filter((answer) => !answer.ok && answer.q)).filter((answer, index, all) => all.findIndex((other) => other.q === answer.q) === index).slice(0, 5);
  const graded = submission && submission.score !== null && submission.score !== undefined;

  async function send() {
    if (!assignment || !photos.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await submitAssignment(assignment.id, { content: note.trim() || t(language, 'Daftar rasmi', 'Фото тетради', 'Notebook photo'), attachments: photos });
      setPhotos([]); setNote('');
      setMessage(t(language, 'Ish o‘qituvchiga yuborildi ✓', 'Работа отправлена учителю ✓', 'Work sent to the teacher ✓'));
      void save(7, { score: 1, total: 1, done: true, answers: [] });
      await school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!classId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const due = new Date(); due.setDate(due.getDate() + 1); due.setHours(23, 59, 0, 0);
      await createAssignment(classId, { title: `§${topic.code} ${topic.title}`.slice(0, 160), subject: SUBJECT_RU[book.subject], description: text.slice(0, 4000), topicId: `course:${topic.key}`, topicTitle: `§${topic.code} ${topic.title}`.slice(0, 180), dueAt: due.toISOString() });
      setMessage(t(language, 'Uy vazifasi sinfga berildi ✓', 'Домашка задана классу ✓', 'Homework given to the class ✓'));
      await school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ls-homework">
      <div className="ls-card ls-hw-task">
        <span className="eyebrow">{t(language, 'Darslikdan', 'Из учебника', 'From the textbook')} · §{topic.code}</span>
        <p className="ls-prompt">{text}</p>
        {assignment?.dueAt && <span className="tag"><Clock3 size={12} /> {t(language, 'Muddat', 'Срок', 'Due')}: {new Date(assignment.dueAt).toLocaleString(language === 'English' ? 'en-GB' : language === 'Uzbek' ? 'uz-UZ' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {isTeacher && (
        <div className="ls-activity">
          {assignment
            ? <p><CheckCircle2 size={15} /> {t(language, `Sinfga berilgan. Topshirganlar: ${assignment.submissionCount ?? 0}`, `Задано классу. Сдали: ${assignment.submissionCount ?? 0}`, `Given to the class. Handed in: ${assignment.submissionCount ?? 0}`)}</p>
            : <p className="muted">{t(language, 'Dars tugagach darslikdagi vazifa sinfga o‘zi beriladi. Hozir berish ham mumkin.', 'После урока задание из учебника уйдёт классу само. Можно задать и сейчас.', 'After the lesson the textbook homework goes to the class by itself. You can give it now too.')}</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {!assignment && classId && <button type="button" className="btn primary" disabled={busy} onClick={() => void assign()}><Send size={14} /> {t(language, 'Hozir berish', 'Задать сейчас', 'Give now')}</button>}
            <button type="button" className="btn" onClick={() => onOpen('/check')}><CheckCircle2 size={14} /> {t(language, 'Tekshirishga', 'К проверке домашки', 'To checking')}</button>
          </div>
        </div>
      )}
      {user.role === 'student' && (
        <div className="ls-activity">
          <h4><Camera size={16} /> {t(language, 'Daftar rasmini yuborish', 'Отправить фото тетради', 'Send a notebook photo')}</h4>
          {!assignment && <p className="muted">{t(language, 'Vazifa dars tugagach shu yerda va «Vazifalar»da chiqadi.', 'Задание появится здесь и во вкладке «Задания» после урока.', 'The task appears here and in “Homework” after the lesson.')}</p>}
          {assignment && graded && <p className="ls-feedback good"><b><Award size={15} /> {t(language, 'Baholandi', 'Оценено', 'Graded')}</b>{submission?.feedback && <span> · {submission.feedback}</span>}</p>}
          {assignment && !graded && <>
            {submission && <p className="muted"><CheckCircle2 size={14} /> {t(language, 'Ish yuborilgan. Yangilash mumkin.', 'Работа уже отправлена. Можно обновить.', 'Already sent. You can update it.')}</p>}
            <PhotoPicker photos={photos} onChange={setPhotos} language={language} existingCount={submission?.attachmentCount ?? 0} />
            <textarea className="input" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t(language, 'Izoh (ixtiyoriy)', 'Комментарий (по желанию)', 'Comment (optional)')} />
            <button type="button" className="btn primary" disabled={busy || photos.length === 0} onClick={() => void send()}><Send size={14} /> {busy ? '…' : submission ? t(language, 'Yangilash', 'Обновить работу', 'Update') : t(language, 'Yuborish', 'Отправить работу', 'Send')}</button>
          </>}
        </div>
      )}
      {message && <div className="notice good" role="status">{message}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="ls-activity">
        <h4><Sparkles size={16} /> {t(language, 'Shaxsiy tavsiya', 'Персональный план', 'Personal plan')}</h4>
        {weak.length
          ? <><p className="muted">{t(language, 'Darsda xato qilgan savollaringiz — uyda yana bir bor ko‘ring:', 'Вопросы, где были ошибки, — посмотрите их дома ещё раз:', 'Questions you got wrong — look at them again at home:')}</p><ul>{weak.map((item) => <li key={item.id}>{item.q}</li>)}</ul></>
          : <p className="muted">{t(language, 'Xatolar yo‘q. Qo‘shimcha mashq oling.', 'Ошибок нет. Возьмите дополнительную практику.', 'No mistakes. Take extra practice.')}</p>}
        <button type="button" className="btn small" onClick={() => ask('practice')}><Plus size={13} /> {t(language, 'Qo‘shimcha mashq', 'Дополнительные задания', 'Extra practice')}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The lesson helper                                                    */
/* ------------------------------------------------------------------ */
function LessonHelper({ topic, language, stageName, mistakes, seed, onClose }: { topic: CourseTopic; language: Language; stageName: string; mistakes: string[]; seed: { action: string; question?: string } | null; onClose: () => void }) {
  const [messages, setMessages] = useState<Array<{ who: 'me' | 'helper'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const ACTIONS: Array<[string, string]> = [
    ['simple', t(language, 'Soddaroq', 'Объясни проще', 'Explain simply')],
    ['detail', t(language, 'Batafsil', 'Подробнее', 'More detail')],
    ['example', t(language, 'Boshqa misol', 'Другой пример', 'Another example')],
    ['practice', t(language, 'Mashq ber', 'Дай задания', 'Give practice')],
    ['mistake', t(language, 'Xatolarimni tushuntir', 'Разбери мои ошибки', 'Explain my mistakes')],
    ['review', t(language, 'Nimani takrorlay?', 'Что повторить?', 'What to review?')],
  ];
  const run = useCallback(async (action: string, question = '') => {
    const label = ACTIONS.find(([key]) => key === action)?.[1] ?? question;
    setMessages((current) => [...current, { who: 'me', text: action === 'ask' || action === 'word' ? question : label }]);
    setBusy(true);
    let answer: string | null = null;
    try {
      const response = await customFetch<{ answer: string | null }>('/api/ai/lesson-help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicKey: topic.key, action, question, stage: stageName, mistakes: action === 'mistake' && question ? [question, ...mistakes] : mistakes, lang: langCode(language) }) });
      answer = response.answer;
    } catch { /* answered from the topic below */ }
    setMessages((current) => [...current, { who: 'helper', text: answer ?? localHelp(action, topic, language, question, action === 'mistake' && question ? [question, ...mistakes] : mistakes) }]);
    setBusy(false);
  }, [topic, language, stageName, mistakes]); // eslint-disable-line react-hooks/exhaustive-deps
  const seeded = useRef<string>('');
  useEffect(() => {
    if (!seed) return;
    const key = `${seed.action}:${seed.question ?? ''}`;
    if (seeded.current === key) return;
    seeded.current = key;
    void run(seed.action, seed.question);
  }, [seed, run]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  return (
    <aside className="ls-helper" role="dialog" aria-label={t(language, 'Yordamchi', 'Помощник', 'Helper')}>
      <header>
        <div><b>{t(language, 'Dars yordamchisi', 'Помощник урока', 'Lesson helper')}</b><small className="muted">§{topic.code} · {stageName}</small></div>
        <button type="button" className="btn small" onClick={onClose} aria-label={t(language, 'Yopish', 'Закрыть', 'Close')}><X size={14} /></button>
      </header>
      <div className="ls-helper-list" ref={list}>
        {messages.length === 0 && <p className="muted">{t(language, 'Men javobni aytib qo‘ymayman — tushunishga yordam beraman. Tugmani tanlang yoki savol yozing.', 'Я не подсказываю готовые ответы — помогаю понять. Выберите кнопку или напишите вопрос.', 'I don’t give ready answers — I help you understand. Pick a button or ask.')}</p>}
        {messages.map((message, index) => <div key={index} className={`ls-msg ${message.who}`}>{message.text}</div>)}
        {busy && <div className="ls-msg helper"><LoadingBlock language={language} kind="inline" /></div>}
      </div>
      <div className="ls-helper-actions">{ACTIONS.map(([key, label]) => <button key={key} type="button" className="btn small" disabled={busy} onClick={() => void run(key)}>{label}</button>)}</div>
      <form className="ls-helper-form" onSubmit={(event) => { event.preventDefault(); const value = input.trim(); if (value.length < 2 || busy) return; setInput(''); void run(value.split(/\s+/).length <= 2 ? 'word' : 'ask', value); }}>
        <input className="input" value={input} maxLength={400} onChange={(event) => setInput(event.target.value)} placeholder={t(language, 'Savol yoki tushunarsiz so‘z…', 'Вопрос или непонятное слово…', 'A question or a hard word…')} />
        <button type="submit" className="btn primary" disabled={busy || input.trim().length < 2} aria-label={t(language, 'Yuborish', 'Отправить', 'Send')}><Send size={14} /></button>
      </form>
    </aside>
  );
}
