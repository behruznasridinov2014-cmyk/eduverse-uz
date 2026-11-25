import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { BarChart3, CheckCircle2, Eye, Image as ImageIcon, MonitorPlay, Plus, Radio, RefreshCw, Save, Square, Trash2, Type, Video, Box, HelpCircle, Users } from 'lucide-react';
import type { Language } from './school-data';
import type { CourseTopic } from './course-data';
import { FLOW, STAGES, missionScenarios, stepOf, topicQuestions, tx } from './lesson-engine';
import { bookOf } from './lesson-engine';
import { compressImage } from './homework';
import { friendlyError } from './errors';
import { LoadingBlock } from './ui/loading';

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);

export type LessonBlock =
  | { id: string; kind: 'text'; title: string; text: string }
  | { id: string; kind: 'video' | 'image' | 'model'; title: string; url: string };
export type LessonQuestion = { id: string; prompt: string; choices: string[]; correct: number; explain: string };
export type LessonContent = { intro: { title: string; text: string }; blocks: LessonBlock[]; questions: LessonQuestion[]; minutes: number[]; homework: string };

const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY: LessonContent = { intro: { title: '', text: '' }, blocks: [], questions: [], minutes: [], homework: '' };

/* ------------------------------------------------------------------ */
/* Class board state (short polling: works on every school network)     */
/* ------------------------------------------------------------------ */
export type LiveState = {
  topicKey: string; stage: number; reveal: boolean; students: number; updatedAt: string;
  question: { id: string; prompt: string; choices: string[]; correct: number } | null;
  stats: { counts: number[]; answered: number; right: number } | null;
  mine: number | null;
  /** teacher only: pupils with the lesson open now, and their questions */
  online?: Array<{ id: string; name: string }>;
  asks?: Array<{ id: string; name: string; text: string; createdAt: string }>;
};
export type LiveHook = { state: LiveState | null; refresh: () => void; set: (state: LiveState | null) => void };

export function useLive(classId: string | null, enabled: boolean): LiveHook {
  const [state, setState] = useState<LiveState | null>(null);
  const refresh = useCallback(() => {
    if (!classId || !enabled) return;
    void customFetch<{ live: LiveState | null }>(`/api/classes/${classId}/live`, { method: 'GET' })
      .then((response) => setState(response.live))
      .catch(() => {});
  }, [classId, enabled]);
  useEffect(() => {
    refresh();
    if (!classId || !enabled) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 3500);
    return () => window.clearInterval(timer);
  }, [refresh, classId, enabled]);
  return { state, refresh, set: setState };
}

type BoardQuestion = { key: string; prompt: string; choices: string[]; correct: number };

export function BoardControls({ classId, topic, stage, language, live, content }: { classId: string; topic: CourseTopic; stage: number; language: Language; live: LiveHook; content: LessonContent | null }) {
  const on = Boolean(live.state && live.state.topicKey === topic.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const book = bookOf(topic);
  const questions: BoardQuestion[] = useMemo(() => [
    ...(content?.questions ?? []).map((item) => ({ key: `t:${item.id}`, prompt: item.prompt, choices: item.choices, correct: item.correct })),
    ...topicQuestions(topic, 6, 'board').map((item) => ({ key: item.id, prompt: item.prompt, choices: item.choices, correct: item.correct })),
    ...(book ? missionScenarios(topic, book.subject, language).map((item) => ({ key: item.id, prompt: item.situation, choices: item.choices, correct: item.correct })) : []),
  ], [content, topic, book, language]);
  const [pick, setPick] = useState(0);
  const put = useCallback(async (patch: { stage?: number; question?: LiveState['question'] | null; reveal?: boolean; active?: boolean }) => {
    setBusy(true); setError('');
    try {
      const current = live.state && live.state.topicKey === topic.key ? live.state : null;
      const body = {
        topicKey: topic.key,
        stage: patch.stage ?? current?.stage ?? stage,
        question: patch.question !== undefined ? patch.question : current?.question ?? null,
        reveal: patch.reveal ?? false,
        active: patch.active ?? true,
      };
      const response = await customFetch<{ live: LiveState | null }>(`/api/classes/${classId}/live`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      live.set(response.live);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }, [classId, topic.key, stage, live, language]);
  // The board follows the teacher's stage.
  useEffect(() => { if (on && live.state!.stage !== stage) void put({ stage, question: live.state!.question, reveal: live.state!.reveal }); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = on ? live.state! : null;
  return (
    <section className={`ls-board ${on ? 'on' : ''}`}>
      <div className="ls-board-head">
        <span className="ls-board-title"><MonitorPlay size={16} /> {t(language, 'Sinf doskasi', 'Доска класса', 'Class board')}{on && <span className="ls-live-dot">{t(language, 'jonli', 'в эфире', 'live')}</span>}</span>
        {on
          ? <button type="button" className="btn small" disabled={busy} onClick={() => void put({ active: false, question: null })}><Square size={13} /> {t(language, 'Tugatish', 'Завершить', 'Stop')}</button>
          : <button type="button" className="btn small primary" disabled={busy} onClick={() => void put({ stage, question: null })}><Radio size={13} /> {t(language, 'Sinf bilan boshlash', 'Вести урок с классом', 'Run with the class')}</button>}
      </div>
      {state && (
        <>
          <OnlineAndAsks classId={classId} state={state} language={language} onChange={live.refresh} />
          {!state.question && questions.length > 0 && (
            <div className="ls-board-launch">
              <select className="input" value={pick} onChange={(event) => setPick(Number(event.target.value))} aria-label={t(language, 'Savol', 'Вопрос', 'Question')}>
                {questions.map((item, index) => <option key={item.key} value={index}>{item.prompt.slice(0, 90)}</option>)}
              </select>
              <button type="button" className="btn primary small" disabled={busy} onClick={() => { const item = questions[pick]!; void put({ question: { id: `${item.key}:${Date.now().toString(36)}`, prompt: item.prompt, choices: item.choices, correct: item.correct } }); }}>
                <HelpCircle size={13} /> {t(language, 'Savolni chiqarish', 'Вывести вопрос', 'Show question')}
              </button>
            </div>
          )}
          {state.question && (
            <div className="ls-board-question">
              <p className="ls-prompt">{state.question.prompt}</p>
              <LiveBars question={state.question} stats={state.stats} reveal language={language} showCorrect={state.reveal} />
              <p className="muted"><Users size={13} /> {t(language, `Javob berdi: ${state.stats?.answered ?? 0} / ${state.students}`, `Ответили: ${state.stats?.answered ?? 0} из ${state.students}`, `Answered: ${state.stats?.answered ?? 0} of ${state.students}`)}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {!state.reveal && <button type="button" className="btn small primary" disabled={busy} onClick={() => void put({ question: state.question, reveal: true })}><Eye size={13} /> {t(language, 'To‘g‘ri javobni ko‘rsatish', 'Показать ответ', 'Show the answer')}</button>}
                <button type="button" className="btn small" disabled={busy} onClick={() => void put({ question: null })}>{t(language, 'Keyingi savol', 'Следующий вопрос', 'Next question')}</button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}

/** Teacher: who is connected now and the pupils' questions ("ask the teacher"). */
export function OnlineAndAsks({ classId, state, language, onChange }: { classId: string; state: LiveState; language: Language; onChange: () => void }) {
  const [busy, setBusy] = useState('');
  const online = state.online ?? [];
  const asks = state.asks ?? [];
  async function done(id: string) {
    setBusy(id);
    try { await customFetch(`/api/classes/${classId}/live/ask/${id}/done`, { method: 'POST' }); onChange(); } catch { /* next poll shows it again */ } finally { setBusy(''); }
  }
  return (
    <div className="ls-online">
      <details className="ls-online-list">
        <summary><Users size={14} /> <b>{online.length}</b> / {state.students} {t(language, 'darsda', 'на уроке', 'in the lesson')}</summary>
        {online.length > 0 ? <div className="ls-online-names">{online.map((item) => <span key={item.id} className="tag green">{item.name}</span>)}</div> : <p className="muted">{t(language, 'Hali hech kim yo‘q', 'Пока никого', 'Nobody yet')}</p>}
      </details>
      {asks.length > 0 && (
        <ul className="ls-asks">
          {asks.map((item) => (
            <li key={item.id}>
              <span className="ls-ask-text"><b>{item.name}</b> {item.text}</span>
              <button type="button" className="btn small" disabled={busy === item.id} onClick={() => void done(item.id)}><CheckCircle2 size={13} /> {t(language, 'Javob berdim', 'Ответил', 'Answered')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LiveBars({ question, stats, showCorrect, language }: { question: NonNullable<LiveState['question']>; stats: LiveState['stats']; reveal: boolean; showCorrect: boolean; language: Language }) {
  const counts = stats?.counts ?? [];
  const max = Math.max(1, ...counts);
  return (
    <ul className="ls-bars" aria-label={t(language, 'Javoblar', 'Ответы', 'Answers')}>
      {question.choices.map((choice, index) => (
        <li key={index} className={showCorrect && index === question.correct ? 'right' : ''}>
          <span className="ls-bar-label">{String.fromCharCode(65 + index)}. {choice}</span>
          <span className="ls-bar"><span style={{ width: `${((counts[index] ?? 0) / max) * 100}%` }} /></span>
          <b>{counts.length ? counts[index] ?? 0 : ''}</b>
        </li>
      ))}
    </ul>
  );
}

export function StudentBoard({ classId, state, language, follow, onFollow, onAnswered }: { classId: string; state: LiveState; language: Language; follow: boolean; onFollow: () => void; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function answer(choice: number) {
    if (!state.question) return;
    setBusy(true); setError('');
    try {
      await customFetch(`/api/classes/${classId}/live/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: state.question.id, choice }) });
      onAnswered();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ls-board on student">
      <div className="ls-board-head">
        <span className="ls-board-title"><MonitorPlay size={16} /> {t(language, 'O‘qituvchi doskasi', 'Доска учителя', 'Teacher’s board')}<span className="ls-live-dot">{t(language, 'jonli', 'в эфире', 'live')}</span></span>
        {!follow && <button type="button" className="btn small" onClick={onFollow}>{t(language, 'O‘qituvchiga qaytish', 'Вернуться к учителю', 'Back to the teacher')}</button>}
      </div>
      {state.question ? (
        <div className="ls-board-question">
          <p className="ls-prompt">{state.question.prompt}</p>
          {state.reveal
            ? <LiveBars question={state.question} stats={state.stats} reveal language={language} showCorrect />
            : (
              <div className="ls-choices">
                {state.question.choices.map((choice, index) => (
                  <button key={index} type="button" disabled={busy} className={`ls-choice ${state.mine === index ? 'picked' : ''}`} onClick={() => void answer(index)}>
                    <span className="ls-choice-key">{String.fromCharCode(65 + index)}</span><span>{choice}</span>
                  </button>
                ))}
              </div>
            )}
          {state.reveal && state.mine !== null && <p className={`ls-feedback ${state.mine === state.question.correct ? 'good' : 'bad'}`}><b>{state.mine === state.question.correct ? t(language, 'Siz to‘g‘ri javob berdingiz!', 'Вы ответили верно!', 'You were right!') : t(language, 'Sizning javobingiz boshqa edi.', 'Ваш ответ был другим.', 'Your answer was different.')}</b></p>}
          {!state.reveal && state.mine !== null && <p className="muted"><CheckCircle2 size={13} /> {t(language, 'Javob qabul qilindi. Uni o‘zgartirish mumkin.', 'Ответ принят. Можно изменить.', 'Answer received. You can change it.')}</p>}
        </div>
      ) : <p className="muted">{t(language, 'O‘qituvchi savol chiqarishini kuting.', 'Ждите вопрос учителя.', 'Wait for the teacher’s question.')}</p>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Class results: who is on which stage, what the class gets wrong      */
/* ------------------------------------------------------------------ */
type ClassProgress = {
  students: Array<{ id: string; name: string; stages: Array<{ stage: number; score: number; total: number; done: boolean; updatedAt: string }> }>;
  questions: Array<{ id: string; q: string; right: number; wrong: number }>;
};

export function ClassProgressPanel({ classId, topic, language }: { classId: string; topic: CourseTopic; language: Language }) {
  const [data, setData] = useState<ClassProgress | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    customFetch<ClassProgress>(`/api/classes/${classId}/lesson-progress/${topic.key}`, { method: 'GET' })
      .then((response) => { setData(response); setError(''); })
      .catch((requestError) => setError(friendlyError(requestError, language)));
  }, [classId, topic.key, language]);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (error) return <div className="notice" role="alert">{error}</div>;
  if (!data) return <LoadingBlock language={language} />;
  const started = data.students.filter((student) => student.stages.length > 0).length;
  const cell = (student: ClassProgress['students'][number], n: number) => student.stages.find((item) => item.stage === n);
  return (
    <section className="ls-class">
      <div className="ls-class-top">
        <div className="people-stat"><b>{started}</b><span>{t(language, 'boshladi', 'начали', 'started')}</span></div>
        <div className="people-stat"><b>{data.students.filter((student) => cell(student, 5)?.done).length}</b><span>{t(language, 'testni topshirdi', 'сдали тест', 'took the test')}</span></div>
        <div className="people-stat"><b>{data.students.length}</b><span>{t(language, 'sinfda', 'в классе', 'in class')}</span></div>
        <button type="button" className="btn small" onClick={load} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={13} /></button>
      </div>
      {data.students.length === 0 && <div className="notice">{t(language, 'Sinfda o‘quvchi yo‘q.', 'В классе нет учеников.', 'No pupils in the class.')}</div>}
      {data.students.length > 0 && (
        <div className="ls-class-table" role="table">
          <div className="ls-class-row head" role="row">
            <span>{t(language, 'O‘quvchi', 'Ученик', 'Pupil')}</span>
            {FLOW.map((item) => <span key={item.n} title={tx(language, item.title)}>{stepOf(item.n)}</span>)}
          </div>
          {data.students.map((student) => (
            <div className="ls-class-row" role="row" key={student.id}>
              <span className="ls-class-name">{student.name}</span>
              {FLOW.map((item) => {
                const value = cell(student, item.n);
                const share = value && value.total ? value.score / value.total : null;
                return <span key={item.n} className={`ls-class-cell ${value?.done ? 'done' : value ? 'part' : ''} ${share !== null ? (share >= 0.8 ? 'good' : share >= 0.5 ? 'mid' : 'low') : ''}`}>{value ? (value.total ? `${value.score}/${value.total}` : '✓') : '·'}</span>;
              })}
            </div>
          ))}
        </div>
      )}
      <div className="ls-activity">
        <h4><BarChart3 size={16} /> {t(language, 'Sinf ko‘p xato qilgan savollar', 'Где класс ошибается чаще', 'Where the class goes wrong')}</h4>
        {data.questions.filter((item) => item.wrong > 0).length === 0
          ? <p className="muted">{t(language, 'Hozircha xato yo‘q.', 'Пока ошибок нет.', 'No mistakes yet.')}</p>
          : <ul className="ls-bars">{data.questions.filter((item) => item.wrong > 0).slice(0, 10).map((item) => {
            const total = item.right + item.wrong;
            return <li key={item.id}><span className="ls-bar-label">{item.q || item.id}</span><span className="ls-bar bad"><span style={{ width: `${(item.wrong / Math.max(1, total)) * 100}%` }} /></span><b>{item.wrong}/{total}</b></li>;
          })}</ul>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Lesson builder: modular blocks, no programming                       */
/* ------------------------------------------------------------------ */
export function LessonBuilder({ topic, language, initial, onSaved }: { topic: CourseTopic; language: Language; initial: LessonContent | null; onSaved: () => void }) {
  const [draft, setDraft] = useState<LessonContent>(() => ({ ...EMPTY, ...(initial ?? {}), intro: { ...EMPTY.intro, ...(initial?.intro ?? {}) } }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (initial) setDraft({ ...EMPTY, ...initial, intro: { ...EMPTY.intro, ...initial.intro } }); }, [initial]);
  const patch = (value: Partial<LessonContent>) => { setDraft((current) => ({ ...current, ...value })); setMessage(''); };
  const setBlock = (id: string, value: Partial<LessonBlock>) => patch({ blocks: draft.blocks.map((block) => (block.id === id ? { ...block, ...value } as LessonBlock : block)) });
  const setQuestion = (id: string, value: Partial<LessonQuestion>) => patch({ questions: draft.questions.map((item) => (item.id === id ? { ...item, ...value } : item)) });
  const addBlock = (kind: LessonBlock['kind']) => patch({ blocks: [...draft.blocks, kind === 'text' ? { id: uid(), kind, title: '', text: '' } : { id: uid(), kind, title: '', url: '' }] });
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const clean: LessonContent = {
        ...draft,
        blocks: draft.blocks.filter((block) => (block.kind === 'text' ? block.text.trim() : block.url.trim())),
        questions: draft.questions.map((item) => ({ ...item, choices: item.choices.map((choice) => choice.trim()) })).filter((item) => item.prompt.trim() && item.choices.filter(Boolean).length >= 2)
          .map((item) => { const choices = item.choices.filter(Boolean); return { ...item, choices, correct: Math.min(item.correct, choices.length - 1) }; }),
      };
      await customFetch(`/api/me/lesson-content/${topic.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: clean }) });
      setMessage(t(language, 'Saqlandi. O‘quvchilar darsda ko‘radi.', 'Сохранено. Ученики увидят это в уроке.', 'Saved. Pupils will see it in the lesson.'));
      onSaved();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ls-builder">
      <p className="muted">{t(language, `§${topic.code} «${topic.title}» darsiga o‘z materiallaringizni qo‘shing. Darslik matni, 3D va savollar o‘z joyida qoladi.`, `Добавьте свои материалы к уроку §${topic.code} «${topic.title}». Текст учебника, 3D и вопросы остаются на месте.`, `Add your own materials to §${topic.code} “${topic.title}”. The textbook, 3D and questions stay.`)}</p>

      <div className="ls-builder-block">
        <h4>1 · {t(language, 'Kirish', 'Вступление', 'Intro')}</h4>
        <input className="input" value={draft.intro.title} maxLength={140} onChange={(event) => patch({ intro: { ...draft.intro, title: event.target.value } })} placeholder={t(language, 'Sarlavha (masalan: Laboratoriyaga xush kelibsiz!)', 'Заголовок (например: Добро пожаловать в лабораторию!)', 'Title (e.g. Welcome to the lab!)')} />
        <textarea className="input" rows={2} value={draft.intro.text} maxLength={1500} onChange={(event) => patch({ intro: { ...draft.intro, text: event.target.value } })} placeholder={t(language, 'Vaziyat yoki savol bilan boshlang…', 'Начните с ситуации или вопроса…', 'Start with a situation or a question…')} />
      </div>

      <div className="ls-builder-block">
        <h4>1–2 · {t(language, 'Materiallar', 'Материалы', 'Materials')}</h4>
        {draft.blocks.map((block) => (
          <div key={block.id} className="ls-builder-item">
            <span className="tag">{block.kind === 'text' ? <><Type size={12} /> {t(language, 'Matn', 'Текст', 'Text')}</> : block.kind === 'video' ? <><Video size={12} /> {t(language, 'Video', 'Видео', 'Video')}</> : block.kind === 'image' ? <><ImageIcon size={12} /> {t(language, 'Rasm', 'Картинка', 'Picture')}</> : <><Box size={12} /> 3D</>}</span>
            <input className="input" value={block.title} maxLength={140} onChange={(event) => setBlock(block.id, { title: event.target.value })} placeholder={t(language, 'Nomi', 'Название', 'Title')} />
            {block.kind === 'text'
              ? <textarea className="input" rows={3} value={block.text} maxLength={3000} onChange={(event) => setBlock(block.id, { text: event.target.value })} placeholder={t(language, 'Tushuntirish, misol, qoida…', 'Объяснение, пример, правило…', 'Explanation, example, rule…')} />
              : block.kind === 'image'
                ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input className="input" value={block.url.startsWith('data:') ? '' : block.url} onChange={(event) => setBlock(block.id, { url: event.target.value })} placeholder="https://…" />
                  <label className="btn small"><ImageIcon size={13} /> {t(language, 'Fayldan', 'С устройства', 'From device')}<input type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void compressImage(file).then((url) => setBlock(block.id, { url })).catch(() => setError(t(language, 'Rasmni o‘qib bo‘lmadi.', 'Не удалось прочитать картинку.', 'Could not read the picture.'))); }} /></label>
                  {block.url && <img src={block.url} alt="" className="ls-builder-thumb" />}
                </div>
                : <input className="input" value={block.url} onChange={(event) => setBlock(block.id, { url: event.target.value })} placeholder={block.kind === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://sketchfab.com/3d-models/…'} />}
            <button type="button" className="btn small danger" onClick={() => patch({ blocks: draft.blocks.filter((item) => item.id !== block.id) })} aria-label={t(language, 'O‘chirish', 'Удалить', 'Delete')}><Trash2 size={13} /></button>
          </div>
        ))}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => addBlock('text')}><Type size={13} /> {t(language, 'Matn', 'Текст', 'Text')}</button>
          <button type="button" className="btn small" onClick={() => addBlock('image')}><ImageIcon size={13} /> {t(language, 'Rasm', 'Картинка', 'Picture')}</button>
          <button type="button" className="btn small" onClick={() => addBlock('video')}><Video size={13} /> {t(language, 'Video', 'Видео', 'Video')}</button>
          <button type="button" className="btn small" onClick={() => addBlock('model')}><Box size={13} /> {t(language, '3D havola', '3D-ссылка', '3D link')}</button>
        </div>
      </div>

      <div className="ls-builder-block">
        <h4>4 · {t(language, 'O‘z savollaringiz', 'Свои вопросы', 'Your questions')}</h4>
        {draft.questions.map((item, number) => (
          <div key={item.id} className="ls-builder-question">
            <div className="row" style={{ gap: 6 }}>
              <b>{number + 1}.</b>
              <input className="input" value={item.prompt} maxLength={500} onChange={(event) => setQuestion(item.id, { prompt: event.target.value })} placeholder={t(language, 'Savol', 'Вопрос', 'Question')} />
              <button type="button" className="btn small danger" onClick={() => patch({ questions: draft.questions.filter((other) => other.id !== item.id) })} aria-label={t(language, 'O‘chirish', 'Удалить', 'Delete')}><Trash2 size={13} /></button>
            </div>
            {item.choices.map((choice, index) => (
              <label key={index} className="ls-builder-choice">
                <input type="radio" name={`correct-${item.id}`} checked={item.correct === index} onChange={() => setQuestion(item.id, { correct: index })} />
                <input className="input" value={choice} maxLength={200} onChange={(event) => setQuestion(item.id, { choices: item.choices.map((other, at) => (at === index ? event.target.value : other)) })} placeholder={`${String.fromCharCode(65 + index)}${item.correct === index ? ` · ${t(language, 'to‘g‘ri', 'верный', 'right')}` : ''}`} />
              </label>
            ))}
            {item.choices.length < 6 && <button type="button" className="btn small" onClick={() => setQuestion(item.id, { choices: [...item.choices, ''] })}><Plus size={12} /> {t(language, 'Variant', 'Вариант', 'Option')}</button>}
            <input className="input" value={item.explain} maxLength={600} onChange={(event) => setQuestion(item.id, { explain: event.target.value })} placeholder={t(language, 'Nega to‘g‘ri — tushuntirish', 'Почему так — объяснение', 'Why — explanation')} />
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => patch({ questions: [...draft.questions, { id: uid(), prompt: '', choices: ['', '', ''], correct: 0, explain: '' }] })}><Plus size={13} /> {t(language, 'Savol qo‘shish', 'Добавить вопрос', 'Add a question')}</button>
      </div>

      <div className="ls-builder-block">
        <h4>{t(language, 'Vaqt (daqiqa)', 'Время этапов (мин)', 'Stage timing (min)')}</h4>
        <div className="ls-builder-minutes">
          {STAGES.map((item, index) => item.hidden ? null : (
            <label key={item.n}><small>{stepOf(item.n)}. {tx(language, item.title)}</small>
              <input className="input" type="number" min={0} max={45} value={draft.minutes[index] ?? item.minutes} onChange={(event) => { const minutes = STAGES.map((stage, at) => draft.minutes[at] ?? stage.minutes); minutes[index] = Math.max(0, Math.min(45, Number(event.target.value) || 0)); patch({ minutes }); }} />
            </label>
          ))}
        </div>
      </div>

      <div className="ls-builder-block">
        <h4>6 · {t(language, 'Uy vazifasi', 'Домашнее задание', 'Homework')}</h4>
        <textarea className="input" rows={2} value={draft.homework} maxLength={1500} onChange={(event) => patch({ homework: event.target.value })} placeholder={topic.homework} />
        <small className="muted">{t(language, 'Bo‘sh qolsa — darslikdagi vazifa.', 'Пусто — задание из учебника.', 'Empty — the textbook task.')}</small>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Save size={14} /> {busy ? '…' : t(language, 'Saqlash', 'Сохранить урок', 'Save the lesson')}</button>
      </div>
      {message && <div className="notice good" role="status"><CheckCircle2 size={14} /> {message}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
