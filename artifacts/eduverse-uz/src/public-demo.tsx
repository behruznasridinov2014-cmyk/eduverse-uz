import { useState } from 'react';
import { BookOpen, Box, ChevronRight, GraduationCap, Lightbulb, LogIn, NotebookPen, Target, Users } from 'lucide-react';
import { COURSE, SUBJECT_LABEL, pdfPageOf } from './course-data';
import { CourseScene3D } from './course';
import { SceneLibraryPage } from './scene-library';
import type { Language } from './school-data';

/*
 * Public demo without an account: textbook topics with their 3D scenes and tasks,
 * the whole 3D library, and what each role gets. Nothing here reads or writes
 * school data, so it is safe to open for anyone (a director at a meeting).
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Tab = 'topics' | 'library' | 'roles';

export function PublicDemoPage({ language, onLanguageChange, onSignIn }: { language: Language; onLanguageChange: (language: Language) => void; onSignIn: () => void }) {
  const [tab, setTab] = useState<Tab>('topics');
  const [bookId, setBookId] = useState(COURSE[0]?.id ?? '');
  const book = COURSE.find((item) => item.id === bookId) ?? COURSE[0];
  const [topicKey, setTopicKey] = useState(book?.topics[0]?.key ?? '');
  const topic = book?.topics.find((item) => item.key === topicKey) ?? book?.topics[0];
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [listOpen, setListOpen] = useState(false);
  if (!book || !topic) return null;
  const page = pdfPageOf(book, topic);

  const roles: Array<[typeof Users, string, string]> = [
    [GraduationCap, t(language, 'O‘quvchi', 'Ученик', 'Pupil'), t(language, '3D mavzular, onlayn dars, uy vazifasi daftar rasmi bilan, baholar, kunlik trenajyor.', 'Темы с 3D, онлайн-урок, домашка с фото тетради, оценки, тренажёр дня с рейтингом класса.', '3D topics, lessons, homework, grades, trainer.')],
    [NotebookPen, t(language, 'O‘qituvchi', 'Учитель', 'Teacher'), t(language, 'Fan bo‘yicha davomat → bugungi mavzu, 3D sinfga, topshiriqlar varag‘i, baholash.', 'Давомат по своему предмету → сразу сегодняшняя тема, 3D на весь экран, лист заданий из учебника, проверка и оценки.', 'Attendance → today’s topic, 3D, worksheets, grading.')],
    [Users, t(language, 'Ota-ona', 'Родитель', 'Parent'), t(language, 'Farzandining baholari, davomati, vazifalari.', 'Оценки, пропуски и домашки своего ребёнка — сразу, без собраний.', 'Child’s grades, attendance, homework.')],
    [Target, t(language, 'Direktor', 'Директор', 'Director'), t(language, 'Butun maktab, kitob bo‘yicha reja, davomat, arizalar.', 'Вся школа: где каждый класс по учебнику и когда закончит книгу, давомат, средние оценки, заявки.', 'The whole school, plan, attendance.')],
  ];

  return (
    <div className="public-demo">
      <header className="public-demo-head">
        <b className="public-demo-logo">EDUVERSE-UZ</b>
        <span className="tag gold">{t(language, 'Demo — kirishsiz', 'Демо — без входа', 'Demo — no sign-in')}</span>
        <div className="public-demo-actions">
          {(['Uzbek', 'Русский', 'English'] as Language[]).map((value) => (
            <button key={value} type="button" className={`btn small ${language === value ? 'primary' : ''}`} onClick={() => onLanguageChange(value)}>{value === 'Uzbek' ? 'UZ' : value === 'Русский' ? 'RU' : 'EN'}</button>
          ))}
          <button type="button" className="btn small" onClick={onSignIn}><LogIn size={14} /> {t(language, 'Kirish', 'Войти', 'Sign in')}</button>
        </div>
      </header>

      <div className="setup-steps-tabs public-demo-tabs">
        <button type="button" className={`btn ${tab === 'topics' ? 'primary' : ''}`} onClick={() => setTab('topics')}><BookOpen size={15} /> {t(language, 'Darslik mavzulari', 'Темы по учебнику', 'Textbook topics')}</button>
        <button type="button" className={`btn ${tab === 'library' ? 'primary' : ''}`} onClick={() => setTab('library')}><Box size={15} /> {t(language, '3D kutubxona', '3D-библиотека', '3D library')}</button>
        <button type="button" className={`btn ${tab === 'roles' ? 'primary' : ''}`} onClick={() => setTab('roles')}><Users size={15} /> {t(language, 'Kim nima ko‘radi', 'Кто что видит', 'Who sees what')}</button>
      </div>

      {tab === 'library' && <SceneLibraryPage language={language} grade={7} />}

      {tab === 'roles' && (
        <div className="public-demo-roles">
          {roles.map(([Icon, title, text]) => (
            <section key={title} className="panel"><h2><Icon size={18} /> {title}</h2><p className="muted">{text}</p></section>
          ))}
          <section className="panel">
            <h2>{t(language, 'Xavfsizlik', 'Безопасность', 'Security')}</h2>
            <p className="muted">{t(language, 'Har kimning o‘z logini; o‘qituvchi o‘quvchi qo‘sha olmaydi; maktablar bir-birini ko‘rmaydi; Google orqali tiklash.', 'У каждого свой логин; учитель не добавляет учеников; школы не видят друг друга; все изменения людей видны в журнале; украденный аккаунт возвращается через Google и все чужие устройства отключаются.', 'Own login for everyone; schools isolated; recovery via Google.')}</p>
          </section>
        </div>
      )}

      {tab === 'topics' && (
        <div className="public-demo-topics">
          <div className="course-subjects">
            {COURSE.map((item) => (
              <button type="button" key={item.id} className={`studio-tab ${item.id === book.id ? 'active' : ''}`} onClick={() => { setBookId(item.id); setTopicKey(item.topics[0]?.key ?? ''); setAnswers({}); }}>
                <span>●</span>{t(language, ...SUBJECT_LABEL[item.subject])} · {item.grade}
              </button>
            ))}
          </div>
          <div className="panel public-demo-picker">
            <button type="button" className="btn small" onClick={() => setListOpen(!listOpen)}>{t(language, `Mavzular · ${book.topics.length}`, `Все темы книги · ${book.topics.length}`, `All topics · ${book.topics.length}`)} <ChevronRight size={14} /></button>
            {listOpen && (
              <div className="public-demo-list">
                {book.topics.map((item) => (
                  <button type="button" key={item.key} className={`course-topic ${item.key === topic.key ? 'active' : ''}`} onClick={() => { setTopicKey(item.key); setAnswers({}); setListOpen(false); }}>
                    <span className="course-code">§{item.code}</span><span className="course-name">{item.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <article className="course-topic-view" key={topic.key}>
            <header className="course-hero">
              <div>
                <div className="eyebrow">§{topic.code} · {topic.chapter}</div>
                <h2>{topic.title}</h2>
              </div>
              {page && <a className="btn" href={`/books/${book.bookId}.pdf#page=${page}`} target="_blank" rel="noopener noreferrer"><BookOpen size={15} /> {t(language, `Darslikda · ${topic.page}-bet`, `В учебнике · стр. ${topic.page}`, `In the textbook · p. ${topic.page}`)}</a>}
            </header>
            <section className="panel course-essence">
              <h3><Lightbulb size={17} /> {t(language, 'Mohiyati', 'Суть темы', 'The essence')}</h3>
              {topic.hook && <p className="course-hook">{topic.hook}</p>}
              <p>{topic.essence}</p>
              <div className="course-life"><Target size={15} /> <span><b>{t(language, 'Hayotda:', 'В жизни:', 'In life:')}</b> {topic.life}</span></div>
            </section>
            <section className="course-3d">
              <div className="course-3d-head"><h3><Box size={17} /> {t(language, '3D da o‘rganing', 'Изучите в 3D', 'Explore in 3D')}</h3><p className="muted">{topic.sceneHint}</p></div>
              <CourseScene3D scene={topic.scene} language={language} />
            </section>
            <section className="panel">
              <h3><NotebookPen size={17} /> {t(language, 'Topshiriqlar', 'Задания', 'Tasks')}</h3>
              <ol className="course-tasks">
                {topic.tasks.map((task, index) => (
                  <li key={index}>
                    <p>{task.q}</p>
                    {answers[index] ? <div className="course-answer">{task.a}</div> : <button type="button" className="btn small" onClick={() => setAnswers((current) => ({ ...current, [index]: true }))}>{t(language, 'Javobni tekshirish', 'Проверить ответ', 'Check the answer')}</button>}
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel course-homework"><h3>{t(language, 'Uy vazifasi', 'Домашнее задание', 'Homework')}</h3><p>{topic.homework}</p></section>
          </article>
        </div>
      )}
    </div>
  );
}
