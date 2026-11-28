import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CheckCircle2, ClipboardList, Clock3, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { Select } from './ui/select';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';
import { ServerTeachingPanel, SubmissionReviewDialog } from './school-panels';
import { Modal } from './ui/modal';
import { markBand } from './marks';
import { COURSE, type CourseTopic } from './course-data';
import { subjectLabel } from './ui/config';

const MONTHS: Record<Language, string[]> = {
  Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  Русский: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  English: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** The textbook topic of a homework ("Физика · §1.6 …"), for the teacher's answer key. */
export function topicOfHomework(title: string): CourseTopic | undefined {
  const code = /§\s*([\d.]+)/.exec(title)?.[1];
  if (!code) return undefined;
  for (const book of COURSE) {
    const found = book.topics.find((topic) => topic.code === code && title.includes(topic.title));
    if (found) return found;
  }
  return undefined;
}

/** Task lines of a homework without "Из учебника:" prefixes. */
export const homeworkLines = (description?: string) => (description ?? '').split('\n').map((line) => line.trim().replace(/^Из учебника:\s*/, '').replace(/^[-•*]\s*/, '')).filter((line) => line.length > 1);

/** What the teacher checks for: the task and the main points of the topic. */
export function HomeworkKey({ title, description, language }: { title: string; description?: string; language: Language }) {
  const lines = homeworkLines(description);
  const topic = topicOfHomework(title);
  const points = topic ? [topic.essence, ...topic.facts].filter(Boolean).slice(0, 5) : [];
  return (
    <div className="hw-key">
      {lines.length > 0 && (
        <section>
          <b>{t(language, 'Vazifa', 'Задание', 'Task')}</b>
          <ol>{lines.map((line, at) => <li key={at}>{line}</li>)}</ol>
        </section>
      )}
      {points.length > 0 && (
        <section>
          <b>{t(language, 'Javobda bo‘lishi kerak', 'Что должно быть в ответе', 'The answer should have')}</b>
          <ul>{points.map((line, at) => <li key={at}>{line}</li>)}</ul>
        </section>
      )}
      {topic?.tasks?.length ? (
        <section>
          <b>{t(language, 'Savollar va javoblar', 'Вопросы и ответы', 'Questions and answers')}</b>
          <ul>{topic.tasks.slice(0, 4).map((task, at) => <li key={at}>{task.q} <span className="hw-key-answer">→ {task.a}</span></li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

/*
 * Teacher → "Check homework": choose a class and a subject (today's homework first), see every pupil:
 * who handed in, who is waiting for a check, who is checked. A tap opens the notebook photos.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Journal = {
  assignments: Array<{ id: string; title: string; subject: string; description?: string; createdAt?: string; dueAt?: string | null }>;
  rows: Array<{ studentId: string; studentName: string; cells: Array<{ state: 'missing' | 'review' | 'graded'; grade: number | null }> }>;
};

/** "Today", "Yesterday" or the date the homework was given. */
function dayLabel(item: { createdAt?: string; dueAt?: string | null }, language: Language): string {
  const raw = item.createdAt ?? item.dueAt;
  if (!raw) return t(language, 'Vazifa', 'Задание', 'Task');
  const date = new Date(raw);
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return t(language, 'Bugun berilgan', 'Задано сегодня', 'Given today');
  if (days === 1) return t(language, 'Kecha berilgan', 'Задано вчера', 'Given yesterday');
  return `${date.getDate()} ${MONTHS[language][date.getMonth()]}`;
}

export function CheckHomeworkPage({ school, language }: { school: SchoolData; language: Language }) {
  const [classId, setClassId] = useState(school.classes[0]?.id ?? '');
  // Until the teacher picks a class, open the first class where somebody handed in work.
  const picked = useRef(false);
  const tried = useRef(new Set<string>());
  const [journal, setJournal] = useState<Journal | null>(null);
  const [assignmentId, setAssignmentId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ studentId: string; studentName: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'review' | 'graded'>('review');
  const [writing, setWriting] = useState(false);
  const [showTask, setShowTask] = useState(false);
  // The class list arrives after the page opens: pick the first class then.
  useEffect(() => { if (!classId && school.classes[0]) setClassId(school.classes[0].id); }, [classId, school.classes]);

  const load = useCallback(async () => {
    if (!classId) return;
    setError('');
    try {
      const next = await customFetch<Journal>(`/api/classes/${classId}/journal`, { method: 'GET' });
      tried.current.add(classId);
      const anyWork = next.rows.some((row) => row.cells.some((cell) => cell.state !== 'missing'));
      if (!picked.current && !anyWork) {
        const other = school.classes.find((item) => !tried.current.has(item.id));
        if (other) { setClassId(other.id); return; }
      }
      setJournal(next);
      // Start on the newest task that has work waiting, else the newest task.
      setAssignmentId((current) => {
        if (next.assignments.some((item) => item.id === current)) return current;
        for (let at = next.assignments.length - 1; at >= 0; at -= 1) {
          if (next.rows.some((row) => row.cells[at]?.state === 'review')) return next.assignments[at]!.id;
        }
        for (let at = next.assignments.length - 1; at >= 0; at -= 1) {
          if (next.rows.some((row) => row.cells[at]?.state !== 'missing')) return next.assignments[at]!.id;
        }
        return '';
      });
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [classId, language]);
  useEffect(() => { setJournal(null); void load(); }, [load]);
  // After a work is saved it closes and the next one waiting opens by itself.
  const [savedAll, setSavedAll] = useState(false);
  const goNext = useRef<string | null>(null);
  useEffect(() => {
    const done = goNext.current;
    if (!journal || done === null) return;
    goNext.current = null;
    const at = journal.assignments.findIndex((item) => item.id === assignmentId);
    const nextHere = at >= 0 ? journal.rows.find((row) => row.studentId !== done && row.cells[at]?.state === 'review') : undefined;
    if (nextHere) { setOpen({ studentId: nextHere.studentId, studentName: nextHere.studentName }); return; }
    for (let other = journal.assignments.length - 1; other >= 0; other -= 1) {
      const row = journal.rows.find((item) => item.cells[other]?.state === 'review');
      if (row) { setAssignmentId(journal.assignments[other]!.id); setOpen({ studentId: row.studentId, studentName: row.studentName }); return; }
    }
    setSavedAll(true);
  }, [journal]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = journal?.assignments.findIndex((item) => item.id === assignmentId) ?? -1;
  const assignment = index >= 0 ? journal!.assignments[index] : undefined;
  const people = useMemo(() => (journal && index >= 0 ? journal.rows.map((row) => ({ ...row, cell: row.cells[index]! })) : []), [journal, index]);
  // Only the works that were handed in: the teacher checks, nothing else to scroll through.
  const handedIn = people.filter((row) => row.cell.state !== 'missing');
  const counts = { review: handedIn.filter((row) => row.cell.state === 'review').length, graded: handedIn.filter((row) => row.cell.state === 'graded').length };
  const shown = handedIn.filter((row) => filter === 'all' || row.cell.state === filter);
  const sentIn = (at: number) => journal?.rows.some((row) => row.cells[at]?.state !== 'missing') ?? false;
  const waitingIn = (at: number) => journal?.rows.filter((row) => row.cells[at]?.state === 'review').length ?? 0;
  const totalWaiting = journal ? journal.assignments.reduce((sum, _item, at) => sum + waitingIn(at), 0) : 0;

  if (!school.classes.length && school.status === 'loading') return <LoadingBlock language={language} />;
  if (!school.classes.length) return <div className="notice">{t(language, 'Sizga hali sinf biriktirilmagan.', 'К вам ещё не привязан класс.', 'No class is linked to you yet.')}</div>;
  return (
    <section className="check-hw">
      <div className="page-heading"><div><h1>{t(language, 'Uy vazifalari', 'Домашние задания', 'Homework')}</h1></div></div>
      <div className="check-hw-bar">
        {school.classes.length > 1 && <Select value={classId} onChange={(_event, value) => { picked.current = true; setClassId(value); setAssignmentId(''); }} options={school.classes.map((item) => ({ value: item.id, label: t(language, `${item.name} sinf`, `${item.name} класс`, `Class ${item.name}`) }))} aria-label={t(language, 'Sinf', 'Класс', 'Class')} style={{ width: 170 }} />}
        <button type="button" className="btn small" onClick={() => void load()} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={14} /></button>
        <button type="button" className="btn small primary" onClick={() => setWriting(true)}><Plus size={14} /> {t(language, 'O‘z topshirig‘im', 'Своё задание', 'My own task')}</button>
      </div>
      {writing && (
        <Modal title={t(language, 'O‘z topshirig‘ingiz', 'Своё задание', 'Your own task')} onClose={() => setWriting(false)}>
          <p className="muted" style={{ margin: 0 }}>{t(language, 'Darslikdagi uy vazifasi o‘zi beriladi. Bu yerda qo‘shimcha topshiriq yozing.', 'Домашка из учебника выдаётся сама. Здесь можно дать дополнительное задание.', 'Textbook homework is given automatically. Add an extra task here.')}</p>
          <ServerTeachingPanel school={school} language={language} onlyCreate onCreated={() => { setWriting(false); void load(); }} />
        </Modal>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
      {!journal && !error && <LoadingBlock language={language} />}
      {journal && !journal.assignments.some((_, at) => sentIn(at)) && <div className="notice">{t(language, 'Hali hech kim ish yubormadi.', 'Пока никто не прислал работу.', 'Nobody has sent work yet.')}</div>}
      {journal && journal.assignments.some((_, at) => sentIn(at)) && (
        <>
          <div className={`check-hw-total ${totalWaiting ? '' : 'is-done'}`}>
            {totalWaiting
              ? <><b>{totalWaiting}</b><span>{t(language, 'ta ish tekshirishni kutmoqda', totalWaiting === 1 ? 'работа ждёт проверки' : 'работ ждут проверки', totalWaiting === 1 ? 'work to check' : 'works to check')}</span></>
              : <><CheckCircle2 size={20} /><span>{t(language, 'Hammasi tekshirildi', 'Всё проверено', 'Everything is checked')}</span></>}
          </div>
          {(() => {
            // One tab per subject that has work to check (or any work once everything is checked).
            const withWork = journal.assignments.map((item, at) => ({ item, at })).filter(({ at }) => sentIn(at)).reverse();
            const pending = withWork.filter(({ at }) => waitingIn(at) > 0);
            const pool = filter === 'review' && pending.length ? pending : withWork;
            const subjects = [...new Set(pool.map(({ item }) => item.subject))];
            const current = journal.assignments[index];
            const activeSubject = current?.subject ?? subjects[0];
            const days = withWork.filter(({ item }) => item.subject === activeSubject);
            const lines = homeworkLines(current?.description);
            return (
              <>
                {subjects.length > 1 && (
                  <div className="check-hw-tasks" role="tablist">
                    {subjects.map((subject) => {
                      const list = withWork.filter(({ item }) => item.subject === subject);
                      const waiting = list.reduce((sum, { at }) => sum + waitingIn(at), 0);
                      return (
                        <button type="button" role="tab" key={subject} aria-selected={subject === activeSubject} className={`studio-tab ${subject === activeSubject ? 'active' : ''}`}
                          onClick={() => setAssignmentId((list.find(({ at }) => waitingIn(at) > 0) ?? list[0])!.item.id)}>
                          <span>{subjectLabel(subject, language)}</span>
                          {waiting > 0 && <b className="check-hw-badge">{waiting}</b>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {current && (
                  <div className="check-hw-day">
                    {days.length > 1
                      ? <Select value={current.id} onChange={(_event, value) => setAssignmentId(value)} aria-label={t(language, 'Kun', 'День', 'Day')} style={{ width: 210 }}
                          options={days.map(({ item, at }) => ({ value: item.id, label: `${dayLabel(item, language)}${waitingIn(at) ? ` · ${waitingIn(at)}` : ''}` }))} />
                      : <b>{dayLabel(current, language)}</b>}
                    <button type="button" className="btn small" onClick={() => setShowTask(true)}>
                      <ClipboardList size={14} /> {t(language, 'Vazifa va javob', 'Задание и ответ', 'Task and answer')}{lines.length ? ` · ${lines.length}` : ''}
                    </button>
                  </div>
                )}
                {showTask && current && (
                  <Modal title={`${subjectLabel(current.subject, language)} · ${current.title.replace(/^[^§]*·\s*/, '')}`} onClose={() => setShowTask(false)}>
                    <HomeworkKey title={current.title} description={current.description} language={language} />
                  </Modal>
                )}
              </>
            );
          })()}
          {assignment && (
            <>
              {savedAll && counts.review === 0 && <div className="notice success" role="status"><CheckCircle2 size={15} /> {t(language, 'Hammasi tekshirildi', 'Всё проверено', 'All checked')}</div>}
              <div className="check-hw-counts">
                <button type="button" className={`people-stat ${filter === 'review' ? 'on' : ''}`} onClick={() => setFilter(filter === 'review' ? 'all' : 'review')}><b>{counts.review}</b><span>{t(language, 'Tekshirish kerak', 'Ждут проверки', 'To check')}</span></button>
                <button type="button" className={`people-stat ${filter === 'graded' ? 'on' : ''}`} onClick={() => setFilter(filter === 'graded' ? 'all' : 'graded')}><b>{counts.graded}</b><span>{t(language, 'Tekshirildi', 'Проверено', 'Checked')}</span></button>
              </div>
              <ul className="check-hw-list">
                {shown.map((row, number) => (
                  <li key={row.studentId} className={`is-${row.cell.state}`}>
                    <span className="check-hw-num">{number + 1}</span>
                    <b>{row.studentName}</b>
                    {row.cell.state === 'graded'
                      ? <span className="check-hw-state ok"><CheckCircle2 size={15} /> {t(language, 'Baho', 'Оценка', 'Mark')}: <span className={`grade-mark ${markBand(row.cell.grade ?? 0)}`}>{row.cell.grade}</span></span>
                      : row.cell.state === 'review'
                        ? <span className="check-hw-state wait"><Clock3 size={15} /> {t(language, 'Topshirdi', 'Сдал(а)', 'Handed in')}</span>
                        : <span className="check-hw-state no"><XCircle size={15} /> {t(language, 'Topshirmagan', 'Не сдал(а)', 'Not handed in')}</span>}
                    {row.cell.state !== 'missing'
                      ? <button type="button" className={`btn small ${row.cell.state === 'review' ? 'primary' : ''}`} onClick={() => setOpen({ studentId: row.studentId, studentName: row.studentName })}>{row.cell.state === 'review' ? t(language, 'Tekshirish', 'Проверить', 'Check') : t(language, 'Ko‘rish', 'Посмотреть', 'View')}</button>
                      : <span />}
                  </li>
                ))}
                {shown.length === 0 && <li className="muted">{filter === 'review' ? t(language, 'Hammasi tekshirildi.', 'Всё проверено.', 'Everything is checked.') : t(language, 'Hech kim yo‘q.', 'Никого нет.', 'Nobody.')}</li>}
              </ul>
            </>
          )}
        </>
      )}
      {open && assignment && (
        <SubmissionReviewDialog assignmentId={assignment.id} assignmentTitle={assignment.title.startsWith(assignment.subject) ? `${subjectLabel(assignment.subject, language)}${assignment.title.slice(assignment.subject.length)}` : assignment.title} taskKey={<HomeworkKey title={assignment.title} description={assignment.description} language={language} />} studentId={open.studentId} studentName={open.studentName} language={language} onClose={() => setOpen(null)} onSaved={() => { goNext.current = open.studentId; setSavedAll(false); void load(); }} />
      )}
    </section>
  );
}
