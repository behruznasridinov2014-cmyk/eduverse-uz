import { useCallback, useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { Select } from './ui/select';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';
import { SubmissionReviewDialog } from './school-panels';

/*
 * Teacher → "Check homework": choose a class and a task, see every pupil:
 * who handed in, who is waiting for a check, who is checked. A tap opens the notebook photos.
 */
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Journal = {
  assignments: Array<{ id: string; title: string; subject: string }>;
  rows: Array<{ studentId: string; studentName: string; cells: Array<{ state: 'missing' | 'review' | 'graded'; grade: number | null }> }>;
};

export function CheckHomeworkPage({ school, language }: { school: SchoolData; language: Language }) {
  const [classId, setClassId] = useState(school.classes[0]?.id ?? '');
  const [journal, setJournal] = useState<Journal | null>(null);
  const [assignmentId, setAssignmentId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ studentId: string; studentName: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'review' | 'missing' | 'graded'>('all');

  const load = useCallback(async () => {
    if (!classId) return;
    setError('');
    try {
      const next = await customFetch<Journal>(`/api/classes/${classId}/journal`, { method: 'GET' });
      setJournal(next);
      // Start on the newest task that has work waiting, else the newest task.
      setAssignmentId((current) => {
        if (next.assignments.some((item) => item.id === current)) return current;
        for (let at = next.assignments.length - 1; at >= 0; at -= 1) {
          if (next.rows.some((row) => row.cells[at]?.state === 'review')) return next.assignments[at]!.id;
        }
        return next.assignments[next.assignments.length - 1]?.id ?? '';
      });
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [classId, language]);
  useEffect(() => { setJournal(null); void load(); }, [load]);

  const index = journal?.assignments.findIndex((item) => item.id === assignmentId) ?? -1;
  const assignment = index >= 0 ? journal!.assignments[index] : undefined;
  const people = useMemo(() => (journal && index >= 0 ? journal.rows.map((row) => ({ ...row, cell: row.cells[index]! })) : []), [journal, index]);
  const counts = { review: people.filter((row) => row.cell.state === 'review').length, missing: people.filter((row) => row.cell.state === 'missing').length, graded: people.filter((row) => row.cell.state === 'graded').length };
  const shown = people.filter((row) => filter === 'all' || row.cell.state === filter);
  const waitingIn = (at: number) => journal?.rows.filter((row) => row.cells[at]?.state === 'review').length ?? 0;

  if (!school.classes.length) return <div className="notice">{t(language, 'Sizga hali sinf biriktirilmagan.', 'К вам ещё не привязан класс.', 'No class is linked to you yet.')}</div>;
  return (
    <section className="check-hw">
      <div className="page-heading"><div><h1>{t(language, 'Uy vazifasini tekshirish', 'Проверка домашки', 'Check homework')}</h1></div></div>
      <div className="check-hw-bar">
        {school.classes.length > 1 && <Select value={classId} onChange={(_event, value) => { setClassId(value); setAssignmentId(''); }} options={school.classes.map((item) => ({ value: item.id, label: t(language, `${item.name} sinf`, `${item.name} класс`, `Class ${item.name}`) }))} aria-label={t(language, 'Sinf', 'Класс', 'Class')} style={{ width: 170 }} />}
        <button type="button" className="btn small" onClick={() => void load()} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={14} /></button>
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      {!journal && !error && <LoadingBlock language={language} />}
      {journal && journal.assignments.length === 0 && <div className="notice">{t(language, 'Bu sinfda hali vazifa yo‘q.', 'В этом классе пока нет заданий.', 'No tasks in this class yet.')}</div>}
      {journal && journal.assignments.length > 0 && (
        <>
          <div className="check-hw-tasks" role="tablist">
            {[...journal.assignments].map((item, at) => ({ item, at })).reverse().slice(0, 12).map(({ item, at }) => (
              <button type="button" role="tab" key={item.id} aria-selected={item.id === assignmentId} className={`studio-tab ${item.id === assignmentId ? 'active' : ''}`} onClick={() => setAssignmentId(item.id)}>
                <span>{item.subject} · {item.title.length > 34 ? `${item.title.slice(0, 33)}…` : item.title}</span>
                {waitingIn(at) > 0 && <b className="check-hw-badge">{waitingIn(at)}</b>}
              </button>
            ))}
          </div>
          {assignment && (
            <>
              <div className="check-hw-counts">
                <button type="button" className={`people-stat ${filter === 'review' ? 'on' : ''}`} onClick={() => setFilter(filter === 'review' ? 'all' : 'review')}><b>{counts.review}</b><span>{t(language, 'Tekshirish kerak', 'Ждут проверки', 'To check')}</span></button>
                <button type="button" className={`people-stat ${filter === 'graded' ? 'on' : ''}`} onClick={() => setFilter(filter === 'graded' ? 'all' : 'graded')}><b>{counts.graded}</b><span>{t(language, 'Tekshirildi', 'Проверено', 'Checked')}</span></button>
                <button type="button" className={`people-stat ${filter === 'missing' ? 'on' : ''}`} onClick={() => setFilter(filter === 'missing' ? 'all' : 'missing')}><b>{counts.missing}</b><span>{t(language, 'Topshirmagan', 'Не сдали', 'Not handed in')}</span></button>
              </div>
              <ul className="check-hw-list">
                {shown.map((row, number) => (
                  <li key={row.studentId} className={`is-${row.cell.state}`}>
                    <span className="check-hw-num">{number + 1}</span>
                    <b>{row.studentName}</b>
                    {row.cell.state === 'graded'
                      ? <span className="check-hw-state ok"><CheckCircle2 size={15} /> {t(language, 'Baho', 'Оценка', 'Mark')}: <span className={`grade-mark m${row.cell.grade}`}>{row.cell.grade}</span></span>
                      : row.cell.state === 'review'
                        ? <span className="check-hw-state wait"><Clock3 size={15} /> {t(language, 'Topshirdi', 'Сдал(а)', 'Handed in')}</span>
                        : <span className="check-hw-state no"><XCircle size={15} /> {t(language, 'Topshirmagan', 'Не сдал(а)', 'Not handed in')}</span>}
                    {row.cell.state !== 'missing'
                      ? <button type="button" className={`btn small ${row.cell.state === 'review' ? 'primary' : ''}`} onClick={() => setOpen({ studentId: row.studentId, studentName: row.studentName })}>{row.cell.state === 'review' ? t(language, 'Tekshirish', 'Проверить', 'Check') : t(language, 'Ko‘rish', 'Посмотреть', 'View')}</button>
                      : <span />}
                  </li>
                ))}
                {shown.length === 0 && <li className="muted">{t(language, 'Hech kim yo‘q.', 'Никого нет.', 'Nobody.')}</li>}
              </ul>
            </>
          )}
        </>
      )}
      {open && assignment && (
        <SubmissionReviewDialog assignmentId={assignment.id} assignmentTitle={`${assignment.subject} · ${assignment.title}`} studentId={open.studentId} studentName={open.studentName} language={language} onClose={() => setOpen(null)} onSaved={() => void load()} />
      )}
    </section>
  );
}
