import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './lesson-stages.css';
import { createPortal } from 'react-dom';
import { BellRing, Brain, Check, ChevronLeft, ChevronRight, Lightbulb, MessageCircleQuestion, Play, Presentation, RotateCcw, X } from 'lucide-react';
import type { Language } from './school-data';
import { COURSE, type CourseTopic } from './course-data';
import { glossary, sentences } from './lesson-engine';
import { LensRow, useSwipeTabs } from './glass-nav';
import { Modal } from './ui/modal';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/* -------------------------------------------------------------------------- */
/* Teacher: the topic as a full-screen presentation, one idea per slide        */
/* -------------------------------------------------------------------------- */

type Slide = { kind: string; label: string; body: ReactNode; answer?: string };

function useSlides(topic: CourseTopic, language: Language): Slide[] {
  return useMemo(() => {
    const parts = sentences(topic.essence);
    const terms = glossary(topic).slice(0, 5);
    const slides: Slide[] = [];
    slides.push({ kind: 'title', label: topic.code ? `§${topic.code}` : topic.chapter, body: <h1>{topic.title}</h1> });
    slides.push({ kind: 'hook', label: t(language, 'Savol', 'Вопрос классу', 'Question'), body: <p className="pres-big">{topic.hook ?? t(language, `Hayotda «${topic.title}» qayerda uchraydi?`, `Где в жизни встречается «${topic.title}»?`, `Where do we meet “${topic.title}” in life?`)}</p> });
    if (parts[0]) slides.push({ kind: 'idea', label: t(language, 'Asosiy fikr', 'Главная мысль', 'Main idea'), body: <p className="pres-big">{parts[0]}</p> });
    parts.slice(1, 5).forEach((part, index) => slides.push({ kind: 'step', label: t(language, `${index + 1}-qadam`, `Шаг ${index + 1}`, `Step ${index + 1}`), body: <p className="pres-mid">{part}</p> }));
    if (topic.life) slides.push({ kind: 'life', label: t(language, 'Hayotda', 'В жизни', 'In life'), body: <p className="pres-mid">{topic.life}</p> });
    if (topic.facts[0]) slides.push({ kind: 'fact', label: t(language, 'Qiziq fakt', 'Интересный факт', 'Fun fact'), body: <p className="pres-mid">{topic.facts[0]}</p> });
    if (terms.length) slides.push({ kind: 'terms', label: t(language, 'Doskaga', 'На доску', 'For the board'), body: <dl className="pres-terms">{terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl> });
    topic.tasks.slice(0, 2).forEach((task) => slides.push({ kind: 'check', label: t(language, 'Tekshiramiz', 'Проверим', 'Check'), body: <p className="pres-mid">{task.q}</p>, answer: task.a }));
    return slides;
  }, [topic, language]);
}

function PresentationView({ topic, language, onClose }: { topic: CourseTopic; language: Language; onClose: () => void }) {
  const slides = useSlides(topic, language);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const go = useCallback((step: number) => { setAnswer(false); setIndex((value) => Math.min(slides.length - 1, Math.max(0, value + step))); }, [slides.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') { event.preventDefault(); go(1); }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(-1); }
      else if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('pres-open');
    try { void box.current?.requestFullscreen?.(); } catch { /* not allowed: stays as an overlay */ }
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('pres-open');
      try { if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* ignore */ }
    };
  }, [go, onClose]);
  const slide = slides[index]!;
  return createPortal(
    <div ref={box} className="pres" role="dialog" aria-modal="true" aria-label={topic.title}>
      <button type="button" className="pres-close" onClick={onClose} aria-label={t(language, 'Yopish', 'Закрыть', 'Close')}><X size={20} /></button>
      <div key={index} className={`pres-slide is-${slide.kind}`} onClick={(event) => { if (!(event.target as HTMLElement).closest('button') && !slide.answer && index < slides.length - 1) go(1); }}>
        <span className="pres-label">{slide.label}</span>
        {slide.body}
        {slide.answer && (answer
          ? <p className="pres-answer"><Check size={20} /> {slide.answer}</p>
          : <button type="button" className="btn pres-reveal" onClick={() => setAnswer(true)}>{t(language, 'Javobni ko‘rsatish', 'Показать ответ', 'Show answer')}</button>)}
      </div>
      <div className="pres-bar">
        <button type="button" className="pres-nav" onClick={() => go(-1)} disabled={index === 0} aria-label={t(language, 'Oldingi', 'Назад', 'Previous')}><ChevronLeft size={22} /></button>
        <div className="pres-dots" aria-hidden="true">{slides.map((_, i) => <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />)}</div>
        <span className="pres-count">{index + 1} / {slides.length}</span>
        <button type="button" className="pres-nav" onClick={() => (index === slides.length - 1 ? onClose() : go(1))} aria-label={t(language, 'Keyingi', 'Дальше', 'Next')}>{index === slides.length - 1 ? <Check size={22} /> : <ChevronRight size={22} />}</button>
      </div>
    </div>,
    document.body,
  );
}

export function TeachPlan({ topic, language }: { topic: CourseTopic; language: Language }) {
  const [showing, setShowing] = useState(false);
  const slides = useSlides(topic, language);
  return (
    <section className="role-card teach">
      <div className="role-card-head static"><Presentation size={17} /> <b>{t(language, 'Mavzu taqdimoti', 'Презентация темы', 'Topic presentation')}</b><small className="muted">{t(language, `${slides.length} slayd`, `${slides.length} слайдов`, `${slides.length} slides`)}</small></div>
      <button type="button" className="btn primary role-play" onClick={() => setShowing(true)}><Play size={16} /> {t(language, 'Ekranda ko‘rsatish', 'Показать на экране', 'Present')}</button>
      {showing && <PresentationView topic={topic} language={language} onClose={() => setShowing(false)} />}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Pupil: understand → check → remember                                        */
/* -------------------------------------------------------------------------- */

const REMIND_KEY = 'eduverse:remind';
type Reminder = { key: string; title: string; due: string };
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
function readReminders(): Reminder[] { try { return JSON.parse(localStorage.getItem(REMIND_KEY) ?? '[]') as Reminder[]; } catch { return []; } }
function writeReminders(list: Reminder[]) { try { localStorage.setItem(REMIND_KEY, JSON.stringify(list)); } catch { /* private mode */ } }

export function RememberCard({ topic, language, onLearned, inLesson = false }: { topic: CourseTopic; language: Language; onLearned?: () => void; inLesson?: boolean }) {
  const [tab, setTabState] = useState<'learn' | 'check' | 'remember'>('learn');
  // Moving on from "understand" counts the explanation as read.
  const setTab = (next: 'learn' | 'check' | 'remember') => { setTabState(next); if (next !== 'learn') onLearned?.(); };
  const parts = useMemo(() => sentences(topic.essence), [topic.essence]);
  const terms = useMemo(() => glossary(topic).slice(0, 4), [topic]);
  const tasks = topic.tasks.slice(0, 3);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [knew, setKnew] = useState<Record<number, boolean>>({});
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [reminded, setReminded] = useState(() => readReminders().some((item) => item.key === topic.key));
  const answered = Object.keys(knew).length;
  const right = Object.values(knew).filter(Boolean).length;
  function remind() {
    const list = readReminders().filter((item) => item.key !== topic.key);
    list.push({ key: topic.key, title: topic.title, due: addDays(1) });
    writeReminders(list); setReminded(true);
  }
  const tabs: Array<[typeof tab, string]> = [['learn', t(language, 'Tushunish', 'Понять', 'Understand')], ['check', t(language, 'Tekshirish', 'Проверить', 'Check')], ['remember', t(language, 'Eslab qolish', 'Запомнить', 'Remember')]];
  const swipe = useSwipeTabs<typeof tab>(tabs.map(([key]) => key), tab, setTab);
  return (
    <section className="role-card learn">
      {!inLesson && <div className="role-card-head static"><Brain size={17} /> <b>{topic.title}</b></div>}
      <LensRow className="role-tabs">
        {tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'on' : ''} aria-pressed={tab === key} onClick={() => swipe.select(key)}>{label}</button>)}
      </LensRow>
      <div className={`role-swipe cabinet-pane ${swipe.slideClass}`} key={tab} {...swipe.handlers} style={swipe.style}>
      {tab === 'learn' && (
        <div className="role-pane">
          {parts[0] && <p className="role-idea"><Lightbulb size={15} /> {parts[0]}</p>}
          {parts.length > 1 && <ol className="role-points">{parts.slice(1, 5).map((part) => <li key={part}>{part}</li>)}</ol>}
          {topic.life && <p className="role-life">{topic.life}</p>}
          <button type="button" className="btn primary small" onClick={() => setTab('check')}>{t(language, 'Tushundim — tekshiraman', 'Понял — проверить себя', 'Got it — check myself')}</button>
        </div>
      )}
      {tab === 'check' && (
        <div className="role-pane">
          {tasks.map((task, index) => (
            <div key={index} className="role-check">
              <span><MessageCircleQuestion size={15} /> {task.q}</span>
              {!shown[index]
                ? <button type="button" className="btn small" onClick={() => setShown({ ...shown, [index]: true })}>{t(language, 'Javobni ko‘rish', 'Показать ответ', 'Show answer')}</button>
                : <>
                  <b className="role-answer">{task.a}</b>
                  {knew[index] === undefined
                    ? <span className="role-self"><button type="button" className="btn small" onClick={() => setKnew({ ...knew, [index]: true })}><Check size={13} /> {t(language, 'Bilardim', 'Знал', 'I knew')}</button><button type="button" className="btn small" onClick={() => setKnew({ ...knew, [index]: false })}>{t(language, 'Bilmasdim', 'Не знал', 'Didn’t know')}</button></span>
                    : <span className={`role-mark ${knew[index] ? 'good' : 'bad'}`}>{knew[index] ? t(language, 'Zo‘r', 'Отлично', 'Great') : t(language, 'Takrorlaymiz', 'Повторим', 'We’ll repeat')}</span>}
                </>}
            </div>
          ))}
          {answered === tasks.length && tasks.length > 0 && (
            <div className="role-result">
              <b>{t(language, `${right} / ${tasks.length}`, `${right} из ${tasks.length}`, `${right} of ${tasks.length}`)}</b>
              <button type="button" className="btn small" onClick={() => { setShown({}); setKnew({}); }}><RotateCcw size={13} /> {t(language, 'Qaytadan', 'Ещё раз', 'Again')}</button>
              <button type="button" className="btn primary small" onClick={() => setTab('remember')}>{t(language, 'Eslab qolish', 'Запомнить', 'Remember')}</button>
            </div>
          )}
        </div>
      )}
      {tab === 'remember' && (
        <div className="role-pane">
          {parts[0] && !terms.some((item) => parts[0]!.includes(item.meaning)) && <p className="role-idea"><Lightbulb size={15} /> {parts[0]}</p>}
          {terms.length > 0 && (
            <div className="role-flash">
              {terms.map((item) => (
                <button key={item.term} type="button" className={`role-flash-card ${flipped[item.term] ? 'is-flipped' : ''}`} onClick={() => setFlipped({ ...flipped, [item.term]: !flipped[item.term] })}>
                  {flipped[item.term] ? <><small>{item.term}</small><span>{item.meaning}</span></> : <b>{item.term}</b>}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={`btn small ${reminded ? '' : 'primary'}`} disabled={reminded} onClick={remind}><BellRing size={13} /> {reminded ? t(language, 'Ertaga eslataman', 'Напомню завтра', 'I’ll remind you tomorrow') : t(language, 'Ertaga eslatish', 'Напомнить завтра', 'Remind me tomorrow')}</button>
        </div>
      )}
      </div>
    </section>
  );
}

/** Pupil home: topics to repeat today. Tap one — its key idea and terms open in a window. */
export function RepeatToday({ language }: { language: Language }) {
  const [list, setList] = useState<Reminder[]>(() => readReminders());
  const [open, setOpen] = useState<CourseTopic | null>(null);
  const due = list.filter((item) => item.due <= todayIso());
  if (!due.length) return null;
  const topicOf = (key: string) => COURSE.flatMap((book) => book.topics).find((item) => item.key === key) ?? null;
  function done(key: string) { const next = list.filter((item) => item.key !== key); writeReminders(next); setList(next); setOpen(null); }
  return (
    <section className="panel repeat-today">
      <div className="role-card-head static"><BellRing size={16} /> <b>{t(language, 'Bugun takrorlang', 'Повторить сегодня', 'Repeat today')}</b></div>
      <ul className="eco-list">
        {due.map((item) => (
          <li key={item.key} className="is-clickable" role="button" tabIndex={0} onClick={() => setOpen(topicOf(item.key))} onKeyDown={(event) => { if (event.key === 'Enter') setOpen(topicOf(item.key)); }}>
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <RememberBody topic={open} />
          <button type="button" className="btn primary" onClick={() => done(open.key)}><Check size={14} /> {t(language, 'Takrorladim', 'Повторил', 'Done')}</button>
        </Modal>
      )}
    </section>
  );
}

function RememberBody({ topic }: { topic: CourseTopic }) {
  const idea = sentences(topic.essence)[0] ?? topic.essence;
  const terms = glossary(topic).slice(0, 4);
  return (
    <>
      {!terms.some((item) => idea.includes(item.meaning)) && <p className="role-idea"><Lightbulb size={15} /> {idea}</p>}
      {terms.length > 0 && <dl className="role-terms">{terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>}
    </>
  );
}
