import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { CalendarCheck2, Megaphone, RefreshCw, Send, TableProperties, Trash2 } from 'lucide-react';
import type { Language, SchoolData } from './school-data';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* -------------------------------------------------------------------------- */
/* Class announcements                                                         */
/* -------------------------------------------------------------------------- */

type Announcement = {
  id: string;
  classId: string;
  className: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export function AnnouncementsPanel({ school, user, language }: { school: SchoolData; user: User; language: Language }) {
  const canPost = user.role !== 'student' && user.role !== 'parent' && school.classes.length > 0;
  const [items, setItems] = useState<Announcement[]>([]);
  const [classId, setClassId] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await customFetch<{ announcements: Announcement[] }>('/api/me/announcements', { method: 'GET' });
      setItems(response.announcements);
    } catch {
      /* the home page works without announcements */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(event: FormEvent) {
    event.preventDefault();
    const target = classId || school.classes[0]?.id;
    if (!target || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await customFetch(`/api/classes/${target}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody('');
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await customFetch(`/api/announcements/${id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }

  if (!canPost && items.length === 0) return null;
  const locale = language === 'Русский' ? 'ru-RU' : 'en-GB';
  return (
    <section className="panel announcements">
      <div className="section-head">
        <h2><Megaphone size={16} /> {t(language, 'E’lonlar', 'Объявления', 'Announcements')}</h2>
      </div>
      {canPost && (
        <form className="announce-form" onSubmit={post}>
          {school.classes.length > 1 && (
            <select className="input" value={classId || school.classes[0]?.id} onChange={(event) => setClassId(event.target.value)} aria-label={t(language, 'Sinf', 'Класс', 'Class')}>
              {school.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <input
            className="input"
            value={body}
            maxLength={600}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t(language, 'Sinfga xabar yozing…', 'Напишите сообщение классу…', 'Write a message to the class…')}
          />
          <button type="submit" className="btn primary" disabled={busy || !body.trim()}>
            {busy ? <RefreshCw size={15} className="school-spin" /> : <Send size={15} />}
            {t(language, 'Yuborish', 'Отправить', 'Send')}
          </button>
        </form>
      )}
      {error && <div className="notice" role="alert">{error}</div>}
      {items.length === 0 ? (
        <p className="muted">{t(language, 'Hozircha e’lon yo‘q.', 'Объявлений пока нет.', 'No announcements yet.')}</p>
      ) : (
        <div className="announce-list">
          {items.map((item) => (
            <article className="announce-item" key={item.id}>
              <div>
                <p>{item.body}</p>
                <small>{item.authorName} · {item.className} · {new Date(item.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</small>
              </div>
              {canPost && (item.authorId === user.id) && (
                <button type="button" className="btn small" onClick={() => void remove(item.id)} aria-label={t(language, 'O‘chirish', 'Удалить', 'Delete')}>
                  <Trash2 size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Grade journal                                                               */
/* -------------------------------------------------------------------------- */

type Journal = {
  assignments: Array<{ id: string; title: string; subject: string }>;
  rows: Array<{
    studentId: string;
    studentName: string;
    cells: Array<{ state: 'missing' | 'review' | 'graded'; grade: number | null }>;
    average: number | null;
    attendancePercent: number | null;
  }>;
};

export function GradeJournal({ school, language }: { school: SchoolData; language: Language }) {
  const [classId, setClassId] = useState(school.classes[0]?.id ?? '');
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!classId) return;
    setError('');
    try {
      setJournal(await customFetch<Journal>(`/api/classes/${classId}/journal`, { method: 'GET' }));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [classId, language]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!school.classes.length) return null;
  return (
    <section className="panel journal">
      <div className="section-head">
        <h2><TableProperties size={16} /> {t(language, 'Baholar jurnali', 'Журнал оценок', 'Grade journal')}</h2>
        <div className="row">
          {school.classes.length > 1 && (
            <select className="input" value={classId} onChange={(event) => setClassId(event.target.value)}>
              {school.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <button type="button" className="btn small" onClick={() => void load()} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={14} /></button>
        </div>
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      {journal && journal.rows.length === 0 && <p className="muted">{t(language, 'Sinfda hali o‘quvchi yo‘q.', 'В классе пока нет учеников.', 'No students in this class yet.')}</p>}
      {journal && journal.rows.length > 0 && (
        <div className="journal-scroll">
          <table className="grade-table journal-table">
            <thead>
              <tr>
                <th>{t(language, 'O‘quvchi', 'Ученик', 'Student')}</th>
                {journal.assignments.map((item) => <th key={item.id} title={item.title}>{item.title.length > 14 ? `${item.title.slice(0, 13)}…` : item.title}</th>)}
                <th>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</th>
                <th>{t(language, 'Davomat', 'Давомат', 'Attendance')}</th>
              </tr>
            </thead>
            <tbody>
              {journal.rows.map((row) => (
                <tr key={row.studentId}>
                  <td><b>{row.studentName}</b></td>
                  {row.cells.map((cell, index) => (
                    <td key={index}>
                      {cell.state === 'graded' ? <span className="grade-mark">{cell.grade}</span> : cell.state === 'review' ? <span className="tag gold">{t(language, 'tekshirish', 'проверить', 'review')}</span> : <span className="muted">—</span>}
                    </td>
                  ))}
                  <td>{row.average !== null ? <b className="journal-average">{row.average.toFixed(1)}</b> : '—'}</td>
                  <td>{row.attendancePercent !== null ? `${row.attendancePercent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Student attendance summary                                                  */
/* -------------------------------------------------------------------------- */

type AttendanceSummaryData = { total: number; present: number; late: number; absent: number; excused: number };

export function AttendanceSummary({ language }: { language: Language }) {
  const [data, setData] = useState<AttendanceSummaryData | null>(null);
  useEffect(() => {
    void customFetch<AttendanceSummaryData>('/api/me/attendance-summary', { method: 'GET' }).then(setData).catch(() => {});
  }, []);
  if (!data || data.total === 0) return null;
  const percent = Math.round(((data.present + data.late) / data.total) * 100);
  return (
    <section className="panel attendance-summary">
      <div className="section-head">
        <h2><CalendarCheck2 size={16} /> {t(language, 'Mening davomatim', 'Моя посещаемость', 'My attendance')}</h2>
        <b className="attendance-percent">{percent}%</b>
      </div>
      <div className="test-progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="attendance-counts">
        <span><b>{data.present}</b>{t(language, 'Keldi', 'Был', 'Present')}</span>
        <span><b>{data.late}</b>{t(language, 'Kechikdi', 'Опоздал', 'Late')}</span>
        <span><b>{data.absent}</b>{t(language, 'Kelmadi', 'Не был', 'Absent')}</span>
        <span><b>{data.excused}</b>{t(language, 'Sababli', 'По причине', 'Excused')}</span>
      </div>
    </section>
  );
}
