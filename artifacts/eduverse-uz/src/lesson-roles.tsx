import { useMemo, useState } from 'react';
import { Brain, ChevronDown, Lightbulb, MessageCircleQuestion, Presentation } from 'lucide-react';
import type { Language } from './school-data';
import type { CourseTopic } from './course-data';
import { glossary, sentences } from './lesson-engine';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/**
 * The same topic, two views: the teacher gets a short plan of how to explain it,
 * the pupil a card to understand and remember it.
 */
export function TeachPlan({ topic, language }: { topic: CourseTopic; language: Language }) {
  const [open, setOpen] = useState(true);
  const parts = useMemo(() => sentences(topic.essence), [topic.essence]);
  const terms = useMemo(() => glossary(topic).slice(0, 5), [topic]);
  const check = topic.tasks[0];
  return (
    <section className={`role-card teach ${open ? 'is-open' : ''}`}>
      <button type="button" className="role-card-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Presentation size={17} /> <b>{t(language, 'Qanday tushuntirish', 'Как объяснить', 'How to explain')}</b>
        <small className="muted">{t(language, 'faqat o‘qituvchiga ko‘rinadi', 'видите только вы', 'only you see this')}</small>
        <ChevronDown size={16} className="role-card-chevron" />
      </button>
      {open && (
        <ol className="role-steps">
          <li><b>{t(language, 'Savol bilan boshlang', 'Начните с вопроса', 'Start with a question')}</b><span>{topic.hook ?? t(language, `Hayotda «${topic.title}» qayerda uchraydi?`, `Где в жизни встречается «${topic.title}»?`, `Where do we meet “${topic.title}” in life?`)}</span></li>
          {parts[0] && <li><b>{t(language, 'Asosiy fikr', 'Главная мысль', 'The main idea')}</b><span>{parts[0]}</span></li>}
          {parts.length > 1 && <li><b>{t(language, 'Bosqichma-bosqich', 'По шагам', 'Step by step')}</b><span>{parts.slice(1, 4).join(' ')}</span></li>}
          {topic.life && <li><b>{t(language, 'Hayotiy misol', 'Пример из жизни', 'A life example')}</b><span>{topic.life}</span></li>}
          {terms.length > 0 && <li><b>{t(language, 'Doskaga yozing', 'Запишите на доске', 'Write on the board')}</b><span>{terms.map((item) => item.term).join(' · ')}</span></li>}
          {check && <li><b>{t(language, 'Tushunganini tekshiring', 'Проверьте понимание', 'Check understanding')}</b><span>{check.q} <small className="muted">— {check.a}</small></span></li>}
        </ol>
      )}
    </section>
  );
}

export function RememberCard({ topic, language }: { topic: CourseTopic; language: Language }) {
  const [shown, setShown] = useState(false);
  const idea = useMemo(() => sentences(topic.essence)[0] ?? topic.essence, [topic.essence]);
  const terms = useMemo(() => glossary(topic).slice(0, 4), [topic]);
  const check = topic.tasks[0];
  return (
    <section className="role-card learn">
      <div className="role-card-head static"><Brain size={17} /> <b>{t(language, 'Esda saqlang', 'Запомни', 'Remember')}</b></div>
      <p className="role-idea"><Lightbulb size={15} /> {idea}</p>
      {terms.length > 0 && (
        <dl className="role-terms">
          {terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}
        </dl>
      )}
      {check && (
        <div className="role-check">
          <span><MessageCircleQuestion size={15} /> {check.q}</span>
          {shown ? <b className="role-answer">{check.a}</b> : <button type="button" className="btn small" onClick={() => setShown(true)}>{t(language, 'O‘zimni tekshiraman', 'Проверить себя', 'Check myself')}</button>}
        </div>
      )}
    </section>
  );
}
