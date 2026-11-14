import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CalendarCheck2, Download, GraduationCap, Link2, NotebookPen, RefreshCw, School, Users, Video } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Uzbek' ? uz : language === 'Русский' ? ru : en;

/* -------------------------------------------------------------------------- */
/* Parent cabinet                                                              */
/* -------------------------------------------------------------------------- */

type Child = {
  id: string;
  name: string;
  classes: string[];
  average: number | null;
  attendancePercent: number | null;
  absences: string[];
  homework: Array<{ id: string; title: string; subject: string; dueAt: string | null; state: 'missing' | 'review' | 'graded'; grade: number | null; feedback: string }>;
};

export function ParentCabinet({ language }: { language: Language }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    customFetch<{ children: Child[] }>('/api/me/children', { method: 'GET' })
      .then((response) => setChildren(response.children))
      .catch((requestError) => setError(friendlyError(requestError, language)));
  }, [language]);

  if (error) return <div className="notice" role="alert">{error}</div>;
  if (!children) return <div className="panel"><p className="muted">{t(language, 'Yuklanmoqda…', 'Загрузка…', 'Loading…')}</p></div>;
  if (children.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Link2 /></span>
        <h2>{t(language, 'Farzand hali biriktirilmagan', 'Ребёнок ещё не привязан', 'No child linked yet')}</h2>
        <p>{t(language,
          'Sinf rahbariga o‘z loginingizni va farzandingiz loginini ayting — u sizni bir daqiqada biriktiradi.',
          'Сообщите классному руководителю свой логин и логин ребёнка — он привяжет вас за минуту.',
          'Give the class teacher your login and your child’s login — they link you in a minute.')}</p>
      </div>
    );
  }
  const child = children[Math.min(active, children.length - 1)]!;
  const missing = child.homework.filter((item) => item.state === 'missing').length;
  return (
    <section className="cabinet">
      {children.length > 1 && (
        <div className="row cabinet-tabs">
          {children.map((item, index) => (
            <button type="button" key={item.id} className={`btn ${index === active ? 'primary' : ''}`} onClick={() => setActive(index)}>{item.name}</button>
          ))}
        </div>
      )}
      <div className="cabinet-hero">
        <span className="avatar">{child.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <h2>{child.name}</h2>
          <p className="muted">{child.classes.join(', ') || '—'}</p>
        </div>
      </div>
      <div className="kpi-grid">
        <Kpi icon={GraduationCap} label={t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average grade')} value={child.average !== null ? child.average.toFixed(1) : '—'} />
        <Kpi icon={CalendarCheck2} label={t(language, 'Davomat', 'Посещаемость', 'Attendance')} value={child.attendancePercent !== null ? `${child.attendancePercent}%` : '—'} />
        <Kpi icon={NotebookPen} label={t(language, 'Bajarilmagan vazifa', 'Не сдано заданий', 'Missing homework')} value={String(missing)} warn={missing > 0} />
      </div>
      {child.absences.length > 0 && (
        <div className="notice">{t(language, 'Kelmagan kunlar', 'Пропуски', 'Absent on')}: {child.absences.join(', ')}</div>
      )}
      <section className="panel">
        <div className="section-head"><h2><NotebookPen size={16} /> {t(language, 'Uy vazifalari va baholar', 'Домашние задания и оценки', 'Homework and grades')}</h2></div>
        {child.homework.length === 0 ? <p className="muted">{t(language, 'Hozircha vazifa yo‘q.', 'Заданий пока нет.', 'No homework yet.')}</p> : (
          <table className="grade-table">
            <thead><tr>
              <th>{t(language, 'Topshiriq', 'Задание', 'Assignment')}</th>
              <th>{t(language, 'Holat', 'Статус', 'Status')}</th>
              <th>{t(language, 'Baho', 'Оценка', 'Grade')}</th>
            </tr></thead>
            <tbody>
              {child.homework.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.title}</b><br /><span className="muted">{item.subject}{item.feedback ? ` · ${item.feedback}` : ''}</span></td>
                  <td>{item.state === 'graded' ? t(language, 'Tekshirildi', 'Проверено', 'Checked') : item.state === 'review' ? t(language, 'Tekshirilmoqda', 'На проверке', 'In review') : <span className="tag gold">{t(language, 'Topshirilmagan', 'Не сдано', 'Not submitted')}</span>}</td>
                  <td>{item.grade !== null ? <span className="grade-mark">{item.grade}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, warn = false }: { icon: typeof Users; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`kpi ${warn ? 'warn' : ''}`}>
      <span className="kpi-icon"><Icon size={18} /></span>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Director dashboard                                                          */
/* -------------------------------------------------------------------------- */

type Dashboard = {
  students: number; teachers: number; parents: number; classes: number;
  attendancePercent: number | null; absentToday: number; assignments: number; toReview: number;
  average: number | null; lessons30d: number;
  perClass: Array<{ id: string; name: string; attendancePercent: number | null; assignments: number; average: number | null; lessons: number }>;
};

export function DirectorDashboard({ schoolId, language }: { schoolId: string; language: Language }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await customFetch<Dashboard>(`/api/schools/${schoolId}/dashboard`, { method: 'GET' }));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }, [schoolId, language]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="notice" role="alert">{error}</div>;
  if (!data) return <div className="panel"><p className="muted">{t(language, 'Yuklanmoqda…', 'Загрузка…', 'Loading…')}</p></div>;
  const weak = data.perClass.filter((item) => (item.attendancePercent !== null && item.attendancePercent < 85) || (item.average !== null && item.average < 3.5));
  return (
    <section className="cabinet">
      <div className="kpi-grid">
        <Kpi icon={Users} label={t(language, 'O‘quvchilar', 'Ученики', 'Students')} value={String(data.students)} />
        <Kpi icon={GraduationCap} label={t(language, 'O‘qituvchilar', 'Учителя', 'Teachers')} value={String(data.teachers)} />
        <Kpi icon={School} label={t(language, 'Sinflar', 'Классы', 'Classes')} value={String(data.classes)} />
        <Kpi icon={CalendarCheck2} label={t(language, 'Davomat, 30 kun', 'Посещаемость, 30 дней', 'Attendance, 30 days')} value={data.attendancePercent !== null ? `${data.attendancePercent}%` : '—'} warn={data.attendancePercent !== null && data.attendancePercent < 85} />
        <Kpi icon={NotebookPen} label={t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average grade')} value={data.average !== null ? data.average.toFixed(1) : '—'} />
        <Kpi icon={Video} label={t(language, 'Onlayn darslar, 30 kun', 'Онлайн-уроков, 30 дней', 'Online lessons, 30 days')} value={String(data.lessons30d)} />
      </div>
      {(data.absentToday > 0 || data.toReview > 0) && (
        <div className="notice">
          {data.absentToday > 0 && <span>{t(language, 'Bugun kelmaganlar', 'Сегодня отсутствуют', 'Absent today')}: <b>{data.absentToday}</b>. </span>}
          {data.toReview > 0 && <span>{t(language, 'Tekshirilmagan ishlar', 'Непроверенных работ', 'Unchecked work')}: <b>{data.toReview}</b>.</span>}
        </div>
      )}
      <section className="panel">
        <div className="section-head">
          <h2><School size={16} /> {t(language, 'Sinflar bo‘yicha', 'По классам', 'By class')}</h2>
          <div className="row">
            <a className="btn small" href={`/api/schools/${schoolId}/export.csv`} download><Download size={14} /> {t(language, 'Excel ga yuklash', 'Выгрузить в Excel', 'Export to Excel')}</a>
            <button type="button" className="btn small" onClick={() => void load()}><RefreshCw size={14} /></button>
          </div>
        </div>
        {data.perClass.length === 0 ? <p className="muted">{t(language, 'Sinflar yo‘q.', 'Классов нет.', 'No classes.')}</p> : (
          <div className="journal-scroll">
            <table className="grade-table">
              <thead><tr>
                <th>{t(language, 'Sinf', 'Класс', 'Class')}</th>
                <th>{t(language, 'Davomat', 'Посещаемость', 'Attendance')}</th>
                <th>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</th>
                <th>{t(language, 'Vazifalar', 'Заданий', 'Assignments')}</th>
                <th>{t(language, 'Onlayn darslar', 'Онлайн-уроков', 'Online lessons')}</th>
              </tr></thead>
              <tbody>
                {data.perClass.map((item) => (
                  <tr key={item.id} className={weak.includes(item) ? 'row-warn' : ''}>
                    <td><b>{item.name}</b></td>
                    <td>{item.attendancePercent !== null ? `${item.attendancePercent}%` : '—'}</td>
                    <td>{item.average !== null ? <span className="grade-mark">{item.average.toFixed(1)}</span> : '—'}</td>
                    <td>{item.assignments}</td>
                    <td>{item.lessons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {weak.length > 0 && <p className="muted">{t(language, 'Belgilangan sinflarga e’tibor bering: davomat 85% dan past yoki o‘rtacha baho 3,5 dan past.', 'Обратите внимание на отмеченные классы: посещаемость ниже 85% или средняя ниже 3,5.', 'Watch the highlighted classes: attendance below 85% or average below 3.5.')}</p>}
      </section>
      <ParentLinkForm language={language} />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff: link a parent to a student                                           */
/* -------------------------------------------------------------------------- */

export function ParentLinkForm({ language }: { language: Language }) {
  const [parentLogin, setParentLogin] = useState('');
  const [studentLogin, setStudentLogin] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await customFetch<{ parent: string; student: string }>('/api/parents/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentLogin: parentLogin.trim(), studentLogin: studentLogin.trim() }),
      });
      setMessage(t(language, `${response.parent} → ${response.student} biriktirildi.`, `${response.parent} привязан к ${response.student}.`, `${response.parent} linked to ${response.student}.`));
      setParentLogin('');
      setStudentLogin('');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-head"><h2><Link2 size={16} /> {t(language, 'Ota-onani biriktirish', 'Привязать родителя', 'Link a parent')}</h2></div>
      <p className="muted">{t(language, 'Ota-ona o‘z kabinetida farzandining baholari, davomati va vazifalarini ko‘radi.', 'Родитель увидит в своём кабинете оценки, посещаемость и задания ребёнка.', 'The parent sees the child’s grades, attendance and homework.')}</p>
      <form className="announce-form" onSubmit={submit}>
        <input className="input" value={parentLogin} onChange={(event) => setParentLogin(event.target.value)} placeholder={t(language, 'Ota-ona logini', 'Логин родителя', 'Parent login')} required />
        <input className="input" value={studentLogin} onChange={(event) => setStudentLogin(event.target.value)} placeholder={t(language, 'O‘quvchi logini', 'Логин ученика', 'Student login')} required />
        <button type="submit" className="btn primary" disabled={busy}>{t(language, 'Biriktirish', 'Привязать', 'Link')}</button>
      </form>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
