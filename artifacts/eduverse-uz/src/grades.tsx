import { customFetch } from '@workspace/api-client-react';
import { useEffect, useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { subjectLabel } from './ui/config';
import { markBand, markOf } from './marks';
import { LoadingBlock } from './ui/loading';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/** The school year a date belongs to: from 1 September. 2026-11-19 → 2026. */
const schoolYearOf = (date: Date) => (date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1);


const SUBJECTS: Record<string, [string, string, string]> = { physics: ['Fizika', 'Физика', 'Physics'], chemistry: ['Kimyo', 'Химия', 'Chemistry'], biology: ['Biologiya', 'Биология', 'Biology'], math: ['Matematika', 'Математика', 'Maths'] };
/** Homework subjects are saved in Russian ("Математика"); journal subjects as keys ("math"). */
const keyOfSubject = (value: string) => Object.entries(SUBJECTS).find(([key, names]) => key === value || names.includes(value))?.[0] ?? value;
type Row = { date: string; mark: number | null; absent?: boolean };

/** "My grades" for a pupil: only the marks — lesson, homework and behaviour — by subject. No titles, no long words. */
export function GradesPage({ school, language }: { school: SchoolData; language: Language }) {
  const thisYear = schoolYearOf(new Date());
  const [year, setYear] = useState(thisYear);
  const [journal, setJournal] = useState<Array<{ subject: string; date: string; mark: number | null; absent: boolean }> | null>(null);
  useEffect(() => { void customFetch<{ marks: Array<{ subject: string; date: string; mark: number | null; absent: boolean }> }>('/api/me/marks', { method: 'GET' }).then((data) => setJournal(data.marks)).catch(() => setJournal([])); }, []);
  const inYear = (date: string) => schoolYearOf(new Date(date)) === year;
  const table = useMemo(() => {
    const map = new Map<string, { lesson: Row[]; homework: Row[]; behavior: Row[] }>();
    const slot = (key: string) => { let item = map.get(key); if (!item) { item = { lesson: [], homework: [], behavior: [] }; map.set(key, item); } return item; };
    for (const row of journal ?? []) {
      if (!inYear(row.date)) continue;
      if (row.subject.startsWith('behavior:')) slot(row.subject.slice(9)).behavior.push(row);
      else if (row.subject.startsWith('homework:')) slot(row.subject.slice(9)).homework.push(row);
      else slot(row.subject).lesson.push(row);
    }
    for (const item of school.assignments) {
      const score = typeof item.mySubmission?.score === 'number' ? item.mySubmission.score : null;
      const date = item.dueAt ?? item.createdAt;
      if (score === null || !inYear(date)) continue;
      slot(keyOfSubject(item.subject)).homework.push({ date, mark: markOf(score) });
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [journal, school.assignments, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = (rows: Row[]) => rows.length === 0 ? <span className="muted">—</span> : rows.slice(0, 14).map((row, index) => row.absent
    ? <span key={index} className="journal-nb" title={row.date.slice(0, 10).split('-').reverse().join('.')}>{t(language, 'nb', 'нб', 'ab')}</span>
    : <span key={index} className={`grade-mark ${markBand(row.mark ?? 0)}`} title={row.date.slice(0, 10).split('-').reverse().join('.')}>{row.mark}</span>);
  const average = (rows: Row[]) => { const n = rows.map((row) => row.mark).filter((mark): mark is number => typeof mark === 'number'); return n.length ? (n.reduce((a, b) => a + b, 0) / n.length).toFixed(1) : '—'; };

  const hasBehavior = table.some(([, item]) => item.behavior.length > 0);
  return (
    <section className="grades-page">
      <div className="page-heading">
        <div>
          <h1>{t(language, 'Mening baholarim', 'Мои оценки', 'My grades')}</h1>
        </div>
        <div className="studio-tabs">
          {[thisYear, thisYear - 1].map((value) => (
            <button type="button" key={value} className={`studio-tab ${value === year ? 'active' : ''}`} onClick={() => setYear(value)}>
              {value === thisYear ? t(language, 'Shu yil', 'Этот год', 'This year') : t(language, 'O‘tgan yil', 'Прошлый год', 'Last year')}
            </button>
          ))}
        </div>
      </div>
      {journal === null ? <LoadingBlock language={language} /> : table.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><Award /></span>
          <h2>{t(language, 'Hali baho yo‘q', 'Оценок пока нет', 'No grades yet')}</h2>
        </div>
      ) : (
        <div className="panel journal-scroll">
          <table className="grade-table my-grades-table">
            <thead>
              <tr>
                <th>{t(language, 'Fan', 'Предмет', 'Subject')}</th>
                <th>{t(language, 'Darsda', 'За урок', 'Lesson')}</th>
                <th>{t(language, 'Uy vazifasi', 'Домашка', 'Homework')}</th>
                {hasBehavior && <th>{t(language, 'Xulq', 'Поведение', 'Behaviour')}</th>}
                <th>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</th>
              </tr>
            </thead>
            <tbody>
              {table.map(([subject, item]) => (
                <tr key={subject}>
                  <td className="my-grades-subject"><b>{SUBJECTS[subject] ? t(language, ...SUBJECTS[subject]!) : subjectLabel(subject, language)}</b></td>
                  <td data-label={t(language, 'Darsda', 'За урок', 'Lesson')}><span className="journal-mine-marks">{chips(item.lesson)}</span></td>
                  <td data-label={t(language, 'Uy vazifasi', 'Домашка', 'Homework')}><span className="journal-mine-marks">{chips(item.homework)}</span></td>
                  {hasBehavior && <td data-label={t(language, 'Xulq', 'Поведение', 'Behaviour')}><span className="journal-mine-marks">{chips(item.behavior)}</span></td>}
                  <td data-label={t(language, 'O‘rtacha', 'Средняя', 'Average')}><b>{average([...item.lesson, ...item.homework])}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
