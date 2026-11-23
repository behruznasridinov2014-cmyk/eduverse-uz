import { PracticeTest } from './practice-test';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { Check, Trophy, X } from 'lucide-react';
import { SUBJECT_LABEL, type CourseBook, type CourseTopic } from './course-data';
import { bookForLesson, statusOf, topicForLesson, useLessonCourses, useToday, type TodayLesson } from './today';
import type { Language, SchoolData } from './school-data';

/* Daily trainer: tests on the topics of today's lessons, four answers to choose from. */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Question = { q: string; options: string[]; answer: string; topic: string; explain?: string };
/** The first sentence of the topic, short: a little hint, not the answer. */
const shortHint = (topic: CourseTopic) => { const first = (topic.essence ?? '').split(/(?<=[.!?])\s/)[0] ?? ''; return first.length > 150 ? `${first.slice(0, first.lastIndexOf(' ', 140))}…` : first; };

/** Small deterministic random: the same questions for the whole class on one day. */
function seeded(seed: number) {
  let value = seed % 2147483647 || 1;
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
}
function hash(text: string) { let h = 0; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

/** The answer with one number changed the way pupils usually slip: ×2, ÷2, ±10 %, a sign. */
function numberSlips(answer: string, random: () => number): string[] {
  const matches = [...answer.matchAll(/-?\d+(?:[.,]\d+)?/g)];
  if (matches.length === 0) return [];
  const target = matches[matches.length - 1];
  const raw = target[0];
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value === 0) return [];
  const decimals = raw.includes(',') || raw.includes('.') ? (raw.split(/[.,]/)[1]?.length ?? 0) : 0;
  const fmt = (n: number) => (decimals ? n.toFixed(decimals) : String(Math.round(n))).replace('.', raw.includes(',') ? ',' : '.');
  const candidates = [value * 2, value / 2, value * 1.1, value * 0.9, -value, value + 10].map(fmt).filter((text, index, all) => text !== raw && all.indexOf(text) === index);
  return candidates.map((text) => ({ text, key: random() })).sort((x, y) => x.key - y.key).slice(0, 2)
    .map(({ text }) => answer.slice(0, target.index) + text + answer.slice((target.index ?? 0) + raw.length));
}

/** Sentences of a topic: essence, facts, "in life". */
function sentencesOf(topic: CourseTopic): string[] {
  const text = [topic.essence, ...topic.facts, topic.life].join(' ');
  return text.split(/(?<=[.!?])\s+/u).map((item) => item.trim()).filter((item) => item.length >= 25 && item.length <= 170);
}
const WORD = /[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ‘ʼ'-]{6,}/gu;

/** "Fill in the missing word" from a sentence of the topic; the other options are words of the same book. */
function clozeQuestions(book: CourseBook, topic: CourseTopic, random: () => number, language: Language): Question[] {
  const pool = [...new Set(book.topics.flatMap((item) => sentencesOf(item).flatMap((sentence) => sentence.match(WORD) ?? [])).map((word) => word.toLowerCase()))];
  const out: Question[] = [];
  for (const sentence of sentencesOf(topic)) {
    const words = (sentence.match(WORD) ?? []).filter((word) => !/^[A-ZА-ЯЁ]/.test(word) || sentence.indexOf(word) > 0);
    if (!words.length) continue;
    const answer = words.map((word) => ({ word, key: word.length + random() * 4 })).sort((a, b) => b.key - a.key)[0]!.word;
    const lower = answer.toLowerCase();
    const wrong = pool.filter((word) => word !== lower && Math.abs(word.length - lower.length) <= 4 && word.slice(-2) === lower.slice(-2))
      .concat(pool.filter((word) => word !== lower))
      .filter((word, index, all) => all.indexOf(word) === index)
      .map((word) => ({ word, key: random() })).sort((a, b) => a.key - b.key).slice(0, 3).map((item) => item.word);
    if (wrong.length < 3) continue;
    const options = [lower, ...wrong].map((value) => ({ value, key: random() })).sort((a, b) => a.key - b.key).map((item) => item.value);
    out.push({
      q: `${t(language, 'Tushirib qoldirilgan so‘zni tanlang', 'Вставьте пропущенное слово', 'Fill in the missing word')}: «${sentence.replace(answer, '_____')}»`,
      options, answer: lower, topic: `§${topic.code} ${topic.title}`, explain: sentence,
    });
  }
  return out.map((item) => ({ item, key: random() })).sort((a, b) => a.key - b.key).map((row) => row.item);
}

/**
 * 8 questions on the topic of the lesson: its tasks, then "missing word" questions on its text,
 * and only if still short, tasks of earlier topics of the same book.
 */
function testQuestions(book: CourseBook, topic: CourseTopic, seed: string, language: Language, count = 8): Question[] {
  const index = book.topics.findIndex((item) => item.key === topic.key);
  const all = book.topics.flatMap((item) => item.tasks.map((task) => ({ ...task, key: item.key, chapter: item.chapter, topic: `§${item.code} ${item.title}` }))).filter((task) => task.a.length <= 140);
  const random = seeded(hash(seed));
  const toQuestion = (task: (typeof all)[number]): Question => {
    const wrong: string[] = [];
    for (const variant of numberSlips(task.a, random)) if (wrong.length < 3 && variant !== task.a && !wrong.includes(variant)) wrong.push(variant);
    const near = [
      ...all.filter((item) => item.key === task.key && item.a !== task.a),
      ...all.filter((item) => item.key !== task.key && item.chapter === task.chapter && item.a !== task.a),
      ...all.filter((item) => item.chapter !== task.chapter && item.a !== task.a),
    ].map((item) => item.a);
    for (const candidate of near) if (wrong.length < 3 && !wrong.includes(candidate)) wrong.push(candidate);
    const options = [task.a, ...wrong].map((value) => ({ value, key: random() })).sort((a, b) => a.key - b.key).map((item) => item.value);
    return { q: task.q, options, answer: task.a, topic: task.topic };
  };
  const shuffled = (key: string) => all.filter((task) => task.key === key).map((task) => ({ task, key: random() })).sort((a, b) => a.key - b.key).map((row) => row.task);
  const picked: Question[] = shuffled(topic.key).map(toQuestion);
  for (const question of clozeQuestions(book, topic, random, language)) if (picked.length < count) picked.push(question);
  for (const earlier of book.topics.slice(0, Math.max(0, index)).reverse()) {
    if (picked.length >= count) break;
    for (const task of shuffled(earlier.key)) if (picked.length < count) picked.push(toQuestion(task));
  }
  return picked.slice(0, count);
}
const progressKey = (userId: string) => `eduverse:trainer:${userId}`;
type Progress = { id: string; step: number; score: number; chosen: string | null; checked: boolean };

type Test = { id: string; day: string; subject: string; classId: string; book: CourseBook; topic: CourseTopic; until: number; isToday: boolean };

/**
 * Trainer: one test of 8 questions for each textbook subject of today's lessons (after the
 * lesson starts). A missed test can be done within 24 hours of the lesson. Done tests disappear.
 */
export function TrainerPage({ user, language }: { user: User; school: SchoolData; language: Language }) {
  const { data, now } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.prev ? [data.prev] : undefined);
  const isStudent = user.role === 'student';
  const [done, setDone] = useState<Record<string, { score: number; total: number }> | null>(null);
  const days = data ? [data.date, data.prev?.date].filter(Boolean).join(',') : '';
  const loadDone = useCallback(() => {
    if (!days || !isStudent) { setDone({}); return; }
    void customFetch<{ tests: Array<{ day: string; subject: string; score: number; total: number }> }>(`/api/trainer/tests?days=${days}`, { method: 'GET' })
      .then((response) => setDone(Object.fromEntries(response.tests.map((row) => [`${row.day}:${row.subject}`, row]))))
      .catch(() => setDone({}));
  }, [days, isStudent]);
  useEffect(() => { loadDone(); }, [loadDone]);

  const tests = useMemo<Test[]>(() => {
    if (!data) return [];
    const out: Test[] = [];
    const add = (lesson: TodayLesson, day: string, isToday: boolean) => {
      const book = bookForLesson(lesson);
      if (!book) return;
      if (isToday && statusOf(lesson, now) === 'upcoming') return;
      const until = Date.parse(lesson.endsAt) + 24 * 3600000;
      if (!isToday && until < now) return;
      const id = `${day}:${book.subject}`;
      if (out.some((test) => test.id === id)) return;
      const topic = topicForLesson(lesson, courses[lesson.classId], day);
      if (!topic) return;
      out.push({ id, day, subject: book.subject, classId: lesson.classId, book, topic, until, isToday });
    };
    for (const lesson of data.lessons) add(lesson, data.date, true);
    for (const lesson of data.prev?.lessons ?? []) add(lesson, data.prev!.date, false);
    return out;
  }, [data, courses, now]);
  const pending = done ? tests.filter((test) => !done[test.id]) : [];

  const [asking, setAsking] = useState<Test | null>(null);
  const [active, setActive] = useState<Test | null>(null);
  const questions = useMemo(() => (active ? testQuestions(active.book, active.topic, `${active.id}:${user.id}`, language) : []), [active, user.id, language]);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  const [checked, setChecked] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  // A test in progress survives a closed tab: the place, the score and the open answer are kept on the device.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored || !done || !tests.length || active) return;
    setRestored(true);
    try {
      const raw = localStorage.getItem(progressKey(user.id));
      const saved = raw ? JSON.parse(raw) as Progress : null;
      const test = saved ? tests.find((item) => item.id === saved.id && !done[item.id]) : null;
      if (test && saved) { setActive(test); setStep(saved.step); setScore(saved.score); setChosen(saved.chosen); setChecked(saved.checked); }
    } catch { /* private mode */ }
  }, [restored, done, tests, active, user.id]);
  useEffect(() => {
    try {
      if (active && !result) localStorage.setItem(progressKey(user.id), JSON.stringify({ id: active.id, step, score, chosen, checked } satisfies Progress));
      else if (result || (!active && restored)) localStorage.removeItem(progressKey(user.id));
    } catch { /* private mode */ }
  }, [active, step, score, chosen, checked, result, restored, user.id]);

  // The lesson topics arrive a moment after the tests: keep the open test on the real topic of the lesson.
  useEffect(() => {
    if (!active) return;
    const fresh = tests.find((item) => item.id === active.id);
    if (fresh && fresh.topic.key !== active.topic.key) setActive(fresh);
  }, [tests, active]);

  function start(test: Test) { setAsking(null); setActive(test); setStep(0); setChosen(null); setChecked(false); setHintOpen(false); setScore(0); setResult(null); }
  function back() { setAsking(null); setActive(null); setResult(null); loadDone(); }
  function reveal() {
    if (chosen === null || checked) return;
    setChecked(true);
    window.setTimeout(() => document.querySelector('.answer-feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    if (chosen === questions[step].answer) setScore(score + 1);
  }
  async function next() {
    if (!checked || !active) return;
    const total = score;
    setHintOpen(false);
    if (step + 1 < questions.length) { setStep(step + 1); setChosen(null); setChecked(false); return; }
    setResult({ score: total, total: questions.length });
    if (isStudent) {
      await customFetch('/api/trainer/tests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: active.day, subject: active.subject, topicKey: active.topic.key, score: total, total: questions.length }) }).catch(() => {});
    }
  }
  const subjectName = (subject: string) => { const label = SUBJECT_LABEL[subject as keyof typeof SUBJECT_LABEL]; return label ? t(language, label[0], label[1], label[2]) : subject; };
  const untilText = (test: Test) => {
    const time = new Date(test.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
    return test.isToday ? t(language, `Ertaga ${time} gacha`, `До завтра, ${time}`, `Until tomorrow ${time}`) : t(language, `Kechagi dars · bugun ${time} gacha`, `Вчерашний урок · до ${time}`, `Yesterday’s lesson · until ${time}`);
  };

  const question = questions[step];
  const loading = !data || done === null;
  return (
    <section className="trainer">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t(language, 'KUNLIK TRENAJYOR', 'ТРЕНАЖЁР ДНЯ', 'DAILY TRAINER')}</div>
          <h1>{t(language, 'Bugungi darslar bo‘yicha test', 'Тесты по сегодняшним урокам', 'Tests on today’s lessons')}</h1>
          <p className="page-subtitle">{t(language, 'Har bir fandan 8 ta savol, faqat darsda o‘tilgan mavzu bo‘yicha.', 'По каждому предмету 8 вопросов — только по теме, которую прошли на уроке.', '8 questions per subject, only on the topic of the lesson.')}</p>
        </div>
      </div>
      {isStudent && <PracticeTest userId={user.id} language={language} />}

      {loading ? (
        <div className="trainer-loading" role="status" aria-label={t(language, 'Yuklanmoqda', 'Загрузка', 'Loading')}>
          <span className="trainer-loading-dots"><i /><i /><i /></span>
          <div className="today-skeleton" />
          <div className="today-skeleton" />
        </div>
      ) : active ? (
        result ? (
          <div className="panel trainer-result trainer-pop">
            <Trophy size={30} />
            <h2>{result.score} / {result.total}</h2>
            <p className="muted">{result.score >= Math.ceil(result.total * 0.75)
              ? t(language, 'Zo‘r! O‘qituvchi baho qo‘yganda buni ko‘radi.', 'Отлично! Учитель увидит это, когда будет ставить оценку.', 'Great! The teacher sees it when grading.')
              : t(language, 'Natija saqlandi. O‘qituvchi ko‘radi.', 'Результат сохранён, учитель его увидит.', 'Saved. The teacher will see it.')}</p>
            <button type="button" className="btn primary" onClick={back}>{t(language, 'Testlarga qaytish', 'К тестам', 'Back to tests')}</button>
          </div>
        ) : question ? (
          <div className="panel trainer-card trainer-pop" key={step}>
            <div className="trainer-progress"><span style={{ width: `${(step / questions.length) * 100}%` }} /></div>
            <small className="muted">{subjectName(active.subject)} · {step + 1} / {questions.length} · {question.topic}</small>
            <h2>{question.q}</h2>
            <div className="trainer-options">
              {question.options.map((option) => {
                const state = !checked ? (chosen === option ? 'picked' : '') : option === question.answer ? 'right' : option === chosen ? 'wrong' : 'dim';
                return (
                  <button type="button" key={option} className={`trainer-option ${state}`} disabled={checked} onClick={() => setChosen(option)}>
                    {state === 'right' ? <Check size={15} /> : state === 'wrong' ? <X size={15} /> : null} {option}
                  </button>
                );
              })}
            </div>
            {!checked && (hintOpen
              ? <p className="practice-hint">💡 {shortHint(active.topic)}</p>
              : <button type="button" className="btn small" onClick={() => setHintOpen(true)}>💡 {t(language, 'Biroz maslahat', 'Немного подсказки', 'A little hint')}</button>)}
            {!checked ? (
              <button type="button" className="btn primary" disabled={chosen === null} onClick={reveal}>{t(language, 'Javobni bilish', 'Узнать ответ', 'Check the answer')}</button>
            ) : (
              <div className={`answer-feedback ${chosen === question.answer ? 'ok' : 'no'}`} role="status">
                <b>{chosen === question.answer ? `✅ ${t(language, 'To‘g‘ri!', 'Верно!', 'Correct!')}` : `❌ ${t(language, 'Noto‘g‘ri', 'Неверно', 'Not quite')}`}</b>
                {chosen !== question.answer && <p>{t(language, 'To‘g‘ri javob', 'Верный ответ', 'Correct answer')}: <b>{question.answer}</b></p>}
                <p className="muted">💡 {question.explain ?? shortHint(active.topic)}</p>
                <button type="button" className="btn primary" onClick={() => void next()}>
                  {step + 1 < questions.length ? t(language, 'Keyingisi', 'Дальше', 'Next') : t(language, 'Yakunlash', 'Завершить', 'Finish')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="panel"><p className="muted">{t(language, 'Bu mavzu uchun savollar hali yo‘q.', 'Для этой темы вопросов пока нет.', 'No questions for this topic yet.')}</p><button type="button" className="btn" onClick={back}>{t(language, 'Orqaga', 'Назад', 'Back')}</button></div>
        )
      ) : !isStudent ? (
        <div className="empty-state"><span className="empty-icon"><Trophy /></span><h2>{t(language, 'Trenajyor o‘quvchilar uchun', 'Тренажёр — для учеников', 'The trainer is for students')}</h2><p>{t(language, 'Natijalar jurnalda, o‘quvchi ismi yonida.', 'Результаты видны в журнале, рядом с именем ученика.', 'Results are in the journal, next to each name.')}</p></div>
      ) : pending.length === 0 ? (
        <div className="empty-state trainer-pop">
          <span className="empty-icon"><Trophy /></span>
          <h2>{tests.length ? t(language, 'Hamma testlar bajarildi', 'Все тесты сделаны', 'All tests done') : t(language, 'Hozircha test yo‘q', 'Пока тестов нет', 'No tests yet')}</h2>
          <p>{tests.length ? t(language, 'Ertaga yangi darslar — yangi testlar.', 'Завтра новые уроки — новые тесты.', 'New lessons tomorrow — new tests.') : t(language, 'Test dars boshlangach chiqadi.', 'Тест появится, когда начнётся урок.', 'A test appears when the lesson starts.')}</p>
        </div>
      ) : (
        <div className="trainer-tests">
          {pending.map((test, index) => (
            <button type="button" key={test.id} className={`trainer-test ${asking?.id === test.id ? 'open' : ''}`} style={{ animationDelay: `${index * 60}ms` }} onClick={() => setAsking(asking?.id === test.id ? null : test)}>
              <span className="trainer-test-top"><b>{subjectName(test.subject)}</b><small className={test.isToday ? 'muted' : 'trainer-late'}>{untilText(test)}</small></span>
              <span>§{test.topic.code} {test.topic.title}</span>
              <small className="muted">{t(language, '8 ta savol', '8 вопросов', '8 questions')}</small>
            </button>
          ))}
        </div>
      )}

      {asking && !active && (
        <div className="trainer-ask-backdrop" role="presentation" onClick={() => setAsking(null)}>
          <div className="panel trainer-ask" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>{t(language, 'Testni boshlaysizmi?', 'Пройти тест?', 'Start the test?')}</h2>
            <p>{subjectName(asking.subject)} · §{asking.topic.code} {asking.topic.title}</p>
            <p className="muted">{t(language, '8 ta savol. Bir martada oxirigacha bajaring.', '8 вопросов. Пройдите до конца за один раз.', '8 questions. Finish in one go.')}</p>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" onClick={() => start(asking)}>{t(language, 'Ha', 'Да', 'Yes')}</button>
              <button type="button" className="btn" onClick={() => setAsking(null)}>{t(language, 'Yo‘q', 'Нет', 'No')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
