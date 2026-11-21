import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Language } from './school-data';
import { COURSE, SUBJECT_LABEL } from './course-data';
import { CourseScene3D } from './course';
import { Select } from './ui/select';

/*
 * 3D studio → "Textbook topics": any topic of any textbook, with its own 3D model.
 * The teacher picks what they want to show — no limits on the topic or the day.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

export default function StudioBookTopics({ language }: { language: Language }) {
  const [bookId, setBookId] = useState(COURSE[0]?.id ?? '');
  const book = COURSE.find((item) => item.id === bookId) ?? COURSE[0]!;
  const [topicKey, setTopicKey] = useState(book.topics[0]?.key ?? '');
  const [query, setQuery] = useState('');
  const topic = book.topics.find((item) => item.key === topicKey) ?? book.topics[0]!;
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return book.topics.filter((item) => !needle || `§${item.code} ${item.title}`.toLowerCase().includes(needle));
  }, [book, query]);
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
        </div>
      </section>
      <div className="studio-title">§{topic.code} {topic.title}</div>
      <CourseScene3D key={topic.key} scene={topic.scene} language={language} />
      {topic.sceneHint && <p className="muted lab-today-hint">{topic.sceneHint}</p>}
    </div>
  );
}
