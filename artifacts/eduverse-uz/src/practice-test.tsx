import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import type { Language } from './school-data';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';

/*
 * "My test": 5 questions made for this pupil on the topics they find hard (low journal marks,
 * weak trainer results). One question at a time; the progress is kept on the device, so closing
 * the page does not lose it.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Question = { prompt: string; choices: string[]; correct: number; hint: string };
type Saved = { topics: Array<{ subject: string; title: string }>; questions: Question[]; answers: number[]; day: string };

const today = () => new Date().toISOString().slice(0, 10);

export function PracticeTest({ userId, language }: { userId: string; language: Language }) {
  const key = `eduverse:practice:${userId}`;
  const [saved, setSaved] = useState<Saved | null>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
  });
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
      const data = await customFetch<{ topics: Saved['topics']; questions: Question[] }>('/api/me/practice-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
      setSaved({ topics: data.topics, questions: data.questions, answers: [], day: today() });
      setHint(false);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const step = saved ? saved.answers.length : 0;
  const finished = saved ? step >= saved.questions.length : false;
  const question = saved && !finished ? saved.questions[step] : null;
  const lastAnswer = saved && step > 0 ? saved.answers[step - 1] : null;
  const right = saved ? saved.answers.filter((answer, index) => answer === saved.questions[index]?.correct).length : 0;

  return (
    <section className="panel practice-test">
      <div className="section-head">
        <h2><Sparkles size={16} /> {t(language, 'Mening testim', 'Мой тест', 'My test')}</h2>
        {saved && <button type="button" className="btn small" onClick={() => setSaved(null)} aria-label={t(language, 'Yangi test', 'Новый тест', 'New test')}><RotateCcw size={14} /></button>}
      </div>
      {!saved && (
        <>
          <p className="muted">{t(language, 'Qiyin mavzular bo‘yicha 5 ta savol — faqat siz uchun.', '5 вопросов по темам, которые даются труднее, — только для вас.', '5 questions on the topics you find harder — just for you.')}</p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>{busy ? t(language, 'Tayyorlanmoqda…', 'Готовим…', 'Preparing…') : t(language, 'Testni boshlash', 'Начать тест', 'Start the test')}</button>
          {busy && <LoadingBlock language={language} kind="inline" />}
        </>
      )}
      {saved && (
        <p className="muted practice-topics">{saved.topics.map((topic) => topic.title).join(' · ')}</p>
      )}
      {saved && !finished && question && (
        <div className="practice-question">
          <div className="test-progress"><span style={{ width: `${(step / saved.questions.length) * 100}%` }} /></div>
          <small className="muted">{step + 1} / {saved.questions.length}</small>
          {lastAnswer !== null && step > 0 && (
            <p className={`practice-last ${lastAnswer === saved.questions[step - 1]!.correct ? 'ok' : 'no'}`}>
              {lastAnswer === saved.questions[step - 1]!.correct ? `✅ ${t(language, 'To‘g‘ri!', 'Верно!', 'Correct!')}` : `❌ ${t(language, 'To‘g‘ri javob', 'Верный ответ', 'Correct answer')}: ${saved.questions[step - 1]!.choices[saved.questions[step - 1]!.correct]}`}
            </p>
          )}
          <h3>{question.prompt}</h3>
          <div className="practice-choices">
            {question.choices.map((choice, index) => (
              <button type="button" key={index} className="answer-choice" onClick={() => { setHint(false); setSaved({ ...saved, answers: [...saved.answers, index] }); }}>{choice}</button>
            ))}
          </div>
          {question.hint && (hint
            ? <p className="practice-hint"><Lightbulb size={14} /> {question.hint}</p>
            : <button type="button" className="btn small" onClick={() => setHint(true)}>👁 {t(language, 'Maslahat', 'Подсказка', 'Hint')}</button>)}
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
    </section>
  );
}
