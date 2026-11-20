import { useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { subjectLabel } from './ui/config';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/** The school year a date belongs to: from 1 September. 2026-11-19 → 2026. */
const schoolYearOf = (date: Date) => (date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1);
/** A 0–100 score as a school mark 2–5. */
const markOf = (score: number) => Math.max(2, Math.min(5, Math.round(score / 20)));

/** "My grades" for a pupil: marks by subject, this school year or the last one. */
export function GradesPage({ school, language }: { school: SchoolData; language: Language }) {
  const thisYear = schoolYearOf(new Date());
  const [year, setYear] = useState(thisYear);
  const rows = useMemo(() => school.assignments
    .filter((item) => schoolYearOf(new Date(item.dueAt ?? item.createdAt)) === year)
    .map((item) => {
      const score = typeof item.mySubmission?.score === 'number' ? item.mySubmission.score : null;
      return { id: item.id, title: item.title, subject: item.subject, date: item.dueAt ?? item.createdAt, mark: score === null ? null : markOf(score), sent: Boolean(item.mySubmission) };
    }), [school.assignments, year]);
  const subjects = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) map.set(row.subject, [...(map.get(row.subject) ?? []), row]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const dateText = (value: string) => new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  return (
    <section className="grades-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t(language, 'BAHOLAR', 'ОЦЕНКИ', 'GRADES')}</div>
          <h1>{t(language, 'Mening baholarim', 'Мои оценки', 'My grades')}</h1>
        </div>
        <div className="studio-tabs">
          {[thisYear, thisYear - 1].map((value) => (
            <button type="button" key={value} className={`studio-tab ${value === year ? 'active' : ''}`} onClick={() => setYear(value)}>
              {value === thisYear ? t(language, 'Shu yil', 'Этот год', 'This year') : t(language, 'O‘tgan yil', 'Прошлый год', 'Last year')} · {value}–{value + 1}
            </button>
          ))}
        </div>
      </div>
      {subjects.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><Award /></span>
          <h2>{t(language, 'Hali baho yo‘q', 'Оценок пока нет', 'No grades yet')}</h2>
          <p>{t(language, 'O‘qituvchi vazifani tekshirgach, baho shu yerda chiqadi.', 'Когда учитель проверит задание, оценка появится здесь.', 'When the teacher checks your work, the grade appears here.')}</p>
        </div>
      ) : (
        <div className="grades-subjects">
          {subjects.map(([subject, items]) => {
            const marks = items.map((item) => item.mark).filter((mark): mark is number => mark !== null);
            const average = marks.length ? (marks.reduce((sum, mark) => sum + mark, 0) / marks.length).toFixed(1) : null;
            return (
              <div key={subject} className="panel grades-subject">
                <div className="grades-subject-head">
                  <h2>{subjectLabel(subject, language)}</h2>
                  {average && <span className="grade-mark big" title={t(language, 'O‘rtacha', 'Средняя', 'Average')}>{average}</span>}
                </div>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <span className="muted">{dateText(item.date)}</span>
                      <span>{item.title}</span>
                      {item.mark !== null
                        ? <span className="grade-mark">{item.mark}</span>
                        : <small className="muted">{item.sent ? t(language, 'Tekshirilmoqda', 'На проверке', 'In review') : t(language, 'Topshirilmagan', 'Не сдано', 'Not handed in')}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
