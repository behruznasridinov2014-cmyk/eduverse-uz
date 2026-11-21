import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Language } from './school-data';
import { COURSE, SUBJECT_LABEL } from './course-data';
import { CourseScene3D } from './course';
import { Select } from './ui/select';
import { useLessonCourses, useToday } from './today';

/*
 * 3D studio → "Textbook topics": any topic of any textbook, with its own 3D model.
 * The teacher picks what they want to show — no limits on the topic or the day.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

export default function StudioBookTopics({ language }: { language: Language }) {
  const [bookId, setBookId] = useState(COURSE[0]?.id ?? '');
  const book = COURSE.find((item) => item.id === bookId) ?? COURSE[0]!;
  // Topics the teacher's classes already covered before today are hidden (yesterday's and older);
  // the list starts at today's place in the book.
  const today = useToday();
  const courses = useLessonCourses(today.data?.lessons, today.data?.next);
  const covered = useMemo(() => {
    const keys = new Set<string>();
    for (const course of Object.values(courses)) for (const row of course.progress) if (row.doneOn !== today.data?.date) keys.add(row.topicKey);
    return keys;
  }, [courses, today.data?.date]);
  const [showPast, setShowPast] = useState(false);
  const [topicKey, setTopicKey] = useState('');
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return book.topics.filter((item) => (showPast || needle || !covered.has(item.key)) && (!needle || `§${item.code} ${item.title}`.toLowerCase().includes(needle)));
  }, [book, query, covered, showPast]);
  const hidden = book.topics.filter((item) => covered.has(item.key)).length;
  const topic = book.topics.find((item) => item.key === topicKey) ?? list[0] ?? book.topics[0]!;
  return (
    <div className="studio-book">
      <section className="panel studio-book-pick">
        <div className="studio-book-row">
          <Select value={bookId} onChange={(_event, value) => { setBookId(value); const next = COURSE.find((item) => item.id === value); setTopicKey(next?.topics[0]?.key ?? ''); setQuery(''); }}
            options={COURSE.map((item) => ({ value: item.id, label: `${t(language, ...SUBJECT_LABEL[item.subject])} · ${t(language, `${item.grade}-sinf`, `${item.grade} класс`, `Grade ${item.grade}`)}` }))}
            aria-label={t(language, 'Darslik', 'Учебник', 'Textbook')} style={{ maxWidth: 260 }} />
          <label className="studio-book-search"><Search size={15} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'Mavzuni qidirish', 'Найти тему', 'Find a topic')} /></label>
        </div>
        <div className="studio-book-topics">
          {list.map((item) => (
            <button type="button" key={item.key} className={`studio-tab ${item.key === topic.key ? 'active' : ''}`} onClick={() => setTopicKey(item.key)}>§{item.code} {item.title}</button>
          ))}
          {list.length === 0 && <span className="muted">{t(language, 'Hech narsa topilmadi', 'Ничего не найдено', 'Nothing found')}</span>}
          {hidden > 0 && !query && <button type="button" className="btn small" onClick={() => setShowPast((value) => !value)}>{showPast ? t(language, 'O‘tilganlarni yashirish', 'Скрыть пройденные', 'Hide covered') : t(language, `O‘tilganlar · ${hidden}`, `Пройденные · ${hidden}`, `Covered · ${hidden}`)}</button>}
        </div>
      </section>
      <div className="studio-title">§{topic.code} {topic.title}</div>
      <CourseScene3D key={topic.key} scene={topic.scene} language={language} />
      {topic.sceneHint && <p className="muted lab-today-hint">{topic.sceneHint}</p>}
    </div>
  );
}
