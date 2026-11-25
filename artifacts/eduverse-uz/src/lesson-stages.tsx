import './lesson-stages.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createAssignment, customFetch, submitAssignment, type User } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Box, Camera, CheckCircle2, Clock3, ExternalLink, Flag, GripVertical, Highlighter,
  Hand, Lightbulb, MessageCircle, Minus, NotebookPen, Play, Plus, RotateCcw, Send, Sparkles, Square, Star, Target, Timer, Trophy, Volume2, X, XCircle, Zap,
} from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import type { CourseBook, CourseTopic } from './course-data';
import { CourseScene3D, TopicBookPages } from './course';
import {
  FLOW, STAGES, checkShortAnswer, findTheMistake, glossary, localHelp, matchingPairs, orderingSteps, sentences, stepOf, topicQuestions, trueFalse, tx,
  type Choice,
} from './lesson-engine';
import { PhotoPicker } from './homework';
import { friendlyError } from './errors';
import { LoadingBlock } from './ui/loading';
import { LessonBuilder, ClassProgressPanel, BoardControls, OnlineAndAsks, StudentBoard, useLive, type LessonContent, type LiveHook, type LiveState } from './lesson-teacher';

/*
 * The 40-minute lesson of a textbook topic (one main button per screen):
 *  explanation 15 · 3D 10 · practice 8 · test 5 · achievements 30 s · results and closing 1.
 *  Homework is given after the lesson.
 * Every answer is saved for the pupil (and the teacher sees the class), the lesson helper
 * knows the topic, the stage and the pupil's mistakes, and the teacher can run the class board.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
const langCode = (language: Language) => (language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru');
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

export function LessonStages({ user, school, book, topic, classId, language, onOpen, onFinished }: {
  user: User; school: SchoolData; book: CourseBook; topic: CourseTopic; classId: string | null; language: Language; onOpen: (path: string) => void; onFinished?: () => void;
}) {
  const isStudent = user.role === 'student';
  const isTeacher = !isStudent && user.role !== 'parent';
  const progress = useLessonProgress(topic.key, classId, isStudent || isTeacher);
  const { content, author, reload } = useLessonContent(topic.key, classId);
  const live = useLive(classId, isStudent || isTeacher);
  const [stage, setStage] = useState(FLOW[0]!.n);
  const [view, setView] = useState<'lesson' | 'builder' | 'class'>('lesson');
  const [follow, setFollow] = useState(true);
  const [helperOpen, setHelperOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [helperSeed, setHelperSeed] = useState<{ action: string; question?: string } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const liveHere = live.state && live.state.topicKey === topic.key ? live.state : null;
  const at = Math.max(0, FLOW.findIndex((item) => item.n === stage));
  const nextStage = FLOW[at + 1];
  const prevStage = FLOW[at - 1];

  // The pupil follows the stage the teacher shows on the board (can be switched off).
  useEffect(() => { if (isStudent && follow && liveHere && liveHere.stage !== stage && FLOW.some((item) => item.n === liveHere.stage)) setStage(liveHere.stage); }, [isStudent, follow, liveHere?.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: number) => {
    const target = FLOW.some((item) => item.n === next) ? next : FLOW[0]!.n;
    setStage(target);
    if (isStudent && liveHere) setFollow(target === liveHere.stage);
    window.setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const minuteOf = (n: number) => content?.minutes?.[n - 1] || STAGES[n - 1]!.minutes;
  const doneCount = FLOW.filter((item) => progress.stages[item.n]?.done).length;
  const mistakes = useMemo(() => Object.values(progress.stages).flatMap((item) => (item.answers ?? []).filter((answer) => !answer.ok && answer.q).map((answer) => answer.q!)).slice(0, 8), [progress.stages]);
  const ask = (action: string, question?: string) => { setHelperSeed({ action, question }); setHelperOpen(true); setAskOpen(false); };
  const props = { topic, book, language, save: progress.save, result: (n: number) => progress.stages[n], next: () => nextStage && go(nextStage.n), ask, content };
  const canAskTeacher = isStudent && Boolean(classId);

  return (
    <div className="ls" ref={top}>
      {isTeacher && (
        <div className="ls-teacher-tabs" role="tablist">
          {([['lesson', t(language, 'Dars', 'Урок', 'Lesson'), Play], ['builder', t(language, 'Tayyorlash', 'Подготовить', 'Prepare'), Plus], ['class', t(language, 'Natijalar', 'Результаты', 'Results'), Target]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`studio-tab ${view === key ? 'active' : ''}`} onClick={() => setView(key)} disabled={key === 'class' && !classId}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {view === 'builder' && isTeacher && <LessonBuilder topic={topic} language={language} initial={content} onSaved={reload} />}
      {view === 'class' && isTeacher && classId && <ClassProgressPanel classId={classId} topic={topic} language={language} />}
      {view === 'lesson' && <>
        <nav className="ls-steps" aria-label={t(language, 'Dars bosqichlari', 'Этапы урока', 'Lesson stages')}>
          {FLOW.map((item) => {
            const result = progress.stages[item.n];
            return (
              <button key={item.n} type="button" className={`ls-step ${stage === item.n ? 'on' : ''} ${result?.done ? 'done' : ''} ${liveHere?.stage === item.n ? 'live' : ''}`} onClick={() => go(item.n)} aria-current={stage === item.n ? 'step' : undefined} title={`${tx(language, item.title)} · ${minuteOf(item.n)} ${t(language, 'daq', 'мин', 'min')}`}>
                <span className="ls-step-dot">{result?.done ? <CheckCircle2 size={14} /> : stepOf(item.n)}</span>
                <span className="ls-step-name">{tx(language, item.title)}</span>
              </button>
            );
          })}
        </nav>
        <div className="ls-meter" aria-hidden="true"><div className="test-progress"><span style={{ width: `${(doneCount / FLOW.length) * 100}%` }} /></div></div>
        {progress.saveError && <p className="ls-save-error">{t(language, 'Saqlanmadi — internetni tekshiring', 'Не сохранилось — проверьте интернет', 'Not saved — check the internet')}</p>}
        {isTeacher && classId && <BoardControls classId={classId} topic={topic} stage={stage} language={language} live={live} content={content} />}
        {isStudent && liveHere && <StudentBoard classId={classId!} state={liveHere} language={language} follow={follow} onFollow={() => { setFollow(true); if (FLOW.some((item) => item.n === liveHere.stage)) setStage(liveHere.stage); }} onAnswered={live.refresh} />}
        {!progress.loaded ? <LoadingBlock language={language} /> : (
          <section className={`ls-stage ls-stage-${stage}`} key={stage}>
            <header className="ls-stage-head">
              <h2>{tx(language, STAGES[stage - 1]!.title)}</h2>
              <span className="ls-stage-time"><Clock3 size={13} /> {minuteOf(stage)} {t(language, 'daq', 'мин', 'min')}</span>
              <button type="button" className="btn small ls-helper-inline" onClick={() => { setHelperSeed(null); setHelperOpen((value) => !value); setAskOpen(false); }} aria-label={t(language, 'Yordamchi', 'Помощник', 'Helper')}><Sparkles size={16} /></button>
              {canAskTeacher && <button type="button" className="btn small ls-ask-inline" onClick={() => { setAskOpen((value) => !value); setHelperOpen(false); }} aria-expanded={askOpen}><Hand size={15} /> {t(language, 'Savol', 'Вопрос', 'Ask')}</button>}
            </header>
            {stage === 2 && <BookStage {...props} />}
            {stage === 3 && <VisualStage {...props} />}
            {stage === 4 && <PracticeStage {...props} />}
            {stage === 5 && <TestStage {...props} goTo={go} />}
            {stage === 6 && <AchievementsStage {...props} stages={progress.stages} autoNext={!(isStudent && liveHere && follow)} />}
            {stage === 7 && <ResultsStage {...props} user={user} school={school} classId={classId} isTeacher={isTeacher} stages={progress.stages} onOpen={onOpen} live={live} onFinished={onFinished} />}
            <footer className="ls-stage-nav">
              {prevStage ? <button type="button" className="btn ls-back" onClick={() => go(prevStage.n)} aria-label={t(language, 'Orqaga', 'Назад', 'Back')}><ArrowLeft size={18} /></button> : <span />}
              {nextStage && <button type="button" className="btn primary ls-next" onClick={() => go(nextStage.n)}>{t(language, 'Keyingisi', 'Дальше', 'Next')} <ArrowRight size={18} /></button>}
            </footer>
          </section>
        )}
        {author && content && !isTeacher && <p className="muted ls-author">{t(language, `O‘qituvchi: ${author}`, `Учитель: ${author}`, `Teacher: ${author}`)}</p>}
      </>}
      {<button type="button" className="ls-helper-fab" onClick={() => { setHelperSeed(null); setHelperOpen((value) => !value); }} aria-expanded={helperOpen}>
        <Sparkles size={18} /> <span>{t(language, 'Yordamchi', 'Помощник', 'Helper')}</span>
      </button>}
      {askOpen && canAskTeacher && <AskTeacher classId={classId!} topic={topic} language={language} onClose={() => setAskOpen(false)} onHelper={() => { setHelperSeed(null); setHelperOpen(true); setAskOpen(false); }} />}
      {helperOpen && <LessonHelper topic={topic} language={language} stageName={tx(language, STAGES[stage - 1]!.title)} mistakes={mistakes} seed={helperSeed} onClose={() => setHelperOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Ask the teacher": a short question goes to the teacher's board      */
/* ------------------------------------------------------------------ */
function AskTeacher({ classId, topic, language, onClose, onHelper }: { classId: string; topic: CourseTopic; language: Language; onClose: () => void; onHelper: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    const value = text.trim();
    if (value.length < 2 || busy) return;
    setBusy(true); setError('');
    try {
      await customFetch(`/api/classes/${classId}/live/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicKey: topic.key, text: value }) });
      setText(''); setSent(true);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="ls-helper ls-ask" role="dialog" aria-label={t(language, 'O‘qituvchiga savol', 'Вопрос учителю', 'Ask the teacher')}>
      <div className="ls-helper-head">
        <b><Hand size={16} /> {t(language, 'O‘qituvchiga savol', 'Вопрос учителю', 'Ask the teacher')}</b>
        <button type="button" className="btn small" onClick={onClose} aria-label={t(language, 'Yopish', 'Закрыть', 'Close')}><X size={14} /></button>
      </div>
      {sent && <div className="notice good" role="status"><CheckCircle2 size={14} /> {t(language, 'Yuborildi. O‘qituvchi ko‘radi.', 'Отправлено. Учитель увидит.', 'Sent. The teacher will see it.')}</div>}
      <form className="ls-helper-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input className="input" value={text} maxLength={300} onChange={(event) => { setText(event.target.value); setSent(false); }} placeholder={t(language, 'Nima tushunarsiz?', 'Что непонятно?', 'What is unclear?')} autoFocus />
        <button type="submit" className="btn primary" disabled={busy || text.trim().length < 2} aria-label={t(language, 'Yuborish', 'Отправить', 'Send')}><Send size={14} /></button>
      </form>
      {error && <div className="notice" role="alert">{error}</div>}
      <button type="button" className="btn small ls-ask-helper" onClick={onHelper}><Sparkles size={13} /> {t(language, 'Yordamchidan so‘rash', 'Спросить помощника', 'Ask the helper')}</button>
    </aside>
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
  // The first sentence is the main idea on top; the pages go on from there.
  const body = parts.length > 1 && !content?.intro?.text ? parts.slice(1) : parts;
  const pages = useMemo(() => {
    const out: Array<{ title: string; lines: string[]; kind: 'main' | 'note' }> = [];
    for (let i = 0; i < Math.max(1, body.length); i += 2) out.push({ title: i === 0 ? t(language, 'Asosiysi', 'Главное', 'The main idea') : t(language, 'Davomi', 'Дальше', 'Next'), lines: body.slice(i, i + 2), kind: 'main' });
    for (const note of notes) if (note.kind === 'text') out.push({ title: note.title || t(language, 'O‘qituvchidan', 'От учителя', 'From the teacher'), lines: sentences(note.text).length ? sentences(note.text) : [note.text], kind: 'note' });
    return out;
  }, [body, notes, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const [zoom, setZoom] = useState(1);
  const [marking, setMarking] = useState(false);
  const markKey = `eduverse:marks:${topic.key}`;
  const [marks, setMarks] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(markKey) ?? '[]') as string[]; } catch { return []; } });
  const [popover, setPopover] = useState<{ term: string; meaning: string } | null>(null);
  const [extra, setExtra] = useState<'' | 'life' | 'facts' | 'hard'>('');
  const [tools, setTools] = useState(false);
  const [more, setMore] = useState(false);
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
  const mainIdea = parts[0] ?? topic.essence;
  return (
    <div className="ls-book">
      <div className="ls-main-idea">
        <Lightbulb size={22} />
        <div>
          {content?.intro?.title && <b className="ls-main-topic">{content.intro.title}</b>}
          {content?.intro?.text ? <p>{content.intro.text}</p> : <p>{mainIdea}</p>}
          {topic.hook && <p className="ls-hook">❓ {topic.hook}</p>}
        </div>
      </div>
      <div className="ls-book-tools">
        <button type="button" className={`btn small ${tools ? 'primary' : ''}`} onClick={() => setTools((value) => !value)} aria-expanded={tools} aria-label={t(language, 'Sozlamalar', 'Настройки текста', 'Text settings')}>Aa</button>
        {tools && <>
        <button type="button" className="btn small" onClick={() => setZoom((value) => Math.max(0.85, value - 0.15))} aria-label={t(language, 'Kichraytirish', 'Уменьшить текст', 'Smaller text')}><Minus size={13} /> A</button>
        <button type="button" className="btn small" onClick={() => setZoom((value) => Math.min(1.9, value + 0.15))} aria-label={t(language, 'Kattalashtirish', 'Увеличить текст', 'Bigger text')}><Plus size={13} /> A</button>
        <button type="button" className={`btn small ${marking ? 'primary' : ''}`} onClick={() => setMarking((value) => !value)} aria-pressed={marking} aria-label={t(language, 'Belgilash', 'Выделять', 'Highlight')}><Highlighter size={13} /></button>
        {speech.supported && (speech.speaking
          ? <button type="button" className="btn small primary" onClick={speech.stop} aria-label={t(language, 'To‘xtatish', 'Стоп', 'Stop')}><Square size={13} /></button>
          : <button type="button" className="btn small" onClick={() => speech.speak(current.lines.join(' '))} aria-label={t(language, 'Ovozli o‘qish', 'Прочитать вслух', 'Read aloud')}><Volume2 size={13} /></button>)}
        </>}
      </div>
      <article className={`ls-page ${current.kind === 'note' ? 'is-note' : ''}`} style={{ fontSize: `${zoom}em` }} onClick={() => setPopover(null)}>
        {current.kind === 'note' && <h3>{current.title}</h3>}
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
              <button type="button" className="btn small" onClick={() => ask('word', popover.term)}><Sparkles size={13} /> {t(language, 'Soddaroq', 'Проще', 'Simpler')}</button>
              <button type="button" className="btn small" onClick={() => setPopover(null)} aria-label={t(language, 'Yopish', 'Закрыть', 'Close')}><X size={13} /></button>
            </div>
          </div>
        )}
      </article>
      {pages.length > 1 && (
        <div className="ls-pager">
          <button type="button" className="btn small" disabled={page === 0} onClick={() => goPage(page - 1)} aria-label={t(language, 'Orqaga', 'Назад', 'Back')}><ArrowLeft size={14} /></button>
          <div className="ls-pager-dots">{pages.map((_, index) => <button key={index} type="button" className={`${index === page ? 'on' : ''} ${seen.has(index) ? 'seen' : ''}`} onClick={() => goPage(index)} aria-label={`${index + 1}`} />)}</div>
          <button type="button" className="btn small" disabled={page === pages.length - 1} onClick={() => goPage(page + 1)} aria-label={t(language, 'Oldinga', 'Вперёд', 'Forward')}><ArrowRight size={14} /></button>
        </div>
      )}
      {more && terms.length > 0 && (
        <details className="ls-definitions">
          <summary><b>{t(language, 'Ta’riflar', 'Определения', 'Definitions')}</b> · {terms.length}</summary>
          <dl>{terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
        </details>
      )}
      <button type="button" className={`btn small ls-more ${more ? 'primary' : ''}`} onClick={() => { setMore((value) => !value); setExtra(''); }} aria-expanded={more}><Plus size={13} /> {t(language, 'Batafsil', 'Подробнее', 'More')}</button>
      {more && <div className="topic-extras-buttons">
        <button type="button" className={`btn small ${extra === 'life' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'life' ? '' : 'life')}>🌍 {t(language, 'Hayotda', 'Из жизни', 'Real life')}</button>
        {topic.facts.length > 0 && <button type="button" className={`btn small ${extra === 'facts' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'facts' ? '' : 'facts')}>✨ {t(language, 'Qiziq', 'Интересно', 'Fun facts')}</button>}
        <button type="button" className={`btn small ${extra === 'hard' ? 'primary' : ''}`} onClick={() => setExtra(extra === 'hard' ? '' : 'hard')}><Lightbulb size={13} /> {t(language, 'Qiyin joy', 'Сложное', 'Hard part')}</button>
        <button type="button" className="btn small" onClick={() => ask('simple')}><MessageCircle size={13} /> {t(language, 'Soddaroq', 'Проще', 'Simpler')}</button>
      </div>}
      {extra === 'life' && <p className="topic-extras-panel">🌍 {topic.life}</p>}
      {extra === 'facts' && <ul className="topic-extras-panel">{topic.facts.map((fact, index) => <li key={index}>✨ {fact}</li>)}</ul>}
      {extra === 'hard' && (
        <div className="topic-extras-panel">
          <p>{parts.reduce((longest, item) => (item.length > longest.length ? item : longest), '')}</p>
          <button type="button" className="btn small" onClick={() => ask('detail')}><Sparkles size={13} /> {t(language, 'Qadamma-qadam', 'По шагам', 'Step by step')}</button>
        </div>
      )}
      <NotesBox topicKey={topic.key} marks={marks} language={language} onUnmark={(line) => setMarks((list) => list.filter((item) => item !== line))} />
      <TopicBookPages book={book} topic={topic} language={language} />
    </div>
  );
}

/* My notes: highlighted lines + own notes, kept on this device. */
function NotesBox({ topicKey, marks, language, onUnmark }: { topicKey: string; marks: string[]; language: Language; onUnmark: (line: string) => void }) {
  const key = `eduverse:notes:${topicKey}`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(() => marks.length > 0 || text.length > 0);
  useEffect(() => { if (marks.length > 0) setOpen(true); }, [marks.length]);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(key, text); setSaved(true); } catch { /* private mode */ } }, 500);
    return () => window.clearTimeout(timer);
  }, [text, key]);
  return (
    <details className="ls-notes" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary><NotebookPen size={15} /> <b>{t(language, 'Konspekt', 'Конспект', 'My notes')}</b>{marks.length > 0 && <span className="tag">{marks.length}</span>}</summary>
      {marks.length > 0 && <ul className="ls-notes-marks">{marks.map((line) => <li key={line}><span>{line}</span><button type="button" className="btn small" onClick={() => onUnmark(line)} aria-label={t(language, 'Olib tashlash', 'Убрать', 'Remove')}><X size={12} /></button></li>)}</ul>}
      <textarea className="input" rows={3} value={text} maxLength={3000} onChange={(event) => { setText(event.target.value); setSaved(false); }} placeholder={t(language, 'Qisqa yozing…', 'Запишите коротко…', 'Write briefly…')} />
      {saved && text && <small className="muted"><CheckCircle2 size={12} /> {t(language, 'Saqlandi', 'Сохранено', 'Saved')}</small>}
    </details>
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
      <div onPointerDown={() => setTouched(true)}>
        <CourseScene3D scene={topic.scene} language={language} />
      </div>
      <div className="ls-visual-actions">
        <span className="muted">{t(language, 'Barmoq bilan aylantiring', 'Крутите пальцем', 'Rotate with a finger')}</span>
        <button type="button" className={`btn small ${done ? '' : 'primary'}`} disabled={!touched && !done} onClick={finish}>
          <CheckCircle2 size={14} /> {done ? t(language, 'Ko‘rildi', 'Готово', 'Done') : touched ? t(language, 'Ko‘rdim', 'Посмотрел', 'Seen it') : t(language, 'Avval aylantiring', 'Сначала покрутите', 'Rotate first')}
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
      <details className="ls-more-box">
        <summary className="btn small"><Plus size={13} /> {t(language, 'Batafsil', 'Подробнее', 'More')}</summary>
        <p className="muted">{topic.sceneHint}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn small" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic.title} 7 класс`)}`} target="_blank" rel="noreferrer"><Play size={13} /> {t(language, 'Video', 'Видео', 'Video')}</a>
        <button type="button" className="btn small" onClick={() => ask('example')}><Lightbulb size={13} /> {t(language, 'Misol', 'Пример', 'Example')}</button>
      </div>
      </details>
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
  const results = useRef<{ match?: { score: number; total: number; answers: Answer[] }; order?: boolean; speed?: { score: number; total: number }; hunt?: boolean }>({});
  const hasOrder = orderingSteps(topic).length >= 3;
  const hasMatch = matchingPairs(topic).length >= 2;
  const store = () => {
    const { match, order, speed, hunt } = results.current;
    const score = (match?.score ?? 0) + (order ? 1 : 0) + (hunt ? 1 : 0);
    const total = (hasMatch ? match?.total ?? 0 : 0) + (hasOrder ? 1 : 0) + (hunt === undefined ? 0 : 1);
    const answers: Answer[] = [...(match?.answers ?? [])];
    if (order !== undefined) answers.push({ id: 'order', ok: order, q: t(language, 'Tartib', 'Порядок объяснения', 'Order of the explanation') });
    if (hunt !== undefined) answers.push({ id: 'hunt', ok: hunt, q: t(language, 'Xatoni toping', 'Найдите ошибку', 'Find the mistake') });
    if (speed) answers.push({ id: 'speed', ok: speed.total > 0 && speed.score / speed.total >= 0.75, v: `${speed.score}/${speed.total}`, q: t(language, 'Tezkor raund', 'Блиц', 'Speed round') });
    const done = (!hasMatch || Boolean(match)) && (!hasOrder || order !== undefined);
    void save(4, { score, total: Math.max(total, score), done, answers });
  };
  const onSpeed = useCallback((score: number, total: number) => { results.current.speed = { score, total }; store(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ls-practice">
      {hasMatch && <MatchingActivity topic={topic} language={language} onResult={(score, total, answers) => { results.current.match = { score, total, answers }; store(); }} />}
      {hasOrder && <OrderingActivity topic={topic} language={language} onResult={(ok) => { results.current.order = ok; store(); }} />}
      <MistakeHunt topic={topic} language={language} onDone={(ok) => { results.current.hunt = ok; store(); }} />
      <SpeedRound topic={topic} language={language} onDone={onSpeed} />
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
  // A short test with a timer: when the time is over the answers given so far count.
  const limit = (content?.minutes?.[4] || STAGES[4]!.minutes) * 60;
  const [left, setLeft] = useState(limit);
  const running = Boolean(item) && !(review && previous);
  const answersRef = useRef<Answer[]>([]);
  answersRef.current = answers;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (left > 0 || !running) return;
    const given = answersRef.current;
    void save(5, { score: given.filter((entry) => entry.ok).length, total: items.length, done: true, answers: given });
    setShown(null);
    setIndex(items.length);
  }, [left, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const restart = () => { setAnswers([]); setIndex(0); setLeft(limit); };
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
    return <TestSummary topic={topic} book={book} language={language} answers={(previous.answers ?? []) as Answer[]} score={previous.score} total={previous.total} onRetry={() => { setReview(false); restart(); }} goTo={goTo} ask={ask} />;
  }
  if (!item) {
    return <TestSummary topic={topic} book={book} language={language} answers={answers} score={answers.filter((entry) => entry.ok).length} total={items.length} onRetry={restart} goTo={goTo} ask={ask} />;
  }
  return (
    <div className="ls-test">
      <div className="ls-test-head">
        <span><b>{index + 1}</b> / {items.length}</span>
        <span className={`ls-timer ${left <= 60 ? 'low' : ''}`}><Timer size={14} /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
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
            <button type="button" className="btn small" onClick={() => goTo(2)}><BookOpen size={13} /> {t(language, 'Tushuntirish', 'Объяснение', 'Explanation')}</button>
            <button type="button" className="btn small" onClick={() => goTo(3)}><Box size={13} /> 3D</button>
            <button type="button" className="btn small" onClick={() => ask('review')}><MessageCircle size={13} /> {t(language, 'Yordam', 'Помощь', 'Help')}</button>
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
  { id: 'all', icon: <Flag size={22} />, title: ['Hammasi bajarildi', 'Всё пройдено', 'All done'], test: (s) => [2, 3, 4, 5].every((n) => s[n]?.done) },
  { id: 'reader', icon: <BookOpen size={22} />, title: ['Diqqatli', 'Внимательный', 'Attentive'], test: (s) => Boolean(s[2]?.done) },
  { id: 'explorer', icon: <Box size={22} />, title: ['3D tadqiqotchi', '3D-исследователь', '3D explorer'], test: (s) => Boolean(s[3]?.done) },
  { id: 'practice', icon: <GripVertical size={22} />, title: ['Usta', 'Мастер практики', 'Practice master'], test: (s) => Boolean(s[4]?.done && s[4].total > 0 && s[4].score / s[4].total >= 0.8) },
  { id: 'test', icon: <Award size={22} />, title: ['Bilimdon', 'Знаток', 'Expert'], test: (s) => Boolean(s[5]?.done && s[5].total > 0 && s[5].score / s[5].total >= 0.8) },
  { id: 'speed', icon: <Zap size={22} />, title: ['Chaqmoq', 'Молния', 'Lightning'], test: (s) => Boolean([s[4], s[6]].some((item) => item?.answers?.some((answer) => answer.id === 'speed' && answer.ok))) },
];

/* 30 seconds: the result, the awards and what to repeat — then on to the results by itself. */
const ACHIEVE_SECONDS = 30;
function AchievementsStage({ language, save, stages, next, autoNext }: StageProps & { stages: Record<number, StageResult>; autoNext: boolean }) {
  const [left, setLeft] = useState(ACHIEVE_SECONDS);
  const [paused, setPaused] = useState(!autoNext);
  useEffect(() => { void save(6, { score: 1, total: 1, done: true, answers: stages[6]?.answers ?? [] }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [paused]);
  useEffect(() => { if (left === 0 && !paused) next(); }, [left, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  const test = stages[5];
  const share = test?.done && test.total ? test.score / test.total : null;
  const stars = share === null ? 0 : share >= 0.8 ? 3 : share >= 0.5 ? 2 : 1;
  const earned = BADGES.filter((badge) => badge.test(stages));
  const repeat = Object.values(stages).flatMap((item) => (item.answers ?? []).filter((answer) => !answer.ok && answer.q).map((answer) => answer.q!))
    .filter((item, index, all) => all.indexOf(item) === index).slice(0, 2);
  const short = (text: string) => (text.length > 70 ? `${text.slice(0, 68)}…` : text);
  return (
    <div className="ls-achieve">
      <div className="ls-achieve-score">
        {share !== null
          ? <><b>{Math.round(share * 100)}%</b><span className="ls-stars" aria-label={`${stars} / 3`}>{[1, 2, 3].map((n) => <Star key={n} size={26} className={n <= stars ? 'on' : ''} />)}</span></>
          : <Trophy size={44} />}
      </div>
      <div className="ls-achieve-badges">
        {(earned.length ? earned : [{ id: 'join', icon: <Sparkles size={22} />, title: ['Darsda qatnashdi', 'Был на уроке', 'Took part'] as [string, string, string] }]).map((badge) => (
          <div key={badge.id} className="ls-badge earned big">{badge.icon}<span>{t(language, ...badge.title)}</span></div>
        ))}
      </div>
      {repeat.length > 0 && (
        <div className="ls-achieve-repeat">
          <b><RotateCcw size={14} /> {t(language, 'Takrorlang', 'Повторить', 'Repeat')}</b>
          <ul>{repeat.map((item) => <li key={item}>{short(item)}</li>)}</ul>
        </div>
      )}
      <div className="ls-achieve-timer">
        <span className="ls-ring" style={{ ['--p' as string]: `${(left / ACHIEVE_SECONDS) * 100}%` }}>{left}</span>
        {!paused
          ? <button type="button" className="btn small" onClick={() => setPaused(true)}>{t(language, 'To‘xtatish', 'Остаться', 'Stay')}</button>
          : <button type="button" className="btn small" onClick={() => setPaused(false)}><Play size={13} /></button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results and closing: the class, the questions, "Finish the lesson"   */
/* ------------------------------------------------------------------ */
const todayIso = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };

function ResultsStage(props: StageProps & {
  user: User; school: SchoolData; classId: string | null; isTeacher: boolean; stages: Record<number, StageResult>; onOpen: (path: string) => void; live: LiveHook; onFinished?: () => void;
}) {
  const { topic, book, language, save, stages, classId, isTeacher, school, live, onFinished, content } = props;
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const liveHere = live.state && live.state.topicKey === topic.key ? live.state : null;
  const assignment = school.assignments.find((item) => item.topicId === `course:${topic.key}` && (!classId || item.classId === classId));
  useEffect(() => { if (!isTeacher) void save(7, { score: stages[7]?.score ?? 0, total: stages[7]?.total ?? 0, done: true, answers: [] }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    if (!classId) return;
    setBusy(true); setError('');
    try {
      // 1. the topic is covered today (the journal and the course plan move on)
      await customFetch(`/api/classes/${classId}/course/${topic.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doneOn: todayIso() }) });
      // 2. the homework goes to the class, if it was not given yet
      if (!assignment) await giveHomework(classId, topic, book, content?.homework || topic.homework);
      // 3. the class board is closed
      if (liveHere) {
        const response = await customFetch<{ live: LiveState | null }>(`/api/classes/${classId}/live`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicKey: topic.key, stage: 7, question: null, reveal: false, active: false }) });
        live.set(response.live);
      }
      setFinished(true);
      await school.refresh();
      onFinished?.();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  if (!isTeacher) {
    const test = stages[5];
    const done = FLOW.filter((item) => stages[item.n]?.done).length;
    return (
      <div className="ls-results">
        <div className="ls-results-hero"><CheckCircle2 size={40} /><b>{t(language, 'Dars tugadi!', 'Урок окончен!', 'Lesson over!')}</b></div>
        <div className="ls-result-grid">
          <div className="ls-result-box good"><Award size={16} /> <b>{test?.done && test.total ? `${Math.round((test.score / test.total) * 100)}%` : '—'}</b> {t(language, 'test', 'тест', 'test')}</div>
          <div className="ls-result-box"><CheckCircle2 size={16} /> <b>{done}/{FLOW.length}</b> {t(language, 'bosqich', 'этапов', 'stages')}</div>
        </div>
        <details className="ls-hw-box" open>
          <summary><b>{t(language, 'Uy vazifasi', 'Домашка', 'Homework')}</b></summary>
          <HomeworkStage {...props} />
        </details>
      </div>
    );
  }
  return (
    <div className="ls-results">
      {classId ? (
        <>
          {liveHere && <OnlineAndAsks classId={classId} state={liveHere} language={language} onChange={live.refresh} />}
          <ClassProgressPanel classId={classId} topic={topic} language={language} />
          {finished
            ? <div className="notice good" role="status"><CheckCircle2 size={15} /> {t(language, 'Dars yakunlandi. Mavzu belgilandi, uy vazifasi berildi.', 'Урок завершён. Тема отмечена, домашка задана.', 'Lesson finished. Topic marked, homework given.')}</div>
            : <button type="button" className="btn primary ls-finish" disabled={busy} onClick={() => void finish()}><Flag size={18} /> {busy ? '…' : t(language, 'Darsni yakunlash', 'Завершить урок', 'Finish the lesson')}</button>}
          {error && <div className="notice" role="alert">{error}</div>}
        </>
      ) : <div className="notice">{t(language, 'Natijalar uchun sinfni tanlang.', 'Выберите класс, чтобы видеть результаты.', 'Choose a class to see results.')}</div>}
      <details className="ls-hw-box">
        <summary><b>{t(language, 'Uy vazifasi', 'Домашка', 'Homework')}</b></summary>
        <HomeworkStage {...props} />
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Homework and personal learning                                    */
/* ------------------------------------------------------------------ */
const SUBJECT_RU: Record<CourseBook['subject'], string> = { physics: 'Физика', chemistry: 'Химия', biology: 'Биология', math: 'Математика' };
async function giveHomework(classId: string, topic: CourseTopic, book: CourseBook, text: string) {
  const due = new Date(); due.setDate(due.getDate() + 1); due.setHours(23, 59, 0, 0);
  await createAssignment(classId, { title: `§${topic.code} ${topic.title}`.slice(0, 160), subject: SUBJECT_RU[book.subject], description: text.slice(0, 4000), topicId: `course:${topic.key}`, topicTitle: `§${topic.code} ${topic.title}`.slice(0, 180), dueAt: due.toISOString() });
}

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
      await giveHomework(classId, topic, book, text);
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
        <p className="ls-prompt">{text}</p>
        {assignment?.dueAt && <span className="tag"><Clock3 size={12} /> {t(language, 'Muddat', 'Срок', 'Due')}: {new Date(assignment.dueAt).toLocaleString(language === 'English' ? 'en-GB' : language === 'Uzbek' ? 'uz-UZ' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {isTeacher && (
        <div className="ls-activity">
          {assignment
            ? <p><CheckCircle2 size={15} /> {t(language, `Sinfga berilgan. Topshirganlar: ${assignment.submissionCount ?? 0}`, `Задано классу. Сдали: ${assignment.submissionCount ?? 0}`, `Given to the class. Handed in: ${assignment.submissionCount ?? 0}`)}</p>
            : <p className="muted">{t(language, '«Darsni yakunlash» bosilganda beriladi.', 'Задаётся при «Завершить урок».', 'Given with “Finish the lesson”.')}</p>}
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
        <h4><Sparkles size={16} /> {t(language, 'Takrorlash', 'Повторить', 'Review')}</h4>
        {weak.length
          ? <><p className="muted">{t(language, 'Uyda yana ko‘ring:', 'Посмотрите дома ещё раз:', 'Look again at home:')}</p><ul>{weak.map((item) => <li key={item.id}>{item.q}</li>)}</ul></>
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
    ['example', t(language, 'Misol', 'Пример', 'Example')],
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
        <div><b>{t(language, 'Dars yordamchisi', 'Помощник урока', 'Lesson helper')}</b><small className="muted">{topic.title}</small></div>
        <button type="button" className="btn small" onClick={onClose} aria-label={t(language, 'Yopish', 'Закрыть', 'Close')}><X size={14} /></button>
      </header>
      <div className="ls-helper-list" ref={list}>
        {messages.length === 0 && <p className="muted">{t(language, 'Men javobni aytib qo‘ymayman — tushunishga yordam beraman. Tugmani tanlang yoki savol yozing.', 'Я не подсказываю готовые ответы — помогаю понять. Выберите кнопку или напишите вопрос.', 'I don’t give ready answers — I help you understand. Pick a button or ask.')}</p>}
        {messages.map((message, index) => <div key={index} className={`ls-msg ${message.who}`}>{message.text}</div>)}
        {busy && <div className="ls-msg helper"><LoadingBlock language={language} kind="inline" /></div>}
      </div>
      <div className="ls-helper-actions">{ACTIONS.map(([key, label]) => <button key={key} type="button" className="btn small" disabled={busy} onClick={() => void run(key)}>{label}</button>)}</div>
      <form className="ls-helper-form" onSubmit={(event) => { event.preventDefault(); const value = input.trim(); if (value.length < 2 || busy) return; setInput(''); void run(value.split(/\s+/).length <= 2 ? 'word' : 'ask', value); }}>
        <input className="input" value={input} maxLength={400} onChange={(event) => setInput(event.target.value)} placeholder={t(language, 'Mavzu bo‘yicha savol…', 'Вопрос по теме…', 'Ask about the topic…')} />
        <button type="submit" className="btn primary" disabled={busy || input.trim().length < 2} aria-label={t(language, 'Yuborish', 'Отправить', 'Send')}><Send size={14} /></button>
      </form>
    </aside>
  );
}
