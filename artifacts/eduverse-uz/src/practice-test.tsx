import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import type { Language } from './school-data';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';
import { Protected } from './ui/protect';

/*
 * "My test": 5 questions made for this pupil on the topics they find hard (low journal marks,
 * weak trainer results). One question at a time; the progress is kept on the device, so closing
 * the page does not lose it.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Question = { prompt: string; choices: string[]; correct: number; hint: string };
/** `picked` = chosen but not checked yet; `revealed` = checked, the feedback is on screen. Kept on the device. */
type Saved = { topics: Array<{ subject: string; title: string }>; questions: Question[]; answers: number[]; day: string; picked?: number | null; revealed?: boolean; subject?: string };

const today = () => new Date().toISOString().slice(0, 10);
const SUBJECTS: Array<[string, [string, string, string]]> = [
  ['', ['Hammasi', 'Любой', 'Any']], ['math', ['Matematika', 'Математика', 'Maths']], ['physics', ['Fizika', 'Физика', 'Physics']],
  ['chemistry', ['Kimyo', 'Химия', 'Chemistry']], ['biology', ['Biologiya', 'Биология', 'Biology']],
];

export function PracticeTest({ userId, language }: { userId: string; language: Language }) {
  const key = `eduverse:practice:${userId}`;
  const [saved, setSaved] = useState<Saved | null>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
  });
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try { if (saved) localStorage.setItem(key, JSON.stringify(saved)); else localStorage.removeItem(key); } catch { /* private mode */ }
  }, [key, saved]);

  async function create() {
    setBusy(true); setError('');
    try {
      const lang = language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru';
      const data = await customFetch<{ topics: Saved['topics']; questions: Question[] }>('/api/me/practice-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, ...(subject ? { subject } : {}) }) });
      setSaved({ topics: data.topics, questions: data.questions, answers: [], day: today(), picked: null, revealed: false, subject });
      setHint(false);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const revealed = Boolean(saved?.revealed);
  // While the feedback is shown, the question on screen is the one just answered.
  const step = saved ? saved.answers.length - (revealed ? 1 : 0) : 0;
  const finished = saved ? !revealed && saved.answers.length >= saved.questions.length : false;
  const question = saved && !finished ? saved.questions[step] : null;
  const given = revealed && saved ? saved.answers[step] : null;
  const right = saved ? saved.answers.filter((answer, index) => answer === saved.questions[index]?.correct).length : 0;

  const check = () => { if (!saved || saved.picked === null || saved.picked === undefined) return; setSaved({ ...saved, answers: [...saved.answers, saved.picked], picked: null, revealed: true }); window.setTimeout(() => document.querySelector('.practice-test .answer-feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); };
  const next = () => { if (!saved) return; setHint(false); setSaved({ ...saved, revealed: false }); };

  return (
    <Protected className="panel practice-test">
      <div className="section-head">
        <h2><Sparkles size={16} /> {t(language, 'Mening testim', 'Мой тест', 'My test')}</h2>
        {saved && <button type="button" className="btn small" onClick={() => setSaved(null)} aria-label={t(language, 'Yangi test', 'Новый тест', 'New test')}><RotateCcw size={14} /></button>}
      </div>
      {!saved && (
        <>
          <p className="muted">{t(language, 'Fanni tanlang — 5 ta savol qiyin mavzular bo‘yicha, faqat siz uchun.', 'Выберите предмет — 5 вопросов по темам, которые даются труднее, только для вас.', 'Pick a subject — 5 questions on the topics you find harder, just for you.')}</p>
          <div className="row practice-subjects">
            {SUBJECTS.map(([value, label]) => (
              <button type="button" key={value || 'any'} className={`studio-tab ${subject === value ? 'active' : ''}`} onClick={() => setSubject(value)}>{t(language, ...label)}</button>
            ))}
          </div>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>{busy ? t(language, 'Tayyorlanmoqda…', 'Готовим…', 'Preparing…') : t(language, 'Testni boshlash', 'Начать тест', 'Start the test')}</button>
          {busy && <LoadingBlock language={language} kind="inline" />}
        </>
      )}
      {saved && (
        <p className="muted practice-topics">{saved.topics.map((topic) => topic.title).join(' · ')}</p>
      )}
      {saved && !finished && question && (
        <div className="practice-question" key={step}>
          <div className="test-progress"><span style={{ width: `${((step + (revealed ? 1 : 0)) / saved.questions.length) * 100}%` }} /></div>
          <small className="muted">{step + 1} / {saved.questions.length}</small>
          <h3>{question.prompt}</h3>
          <div className="practice-choices">
            {question.choices.map((choice, index) => {
              const state = !revealed ? (saved.picked === index ? 'picked' : '') : index === question.correct ? 'right' : index === given ? 'wrong' : 'dim';
              return (
                <button type="button" key={index} className={`answer-choice ${state}`} disabled={revealed} onClick={() => setSaved({ ...saved, picked: index })}>
                  {state === 'right' ? '✓ ' : state === 'wrong' ? '✕ ' : ''}{choice}
                </button>
              );
            })}
          </div>
          {!revealed && question.hint && (hint
            ? <p className="practice-hint"><Lightbulb size={14} /> {question.hint}</p>
            : <button type="button" className="btn small" onClick={() => setHint(true)}>💡 {t(language, 'Biroz maslahat', 'Немного подсказки', 'A little hint')}</button>)}
          {!revealed
            ? <button type="button" className="btn primary" disabled={saved.picked === null || saved.picked === undefined} onClick={check}>{t(language, 'Javobni bilish', 'Узнать ответ', 'Check the answer')}</button>
            : (
              <div className={`answer-feedback ${given === question.correct ? 'ok' : 'no'}`} role="status">
                <b>{given === question.correct ? `✅ ${t(language, 'To‘g‘ri!', 'Верно!', 'Correct!')}` : `❌ ${t(language, 'Noto‘g‘ri', 'Неверно', 'Not quite')}`}</b>
                {given !== question.correct && <p>{t(language, 'To‘g‘ri javob', 'Верный ответ', 'Correct answer')}: <b>{question.choices[question.correct]}</b></p>}
                {question.hint && <p className="muted"><Lightbulb size={13} /> {question.hint}</p>}
                <button type="button" className="btn primary" onClick={next}>{step + 1 < saved.questions.length ? t(language, 'Keyingisi', 'Дальше', 'Next') : t(language, 'Natija', 'Результат', 'Result')}</button>
              </div>
            )}
        </div>
      )}
      {saved && finished && (
        <div className="practice-result">
          <b className="practice-score">{right} / {saved.questions.length}</b>
          <p>{right >= saved.questions.length - 1 ? t(language, '👏 Zo‘r! Bu mavzular tushunarli.', '👏 Отлично! Эти темы понятны.', '👏 Great! You know these topics.') : t(language, 'Mavzuni yana bir ko‘rib chiqing va yangi test oling.', 'Повторите тему и пройдите новый тест.', 'Review the topic and take a new test.')}</p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>{t(language, 'Yangi test', 'Новый тест', 'New test')}</button>
        </div>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
    </Protected>
  );
}
