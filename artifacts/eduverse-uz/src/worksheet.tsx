import { useMemo, useState } from 'react';
import { createAssignment } from '@workspace/api-client-react';
import { ClipboardList, Send } from 'lucide-react';
import { COURSE } from './course-data';
import type { Language, SchoolData } from './school-data';
import { friendlyError } from './errors';

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
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const book = COURSE.find((item) => item.id === bookId) ?? COURSE[0];

  const tasks = useMemo(() => {
    if (!book) return [];
    const needle = query.trim().toLowerCase();
    return book.topics.flatMap((topic) => topic.tasks.map((task, index) => ({ id: `${topic.key}#${index}`, topic: `§${topic.code} ${topic.title}`, q: task.q, a: task.a })))
      .filter((task) => !needle || `${task.topic} ${task.q}`.toLowerCase().includes(needle));
  }, [book, query]);

  const toggle = (task: Picked) => setPicked((current) => (current.some((item) => item.id === task.id) ? current.filter((item) => item.id !== task.id) : [...current, task]));

  async function send() {
    if (!classId || picked.length === 0 || !book) return;
    const className = teachClasses.find((item) => item.id === classId)?.name ?? '';
    const name = title.trim() || `${t(language, 'Topshiriqlar varag‘i', 'Лист заданий', 'Worksheet')} · ${SUBJECT_RU[book.subject]} · ${picked.length}`;
    if (!window.confirm(t(language, `${className} sinfiga ${picked.length} ta topshiriq yuborilsinmi?`, `Отправить классу ${className}: ${picked.length} заданий?`, `Send ${picked.length} tasks to ${className}?`))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const description = picked.map((item, index) => `${index + 1}. ${item.q}`).join('\n\n');
      await createAssignment(classId, {
        title: name.slice(0, 160),
        subject: language === 'English' ? SUBJECT_EN[book.subject] : SUBJECT_RU[book.subject],
        description,
        dueAt: due ? new Date(`${due}T20:00:00`).toISOString() : null,
      });
      setMessage(t(language, 'Yuborildi. O‘quvchilar «Vazifalar»da ko‘radi.', 'Отправлено. Ученики увидят в «Заданиях», ответы к заданиям ниже — только для вас.', 'Sent. Pupils see it in Homework.'));
      setPicked([]); setTitle('');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel worksheet">
      <h2><ClipboardList size={16} /> {t(language, 'Topshiriqlar varag‘i', 'Лист заданий из учебника', 'Worksheet from the textbook')}</h2>
      <p className="muted">{t(language, 'Istalgan mavzudan tayyor topshiriqlarni belgilang va sinfga uy vazifasi qilib yuboring.', 'Отметьте готовые задания из любых тем (любого класса) и отправьте классу как домашку.', 'Tick ready tasks from any topic and send them as homework.')}</p>
      <div className="people-filters">
        <select className="input" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          {COURSE.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'Mavzu yoki so‘z', 'Тема или слово', 'Topic or word')} />
        <select className="input" value={classId} onChange={(event) => setClassId(event.target.value)}>
          {teachClasses.length === 0 && <option value="">{t(language, 'Sinf yo‘q', 'Нет классов', 'No classes')}</option>}
          {teachClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
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
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t(language, 'Nomi (ixtiyoriy)', 'Название (необязательно)', 'Title (optional)')} />
            <input className="input" type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label={t(language, 'Muddat', 'Срок', 'Due')} />
            <button type="button" className="btn primary" disabled={busy || !classId} onClick={() => void send()}><Send size={14} /> {t(language, 'Sinfga yuborish', 'Отправить классу', 'Send to class')}</button>
          </div>
        </div>
      )}
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice">{error}</div>}
    </section>
  );
}
