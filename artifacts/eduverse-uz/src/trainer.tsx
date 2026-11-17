import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { Check, Trophy, X, Zap } from 'lucide-react';
import { COURSE } from './course-data';
import type { Language, SchoolData } from './school-data';

/*
 * Daily trainer: five questions a day from the pupil's own textbooks, with four
 * answers to choose from. The class rating sums the last seven days.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Question = { q: string; options: string[]; answer: string; topic: string };
type RatingRow = { userId: string; name: string; points: number; days: number; me: boolean };

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

function todayQuestions(grade: number, day: string): Question[] {
  const books = COURSE.filter((book) => book.grade === grade);
  const pool = books.flatMap((book) => book.topics.flatMap((topic) => topic.tasks.map((task) => ({ ...task, topic: `${book.title} · §${topic.code}`, book: book.id, chapter: topic.chapter, key: topic.key }))))
    .filter((task) => task.a.length <= 140);
  if (pool.length < 4) return [];
  const random = seeded(hash(`${day}:${grade}`));
  const picked: typeof pool = [];
  const used = new Set<number>();
  while (picked.length < Math.min(5, pool.length) && used.size < pool.length) {
    const index = Math.floor(random() * pool.length);
    if (used.has(index)) continue;
    used.add(index);
    picked.push(pool[index]);
  }
  return picked.map((task) => {
    // Plausible wrong answers: the same answer with a slipped number first,
    // then answers from the same topic and chapter, the rest of the book last.
    const wrong: string[] = [];
    for (const variant of numberSlips(task.a, random)) if (wrong.length < 3 && variant !== task.a && !wrong.includes(variant)) wrong.push(variant);
    const near = [
      ...pool.filter((item) => item.key === task.key && item.a !== task.a),
      ...pool.filter((item) => item.key !== task.key && item.chapter === task.chapter && item.a !== task.a),
      ...pool.filter((item) => item.book === task.book && item.chapter !== task.chapter && item.a !== task.a),
    ].map((item) => item.a);
    for (const candidate of near) if (wrong.length < 3 && !wrong.includes(candidate)) wrong.push(candidate);
    const options = [task.a, ...wrong].map((value) => ({ value, key: random() })).sort((a, b) => a.key - b.key).map((item) => item.value);
    return { q: task.q, options, answer: task.a, topic: task.topic };
  });
}

export function TrainerPage({ user, school, language }: { user: User; school: SchoolData; language: Language }) {
  const grade = school.classes[0]?.grade ?? 7;
  const day = new Date().toISOString().slice(0, 10);
  const questions = useMemo(() => todayQuestions(grade, day), [grade, day]);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [rating, setRating] = useState<RatingRow[]>([]);
  const [doneToday, setDoneToday] = useState(false);
  const isStudent = user.role === 'student';

  const loadRating = useCallback(() => {
    const classId = school.classes.find((item) => item.grade === grade)?.id ?? school.classes[0]?.id;
    void customFetch<{ rating: RatingRow[]; doneToday: boolean }>(`/api/trainer/rating${!isStudent && classId ? `?classId=${classId}` : ''}`, { method: 'GET' })
      .then((data) => { setRating(data.rating); setDoneToday(data.doneToday); }).catch(() => {});
  }, [school.classes, grade, isStudent]);
  useEffect(() => { loadRating(); }, [loadRating]);

  async function next() {
    if (chosen === null) return;
    const gained = chosen === questions[step].answer ? 1 : 0;
    const total = score + gained;
    setScore(total);
    if (step + 1 < questions.length) { setStep(step + 1); setChosen(null); return; }
    setFinished(true);
    if (isStudent) {
      await customFetch('/api/trainer/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: total, total: questions.length }) }).catch(() => {});
      loadRating();
    }
  }

  const question = questions[step];
  return (
    <section className="trainer">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t(language, 'KUNLIK TRENAJYOR', 'ТРЕНАЖЁР ДНЯ', 'DAILY TRAINER')} · {t(language, `${grade}-sinf`, `${grade} класс`, `Grade ${grade}`)}</div>
          <h1>{t(language, 'Bugungi 5 savol', '5 вопросов дня', 'Today’s 5 questions')}</h1>
          <p className="page-subtitle">{t(language, 'Har kuni yangi savollar. Birinchi urinish reytingga kiradi.', 'Каждый день новые вопросы по вашим учебникам. В рейтинг класса идёт первая попытка дня.', 'New questions every day. The first try counts.')}</p>
        </div>
      </div>
      {questions.length === 0 ? <div className="panel"><p className="muted">{t(language, 'Bu sinf uchun savollar hali yo‘q.', 'Для этого класса вопросов пока нет.', 'No questions for this grade yet.')}</p></div>
        : finished ? (
          <div className="panel trainer-result">
            <Trophy size={28} />
            <h2>{score} / {questions.length}</h2>
            <p className="muted">{doneToday && isStudent ? t(language, 'Natija reytingga kiritildi.', 'Результат в рейтинге класса. Завтра — новые вопросы.', 'Counted in the class rating.') : ''}</p>
          </div>
        ) : (
          <div className="panel trainer-card">
            <div className="trainer-progress"><span style={{ width: `${(step / questions.length) * 100}%` }} /></div>
            <small className="muted">{step + 1} / {questions.length} · {question.topic}</small>
            <h2>{question.q}</h2>
            <div className="trainer-options">
              {question.options.map((option) => {
                const state = chosen === null ? '' : option === question.answer ? 'right' : option === chosen ? 'wrong' : '';
                return (
                  <button type="button" key={option} className={`trainer-option ${state}`} disabled={chosen !== null} onClick={() => setChosen(option)}>
                    {state === 'right' ? <Check size={15} /> : state === 'wrong' ? <X size={15} /> : null} {option}
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn primary" disabled={chosen === null} onClick={() => void next()}>
              {step + 1 < questions.length ? t(language, 'Keyingisi', 'Дальше', 'Next') : t(language, 'Yakunlash', 'Завершить', 'Finish')}
            </button>
          </div>
        )}
      <section className="panel">
        <h2><Zap size={16} /> {t(language, 'Sinf reytingi · 7 kun', 'Рейтинг класса · 7 дней', 'Class rating · 7 days')}</h2>
        {rating.length === 0 ? <p className="muted">{t(language, 'Hali hech kim o‘ynamadi.', 'Пока никто не проходил.', 'Nobody yet.')}</p> : (
          <ol className="trainer-rating">
            {rating.map((row) => <li key={row.userId} className={row.me ? 'me' : ''}><span>{row.name}</span><b>{row.points}</b><small className="muted">{row.days} {t(language, 'kun', 'дн.', 'days')}</small></li>)}
          </ol>
        )}
      </section>
    </section>
  );
}
