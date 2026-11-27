import { useMemo, useState } from 'react';
import { DateField } from './ui/date-field';
import { Select } from './ui/select';
import { createAssignment } from '@workspace/api-client-react';
import { ClipboardList, Send, Sparkles } from 'lucide-react';
import { COURSE } from './course-data';
import type { Language, SchoolData } from './school-data';
import { friendlyError } from './errors';
import { dayLabel, lessonSubjectName, topicForLesson, upcomingTopics, useLessonCourses, useToday, bookForLesson } from './today';
import type { CourseTopic } from './course-data';

/*
 * Worksheet builder: the teacher ticks ready tasks from any textbook topic
 * (any grade) and sends them to a class as homework in two clicks.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
const SUBJECT_RU: Record<string, string> = { physics: 'Физика', chemistry: 'Химия', biology: 'Биология', math: 'Математика' };
const SUBJECT_EN: Record<string, string> = { physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', math: 'Mathematics' };

type Picked = { id: string; topic: string; q: string; a: string };

export function WorksheetBuilder({ school, language }: { school: SchoolData; language: Language }) {
  const teachClasses = school.classes;
  const [classId, setClassId] = useState(teachClasses[0]?.id ?? '');
  const [bookId, setBookId] = useState(COURSE[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Only the lessons of today (open) and tomorrow (shown, opens tomorrow): their topics' tasks.
  const today = useToday();
  const courses = useLessonCourses(today.data?.lessons, today.data?.next);
  const slots = useMemo(() => {
    const data = today.data;
    if (!data) return null;
    const rows: Array<{ id: string; label: string; classId: string; topic: CourseTopic; open: boolean; bookId: string }> = [];
    const seen = new Set<string>();
    for (const lesson of data.lessons) {
      const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
      const book = bookForLesson(lesson);
      if (!topic || !book || seen.has(`${lesson.classId}:${topic.key}`)) continue;
      seen.add(`${lesson.classId}:${topic.key}`);
      rows.push({ id: lesson.id, label: `${t(language, 'Bugun', 'Сегодня', 'Today')} ${lesson.start} · ${lesson.className} · ${lessonSubjectName(lesson.subject, language)}`, classId: lesson.classId, topic, open: true, bookId: book.id });
    }
    // Only today's topics: tomorrow's homework is given tomorrow.
    const hasTimetable = data.lessons.length + (data.next ?? []).reduce((sum, day) => sum + day.lessons.length, 0) > 0;
    return hasTimetable ? rows : null;
  }, [today.data, courses, language]);
  const [slotId, setSlotId] = useState('');
  const slot = slots?.find((item) => item.id === slotId) ?? slots?.find((item) => item.open) ?? null;
  const book = slots ? COURSE.find((item) => item.id === slot?.bookId) : (COURSE.find((item) => item.id === bookId) ?? COURSE[0]);

  const tasks = useMemo(() => {
    if (!book) return [];
    if (slots) {
      if (!slot || !slot.open) return [];
      return slot.topic.tasks.map((task, index) => ({ id: `${slot.topic.key}#${index}`, topic: `§${slot.topic.code} ${slot.topic.title}`, q: task.q, a: task.a }));
    }
    const needle = query.trim().toLowerCase();
    return book.topics.flatMap((topic) => topic.tasks.map((task, index) => ({ id: `${topic.key}#${index}`, topic: `§${topic.code} ${topic.title}`, q: task.q, a: task.a })))
      .filter((task) => !needle || `${task.topic} ${task.q}`.toLowerCase().includes(needle));
  }, [book, query, slots, slot]);
  const targetClass = slots ? slot?.classId ?? '' : classId;

  const toggle = (task: Picked) => setPicked((current) => (current.some((item) => item.id === task.id) ? current.filter((item) => item.id !== task.id) : [...current, task]));

  async function send() {
    if (!targetClass || picked.length === 0 || !book) return;
    const classId = targetClass;
    const className = teachClasses.find((item) => item.id === classId)?.name ?? '';
    const name = title.trim() || (slots && slot ? `§${slot.topic.code} ${slot.topic.title}` : `${t(language, 'Uy vazifasi', 'Домашнее задание', 'Homework')} · ${lessonSubjectName(book.subject, language)}`);
    if (!window.confirm(t(language, `${className} sinfiga ${picked.length} ta topshiriq yuborilsinmi?`, `Отправить классу ${className}: ${picked.length} заданий?`, `Send ${picked.length} tasks to ${className}?`))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const description = picked.map((item, index) => `${index + 1}. ${item.q}`).join('\n\n');
      await createAssignment(classId, {
        title: name.slice(0, 160),
        subject: language === 'English' ? SUBJECT_EN[book.subject] : SUBJECT_RU[book.subject],
        description,
        dueAt: due ? new Date(`${due}T20:00:00`).toISOString() : null,
        ...(slots && slot ? { topicId: `course:${slot.topic.key}`, topicTitle: `§${slot.topic.code} ${slot.topic.title}` } : {}),
      });
      setMessage(t(language, 'Yuborildi. O‘quvchilar «Vazifalar»da ko‘radi.', 'Отправлено. Ученики увидят в «Заданиях».', 'Sent. Pupils see it in Homework.'));
      setPicked([]); setTitle('');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const lessonsWithBook = (today.data?.lessons ?? []).filter((lesson) => bookForLesson(lesson));
  return (
    <section className="panel worksheet">
      <h2><ClipboardList size={16} /> {t(language, 'Bugungi mavzu bo‘yicha uy vazifasi', 'Домашнее задание по сегодняшней теме', 'Homework on today’s topic')}</h2>
      <div className="notice auto-homework-note"><Sparkles size={16} /><span>{t(language,
        'Uy vazifasini EDUVERSE o‘zi beradi: dars tugashi bilan darslikdagi vazifa sinfga yuboriladi. Siz faqat tekshirasiz.',
        'Домашнее задание выдаёт сам EDUVERSE: как только урок заканчивается, задание из учебника уходит классу. Вам остаётся только проверить.',
        'EDUVERSE gives the homework itself: when the lesson ends, the textbook task goes to the class. You only check it.')}</span></div>
      {lessonsWithBook.length > 0 && today.data && (
        <ul className="auto-homework-list">
          {lessonsWithBook.map((lesson) => {
            const topic = topicForLesson(lesson, courses[lesson.classId], today.data!.date);
            const sent = Date.parse(lesson.endsAt) <= today.now;
            return (
              <li key={lesson.id} className={sent ? 'is-sent' : ''}>
                <div className="auto-homework-top">
                  <b>{lesson.start}–{lesson.end} · {lesson.className} · {lessonSubjectName(lesson.subject, language)}</b>
                  <span className={`tag ${sent ? 'green' : 'gold'}`}>{sent ? t(language, 'Sinfga yuborildi', 'Отправлено классу', 'Sent to the class') : t(language, `${lesson.end} da yuboriladi`, `Уйдёт классу в ${lesson.end}`, `Goes out at ${lesson.end}`)}</span>
                </div>
                {topic && <><small className="muted">§{topic.code} {topic.title}</small><p>{topic.homework}</p></>}
              </li>
            );
          })}
        </ul>
      )}
      <details className="worksheet-extra">
        <summary>{t(language, 'Darslikdan qo‘shimcha topshiriq qo‘shish (ixtiyoriy)', 'Добавить задания из учебника (по желанию)', 'Add extra textbook tasks (optional)')}</summary>
      <p className="muted">{slots
        ? t(language, 'Topshiriqlarni belgilang va «Uyga berish» ni bosing.', 'Отметьте задания галочкой и нажмите «Задать на дом».', 'Tick the tasks and press “Assign”.')
        : t(language, 'Istalgan mavzudan tayyor topshiriqlarni belgilang va sinfga uy vazifasi qilib yuboring.', 'Отметьте готовые задания из темы и отправьте классу как домашку.', 'Tick ready tasks from any topic and send them as homework.')}</p>
      {slots && (slots.length === 0
        ? <div className="notice">{t(language, 'Bugun darslik bo‘yicha dars yo‘q.', 'Сегодня нет уроков по учебнику.', 'No textbook lessons today.')}</div>
        : <div className="worksheet-slots" role="tablist">
            {slots.map((item) => (
              <button type="button" role="tab" key={item.id} aria-selected={slot?.id === item.id} className={`studio-tab ${slot?.id === item.id ? 'active' : ''} ${item.open ? '' : 'is-locked'}`} onClick={() => { setSlotId(item.id); setPicked([]); }}>
                <span>{item.label}</span><small>§{item.topic.code} {item.topic.title}</small>
              </button>
            ))}
          </div>)}
      {slots && slot && !slot.open && <div className="notice">{t(language, 'Bu mavzu ertaga, dars kuni ochiladi.', 'Эта тема откроется завтра, в день урока.', 'This topic opens tomorrow, on the lesson day.')}</div>}
      {!slots && <div className="people-filters">
        <Select className="input" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          {COURSE.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </Select>
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'Mavzu yoki so‘z', 'Тема или слово', 'Topic or word')} />
        <Select className="input" value={classId} onChange={(event) => setClassId(event.target.value)}>
          {teachClasses.length === 0 && <option value="">{t(language, 'Sinf yo‘q', 'Нет классов', 'No classes')}</option>}
          {teachClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </div>}
      <div className="worksheet-tasks">
        {tasks.slice(0, 200).map((task) => {
          const on = picked.some((item) => item.id === task.id);
          return (
            <label key={task.id} className={`worksheet-task ${on ? 'on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(task)} />
              <span><small className="muted">{task.topic}</small><span>{task.q}</span></span>
            </label>
          );
        })}
      </div>
      {picked.length > 0 && (
        <div className="worksheet-picked">
          <b>{t(language, 'Tanlandi', 'Выбрано', 'Picked')}: {picked.length}</b>
          <ol>{picked.map((item) => <li key={item.id}>{item.q}<small className="muted"> — {t(language, 'javob', 'ответ', 'answer')}: {item.a}</small></li>)}</ol>
          <div className="people-filters">
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={slots && slot ? `§${slot.topic.code} ${slot.topic.title}` : t(language, 'Nomi (ixtiyoriy)', 'Название (необязательно)', 'Title (optional)')} />
            <DateField className="input" type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label={t(language, 'Muddat', 'Срок', 'Due')} />
            <button type="button" className="btn primary" disabled={busy || !targetClass} onClick={() => void send()}><Send size={14} /> {t(language, 'Uyga berish', 'Задать на дом', 'Assign')}</button>
          </div>
        </div>
      )}
      </details>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice">{error}</div>}
    </section>
  );
}
