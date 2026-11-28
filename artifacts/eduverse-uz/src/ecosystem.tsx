import './ecosystem.css';
import { LensRow } from './glass-nav';
import { Select } from './ui/select';
import { DateField } from './ui/date-field';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import {
  AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Ban, BookOpenCheck, CalendarClock, CalendarCheck2, CheckCircle2, ClipboardCheck, Download,
  GraduationCap, MessageCircle, Minus, NotebookPen, Plus, Printer, Receipt, RefreshCw, School, Search, Send, UserRoundCheck, Users, Wallet, X,
} from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';
import { LoadingBlock } from './ui/loading';
import { lessonSubjectName, statusOf, topicForLesson, useLessonCourses, useToday, type TodayLesson as TodayLessonFull } from './today';
import { Modal } from './ui/modal';
import { ClassPupilsModal, PupilModal } from './school-panels';

/*
 * EDUVERSE as one school system: the director's analytics, the teacher's day,
 * parent ↔ teacher messages, the parent's weekly report, tuition payments and timetable changes.
 */
const subj = (subject: string, language: Language) => (subject ? lessonSubjectName(subject, language) : '');
const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
const sum = (value: number) => `${value.toLocaleString('ru-RU')} ${'сум'}`;
const shortDate = (value: string) => { const d = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(d.getTime()) ? value : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7);
const todayText = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

function useLoad<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setError(null);
    customFetch<T>(url, { method: 'GET' })
      .then((response) => { if (alive) setData(response); })
      .catch((requestError) => { if (alive) setError(requestError); });
    return () => { alive = false; };
  }, [url, revision, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setRevision((value) => value + 1), setData };
}

function Stat({ icon, label, value, note, tone = '' }: { icon: ReactNode; label: string; value: string; note?: ReactNode; tone?: '' | 'warn' | 'good' | 'bad' }) {
  return (
    <div className={`eco-stat ${tone}`}>
      <span className="eco-stat-icon">{icon}</span>
      <b>{value}</b>
      <span className="eco-stat-label">{label}</span>
      {note && <span className="eco-stat-note">{note}</span>}
    </div>
  );
}

function Trend({ now, prev, unit = '', invert = false }: { now: number | null; prev: number | null; unit?: string; invert?: boolean }) {
  if (now === null || prev === null) return <span className="eco-trend flat"><Minus size={12} /></span>;
  const delta = Math.round((now - prev) * 10) / 10;
  if (Math.abs(delta) < (unit === '%' ? 1 : 0.2)) return <span className="eco-trend flat"><Minus size={12} /> 0{unit}</span>;
  const good = invert ? delta < 0 : delta > 0;
  return <span className={`eco-trend ${good ? 'up' : 'down'}`}>{delta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{delta > 0 ? '+' : ''}{delta}{unit}</span>;
}

function Section({ icon, title, children, actions, className = '' }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`panel eco-section ${className}`}>
      <div className="section-head"><h2>{icon} {title}</h2>{actions && <div className="row eco-actions">{actions}</div>}</div>
      {children}
    </section>
  );
}

function ErrorNote({ error, language }: { error: unknown; language: Language }) {
  return <div className="notice" role="alert">{friendlyError(error, language)}</div>;
}

function downloadCsv(name: string, rows: Array<Array<string | number | null>>) {
  const text = rows.map((row) => row.map((cell) => {
    const value = cell === null || cell === undefined ? '' : String(cell);
    return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(';')).join('\r\n');
  // The BOM makes Excel read Cyrillic and Uzbek letters correctly.
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

const REASON: Record<string, [string, string, string]> = {
  absent: ['Ko‘p qoldirgan', 'Частые пропуски', 'Often absent'],
  low: ['Past baholar', 'Низкие оценки', 'Low marks'],
  falling: ['Baholar tushmoqda', 'Оценки снижаются', 'Marks are falling'],
  homework: ['Vazifa topshirilmagan', 'Не сдаёт задания', 'Missing homework'],
};
type AttentionPupil = { id: string; name: string; className: string; classId: string; reasons: Array<{ kind: string; value: string }> };

function AttentionList({ items, language, empty }: { items: AttentionPupil[]; language: Language; empty: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<AttentionPupil | null>(null);
  if (!items.length) return <p className="muted eco-empty"><CheckCircle2 size={15} /> {empty}</p>;
  const shown = all ? items : items.slice(0, 6);
  return (
    <>
    <ul className="eco-attention">
      {shown.map((pupil) => (
        <li key={`${pupil.id}:${pupil.classId}`} className="is-clickable" role="button" tabIndex={0} onClick={() => setOpen(pupil)} onKeyDown={(event) => { if (event.key === 'Enter') setOpen(pupil); }}>
          <span className="eco-avatar">{pupil.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>{pupil.name}</b>
            <span className="muted">{pupil.className}</span>
          </div>
          <div className="eco-reasons">
            {pupil.reasons.map((reason) => (
              <span key={reason.kind} className={`eco-reason ${reason.kind}`}>{t(language, ...(REASON[reason.kind] ?? ['', reason.kind, reason.kind]))}: {reason.value}</span>
            ))}
          </div>
        </li>
      ))}
    </ul>
    {items.length > 6 && <button type="button" className="btn small eco-more" onClick={() => setAll(!all)}>{all ? t(language, 'Yig‘ish', 'Свернуть', 'Show less') : t(language, `Hammasi (${items.length})`, `Показать всех (${items.length})`, `Show all (${items.length})`)}</button>}
    {open && (
      <PupilModal classId={open.classId} pupilId={open.id} name={open.name} language={language} onClose={() => setOpen(null)}>
        <div className="eco-reasons eco-reasons-modal">
          <span className="muted">{open.className}</span>
          {open.reasons.map((reason) => <span key={reason.kind} className={`eco-reason ${reason.kind}`}>{t(language, ...(REASON[reason.kind] ?? ['', reason.kind, reason.kind]))}: {reason.value}</span>)}
        </div>
      </PupilModal>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 1. School analytics                                                  */
/* ------------------------------------------------------------------ */
type Analytics = {
  period: string; from: string; to: string; days: number;
  totals: { students: number; teachers: number; parents: number; classes: number; attendancePercent: number | null; attendancePrev: number | null; absentToday: number; average: number | null; averagePrev: number | null; unchecked: number; emptyJournals: number; needAttention: number; homeworkAverage: number | null };
  perClass: Array<{ id: string; name: string; grade: number; students: number; attendancePercent: number | null; attendancePrev: number | null; absences: number; average: number | null; averagePrev: number | null; marks: number; unchecked: number }>;
  perSubject: Array<{ subject: string; average: number | null; averagePrev: number | null; marks: number; attendancePercent: number | null }>;
  teachers: Array<{ id: string; name: string; classes: number; unchecked: number; oldestDays: number | null; emptyJournals: number; homeworkGiven: number }>;
  emptyJournals: Array<{ date: string; classId: string; className: string; subject: string; teacherId: string | null; period: number }>;
  attention: AttentionPupil[];
  attentionClasses: string[];
};

const PAGE_ROWS = 8;

/** The first few rows on the page; the whole list opens in a window, so the page stays short. */
function ShortList<T>({ items, row, title, language, limit = 5 }: { items: T[]; row: (item: T) => ReactNode; title: string; language: Language; limit?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ul className="eco-list">{items.slice(0, limit).map(row)}</ul>
      {items.length > limit && <button type="button" className="btn small eco-more" onClick={() => setOpen(true)}>{t(language, `Hammasi (${items.length})`, `Показать все (${items.length})`, `Show all (${items.length})`)}</button>}
      {open && <Modal title={title} wide onClose={() => setOpen(false)}><ul className="eco-list">{items.map(row)}</ul></Modal>}
    </>
  );
}

export function SchoolAnalyticsPage({ schoolId, language }: { schoolId: string; language: Language }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const { data, error, reload } = useLoad<Analytics>(`/api/schools/${schoolId}/analytics?period=${period}`);
  const periods: Array<[typeof period, string]> = [['week', t(language, 'Hafta', 'Неделя', 'Week')], ['month', t(language, 'Oy', 'Месяц', 'Month')], ['quarter', t(language, 'Chorak', 'Четверть', 'Quarter')]];
  const fresh = data && data.period === period ? data : null;
  const [openClass, setOpenClass] = useState<Analytics['perClass'][number] | null>(null);
  const [openTeacher, setOpenTeacher] = useState<Analytics['teachers'][number] | null>(null);
  const teacherName = (id: string | null) => fresh?.teachers.find((item) => item.id === id)?.name ?? '—';
  function exportCsv() {
    if (!fresh) return;
    const rows: Array<Array<string | number | null>> = [
      [t(language, 'Davr', 'Период', 'Period'), `${fresh.from} — ${fresh.to}`],
      [],
      [t(language, 'Sinf', 'Класс', 'Class'), t(language, 'O‘quvchilar', 'Учеников', 'Pupils'), t(language, 'Davomat, %', 'Посещаемость, %', 'Attendance, %'), t(language, 'Qoldirishlar', 'Пропусков', 'Absences'), t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average mark'), t(language, 'Tekshirilmagan', 'Не проверено', 'Unchecked')],
      ...fresh.perClass.map((item) => [item.name, item.students, item.attendancePercent, item.absences, item.average, item.unchecked]),
      [],
      [t(language, 'Fan', 'Предмет', 'Subject'), t(language, 'O‘rtacha', 'Средняя', 'Average'), t(language, 'Oldingi davr', 'Прошлый период', 'Previous'), t(language, 'Baholar soni', 'Оценок', 'Marks')],
      ...fresh.perSubject.map((item) => [subj(item.subject, language), item.average, item.averagePrev, item.marks]),
      [],
      [t(language, 'O‘qituvchi', 'Учитель', 'Teacher'), t(language, 'Sinflar', 'Классов', 'Classes'), t(language, 'Tekshirilmagan', 'Не проверено', 'Unchecked'), t(language, 'Bo‘sh jurnal', 'Незаполненных уроков', 'Empty journals'), t(language, 'Berilgan vazifa', 'Задано заданий', 'Homework given')],
      ...fresh.teachers.map((item) => [item.name, item.classes, item.unchecked, item.emptyJournals, item.homeworkGiven]),
    ];
    downloadCsv(`eduverse-otchet-${fresh.period}-${fresh.to}.csv`, rows);
  }
  return (
    <div className="eco">
      <div className="eco-toolbar">
        <LensRow>
          {periods.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={period === key} className={period === key ? 'on' : ''} onClick={() => setPeriod(key)}>{label}</button>)}
        </LensRow>
        {fresh && <span className="muted">{shortDate(fresh.from)} — {shortDate(fresh.to)}</span>}
        <div className="row eco-actions">
          <button type="button" className="btn small" onClick={reload} aria-label={t(language, 'Yangilash', 'Обновить', 'Refresh')}><RefreshCw size={14} /></button>
          <button type="button" className="btn small" disabled={!fresh} onClick={exportCsv}><Download size={14} /> Excel</button>
          <button type="button" className="btn small" disabled={!fresh} onClick={() => window.print()}><Printer size={14} /> PDF</button>
        </div>
      </div>
      {error ? <ErrorNote error={error} language={language} /> : !fresh ? <LoadingBlock language={language} /> : <>
        <div className="eco-stats">
          <Stat icon={<CalendarCheck2 size={18} />} label={t(language, 'Davomat', 'Посещаемость', 'Attendance')} value={fresh.totals.attendancePercent !== null ? `${fresh.totals.attendancePercent}%` : '—'} note={<Trend now={fresh.totals.attendancePercent} prev={fresh.totals.attendancePrev} unit="%" />} tone={fresh.totals.attendancePercent !== null && fresh.totals.attendancePercent < 85 ? 'warn' : ''} />
          <Stat icon={<GraduationCap size={18} />} label={t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average mark')} value={fresh.totals.average !== null ? fresh.totals.average.toFixed(1) : '—'} note={<Trend now={fresh.totals.average} prev={fresh.totals.averagePrev} />} />
          <Stat icon={<School size={18} />} label={t(language, 'Sinflar', 'Классы', 'Classes')} value={String(fresh.totals.classes)} note={<span className="muted">{fresh.totals.students} {t(language, 'o‘quvchi', 'учеников', 'pupils')}</span>} />
          <Stat icon={<Users size={18} />} label={t(language, 'O‘qituvchilar', 'Учителя', 'Teachers')} value={String(fresh.totals.teachers)} />
          <Stat icon={<AlertTriangle size={18} />} label={t(language, 'E’tibor kerak', 'Требуют внимания', 'Need attention')} value={String(fresh.totals.needAttention)} tone={fresh.totals.needAttention ? 'bad' : 'good'} />
          <Stat icon={<ClipboardCheck size={18} />} label={t(language, 'Tekshirilmagan ishlar', 'Не проверено работ', 'Unchecked work')} value={String(fresh.totals.unchecked)} tone={fresh.totals.unchecked > 20 ? 'warn' : ''} />
          <Stat icon={<NotebookPen size={18} />} label={t(language, 'Bo‘sh jurnallar', 'Незаполненные уроки', 'Empty journals')} value={String(fresh.totals.emptyJournals)} tone={fresh.totals.emptyJournals ? 'warn' : 'good'} note={<span className="muted">{t(language, 'oxirgi 2 hafta', 'за 2 недели', 'last 2 weeks')}</span>} />
          <Stat icon={<UserRoundCheck size={18} />} label={t(language, 'Bugun yo‘q', 'Сегодня отсутствуют', 'Absent today')} value={String(fresh.totals.absentToday)} />
        </div>

        <div className="eco-grid">
          <Section icon={<AlertTriangle size={16} />} title={t(language, 'E’tibor talab qiladi', 'Требуют внимания', 'Need attention')}>
            {fresh.attentionClasses.length > 0 && (
              <div className="eco-chips">
                {fresh.perClass.filter((item) => fresh.attentionClasses.includes(item.id)).map((item) => (
                  <span key={item.id} className="eco-chip bad"><School size={13} /> {item.name}: {item.attendancePercent !== null ? `${item.attendancePercent}%` : '—'} · {item.average !== null ? item.average.toFixed(1) : '—'}</span>
                ))}
              </div>
            )}
            <AttentionList items={fresh.attention.slice(0, 12)} language={language} empty={t(language, 'Hammasi joyida.', 'Все в порядке.', 'All good.')} />
          </Section>
          <Section icon={<BookOpenCheck size={16} />} title={t(language, 'Fanlar bo‘yicha', 'По предметам', 'By subject')}>
            {fresh.perSubject.length === 0 ? <p className="muted">{t(language, 'Bu davrda jurnalda baho yo‘q.', 'В журнале за этот период нет оценок.', 'No marks in the journal for this period.')}</p> : (
              <ul className="eco-bars">
                {fresh.perSubject.map((item) => (
                  <li key={item.subject}>
                    <span className="eco-bar-label">{subj(item.subject, language)}</span>
                    <span className="eco-bar"><span style={{ width: `${((item.average ?? 0) / 10) * 100}%` }} className={item.average !== null && item.average < 6 ? 'low' : ''} /></span>
                    <b>{item.average !== null ? item.average.toFixed(1) : '—'}</b>
                    <Trend now={item.average} prev={item.averagePrev} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <Section icon={<School size={16} />} title={t(language, 'Sinflar', 'Классы', 'Classes')}>
          {fresh.perClass.length === 0 ? <p className="muted">{t(language, 'Sinflar yo‘q.', 'Классов нет.', 'No classes.')}</p> : (
            <div className="journal-scroll">
              <table className="grade-table eco-table">
                <thead><tr>
                  <th>{t(language, 'Sinf', 'Класс', 'Class')}</th>
                  <th>{t(language, 'O‘quvchi', 'Учеников', 'Pupils')}</th>
                  <th>{t(language, 'Davomat', 'Посещаемость', 'Attendance')}</th>
                  <th>{t(language, 'Qoldirish', 'Пропусков', 'Absences')}</th>
                  <th>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</th>
                  <th>{t(language, 'Tekshirilmagan', 'Не проверено', 'Unchecked')}</th>
                </tr></thead>
                <tbody>
                  {fresh.perClass.map((item) => (
                    <tr key={item.id} className={`is-clickable ${fresh.attentionClasses.includes(item.id) ? 'row-warn' : ''}`} tabIndex={0} onClick={() => setOpenClass(item)} onKeyDown={(event) => { if (event.key === 'Enter') setOpenClass(item); }}>
                      <td><b>{item.name}</b></td>
                      <td>{item.students}</td>
                      <td>{item.attendancePercent !== null ? `${item.attendancePercent}%` : '—'} <Trend now={item.attendancePercent} prev={item.attendancePrev} unit="%" /></td>
                      <td>{item.absences}</td>
                      <td>{item.average !== null ? <span className="grade-mark">{item.average.toFixed(1)}</span> : '—'} <Trend now={item.average} prev={item.averagePrev} /></td>
                      <td>{item.unchecked || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section icon={<Users size={16} />} title={t(language, 'O‘qituvchilar ishi', 'Работа учителей', 'Teachers')}>
          {fresh.teachers.length === 0 ? <p className="muted">{t(language, 'O‘qituvchilar yo‘q.', 'Учителей нет.', 'No teachers.')}</p> : (
            <div className="journal-scroll">
              <table className="grade-table eco-table">
                <thead><tr>
                  <th>{t(language, 'O‘qituvchi', 'Учитель', 'Teacher')}</th>
                  <th>{t(language, 'Sinflar', 'Классов', 'Classes')}</th>
                  <th>{t(language, 'Tekshirilmagan', 'Не проверено', 'Unchecked')}</th>
                  <th>{t(language, 'Eng eskisi', 'Самая старая', 'Oldest')}</th>
                  <th>{t(language, 'Bo‘sh jurnal', 'Пустой журнал', 'Empty journal')}</th>
                  <th>{t(language, 'Vazifa berdi', 'Задал заданий', 'Homework given')}</th>
                </tr></thead>
                <tbody>
                  {fresh.teachers.map((item) => (
                    <tr key={item.id} className={`is-clickable ${item.unchecked > 10 || item.emptyJournals > 3 ? 'row-warn' : ''}`} tabIndex={0} onClick={() => setOpenTeacher(item)} onKeyDown={(event) => { if (event.key === 'Enter') setOpenTeacher(item); }}>
                      <td><b>{item.name}</b></td>
                      <td>{item.classes}</td>
                      <td>{item.unchecked || '—'}</td>
                      <td>{item.oldestDays !== null ? t(language, `${item.oldestDays} kun`, `${item.oldestDays} дн.`, `${item.oldestDays} d`) : '—'}</td>
                      <td>{item.emptyJournals || '—'}</td>
                      <td>{item.homeworkGiven}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section icon={<NotebookPen size={16} />} title={t(language, 'Jurnal to‘ldirilmagan darslar', 'Уроки без отметок в журнале', 'Lessons with an empty journal')}>
          {fresh.emptyJournals.length === 0 ? <p className="muted eco-empty"><CheckCircle2 size={15} /> {t(language, 'Barcha jurnallar to‘ldirilgan.', 'Все журналы заполнены.', 'All journals are filled.')}</p> : (
            <ShortList
              items={fresh.emptyJournals}
              title={t(language, 'Jurnal to‘ldirilmagan darslar', 'Уроки без отметок в журнале', 'Lessons with an empty journal')}
              language={language}
              row={(item) => (
                <li key={`${item.date}:${item.classId}:${item.period}`}>
                  <span className="eco-date">{shortDate(item.date)}</span>
                  <span><b>{item.className}</b> · {subj(item.subject, language)} · {t(language, `${item.period}-dars`, `${item.period}-й урок`, `lesson ${item.period}`)}</span>
                  <span className="muted">{teacherName(item.teacherId)}</span>
                </li>
              )}
            />
          )}
        </Section>
      </>}
      {openClass && <ClassPupilsModal classId={openClass.id} title={t(language, `${openClass.name} sinf`, `${openClass.name} класс`, `Class ${openClass.name}`)} language={language} onClose={() => setOpenClass(null)} />}
      {openTeacher && fresh && (
        <Modal title={openTeacher.name} onClose={() => setOpenTeacher(null)}>
          <div className="myday-facts">
            <div><small>{t(language, 'Sinflar', 'Классов', 'Classes')}</small><b>{openTeacher.classes}</b></div>
            <div><small>{t(language, 'Tekshirilmagan ishlar', 'Не проверено работ', 'Unchecked work')}</small><b>{openTeacher.unchecked || '—'}{openTeacher.oldestDays !== null && <span className="mc-detail">{t(language, `eng eskisi ${openTeacher.oldestDays} kun`, `самая старая — ${openTeacher.oldestDays} дн.`, `oldest ${openTeacher.oldestDays} d`)}</span>}</b></div>
            <div><small>{t(language, 'Vazifa berdi', 'Задал заданий', 'Homework given')}</small><b>{openTeacher.homeworkGiven}</b></div>
          </div>
          <h3 className="mc-sub">{t(language, 'Jurnal to‘ldirilmagan darslar', 'Уроки без отметок', 'Lessons with an empty journal')}</h3>
          {fresh.emptyJournals.filter((item) => item.teacherId === openTeacher.id).length === 0
            ? <p className="muted">{t(language, 'Hammasi to‘ldirilgan.', 'Всё заполнено.', 'All filled.')}</p>
            : <ul className="eco-list">{fresh.emptyJournals.filter((item) => item.teacherId === openTeacher.id).map((item) => (
              <li key={`${item.date}:${item.classId}:${item.period}`}><span className="eco-date">{shortDate(item.date)}</span><span><b>{item.className}</b> · {lessonSubjectName(item.subject, language) || item.subject} · {t(language, `${item.period}-dars`, `${item.period}-й урок`, `lesson ${item.period}`)}</span></li>
            ))}</ul>}
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. The teacher's day                                                 */
/* ------------------------------------------------------------------ */
type Workspace = {
  classes: Array<{ id: string; name: string }>;
  toReview: Array<{ id: string; title: string; subject: string; classId: string; className: string; count: number; oldest: string | null }>;
  emptyJournals: Array<{ date: string; classId: string; className: string; subject: string; period: number }>;
  attention: AttentionPupil[];
  changes: Array<{ id: string; className: string; date: string; period: number; kind: string; room: string | null; note: string; mine: boolean }>;
  unreadMessages: number;
};
type TodayLesson = { id: string; classId: string; className: string; period: number; subject: string; room: string | null; start: string; end: string; startsAt: string; endsAt: string; teacherName: string; change?: { kind: string; note: string; originalTeacherName: string | null } | null };

const CHANGE_TEXT: Record<string, [string, string, string]> = {
  substitute: ['Almashtirish', 'Замена учителя', 'Substitute'],
  cancelled: ['Dars bekor qilindi', 'Урок отменён', 'Cancelled'],
  room: ['Boshqa xona', 'Другой кабинет', 'Other room'],
};

export function TeacherDayPage({ language, onOpen }: { language: Language; onOpen: (path: string) => void }) {
  // Only what the teacher needs today: the lessons. A tap opens the details in a window.
  const { data, failed, now } = useToday();
  const courses = useLessonCourses(data?.lessons, data?.next);
  const work = useLoad<Workspace>('/api/me/workspace');
  const [picked, setPicked] = useState<TodayLessonFull | null>(null);
  const lessons = data?.lessons ?? [];
  const live = lessons.find((lesson) => statusOf(lesson, now) === 'current' && lesson.change?.kind !== 'cancelled')
    ?? lessons.find((lesson) => statusOf(lesson, now) === 'upcoming' && lesson.change?.kind !== 'cancelled');
  const topicOf = (lesson: TodayLessonFull) => (data ? topicForLesson(lesson, courses[lesson.classId], data.date) : undefined);
  const room = (lesson: TodayLessonFull) => (lesson.room ? t(language, `${lesson.room}-xona`, `каб. ${lesson.room}`, `room ${lesson.room}`) : '');
  const myChanges = work.data?.changes.filter((item) => item.mine) ?? [];
  if (failed && !data) return <ErrorNote error={t(language, 'Aloqa yo‘q', 'Нет связи', 'No connection')} language={language} />;
  if (!data) return <LoadingBlock language={language} />;
  return (
    <div className="eco myday">
      {live && (() => {
        const status = statusOf(live, now);
        const topic = topicOf(live);
        return (
          <button type="button" className={`myday-now ${status}`} onClick={() => setPicked(live)}>
            <span className="myday-now-tag">{status === 'current' ? t(language, 'Hozir dars', 'Сейчас урок', 'Lesson now') : t(language, 'Keyingi dars', 'Следующий урок', 'Next lesson')} · {live.start}–{live.end}</span>
            <b>{live.className} · {subj(live.subject, language)}</b>
            <span className="myday-now-topic">{topic ? `${topic.code} ${topic.title}` : t(language, 'Mavzu darslik bo‘yicha', 'Тема по учебнику', 'Topic from the textbook')}</span>
            <span className="muted">{room(live)}</span>
          </button>
        );
      })()}
      <Section icon={<CalendarClock size={16} />} title={t(language, 'Bugungi darslar', 'Уроки сегодня', 'Today’s lessons')} actions={<button type="button" className="btn small" onClick={() => onOpen('/schedule')}>{t(language, 'Jadval', 'Расписание', 'Timetable')} <ArrowRight size={13} /></button>}>
        {lessons.length === 0 ? <p className="muted">{t(language, 'Bugun darslar yo‘q.', 'Сегодня уроков нет.', 'No lessons today.')}</p> : (
          <ol className="eco-timeline myday-list">
            {lessons.map((lesson) => {
              const status = statusOf(lesson, now);
              const state = status === 'done' ? 'past' : status === 'current' ? 'now' : 'next';
              const topic = topicOf(lesson);
              return (
                <li key={`${lesson.id}:${lesson.period}`} className={`${state} ${lesson.change?.kind === 'cancelled' ? 'cancelled' : ''}`}>
                  <button type="button" className="myday-row" onClick={() => setPicked(lesson)}>
                    <span className="eco-time">{lesson.start}<small>{lesson.end}</small></span>
                    <span className="myday-row-main">
                      <b>{lesson.className} · {subj(lesson.subject, language)}</b>
                      <span className="muted eco-sub">{[room(lesson), topic?.title, lesson.change ? t(language, ...(CHANGE_TEXT[lesson.change.kind] ?? CHANGE_TEXT.room!)) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <ArrowRight size={15} className="myday-row-go" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
      {myChanges.length > 0 && (
        <Section icon={<CalendarClock size={16} />} title={t(language, 'Siz almashtirasiz', 'Ваши замены', 'Your substitutions')}>
          <ul className="eco-list">
            {myChanges.map((item) => (
              <li key={item.id}>
                <span className="eco-date">{shortDate(item.date)}</span>
                <span><b>{item.className}</b> · {t(language, `${item.period}-dars`, `${item.period}-й урок`, `lesson ${item.period}`)}{item.room ? ` · ${item.room}` : ''}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {picked && (() => {
        const status = statusOf(picked, now);
        const topic = topicOf(picked);
        const cancelled = picked.change?.kind === 'cancelled';
        return (
          <Modal title={`${picked.className} · ${subj(picked.subject, language)}`} onClose={() => setPicked(null)}
            footer={!cancelled && status !== 'done' ? <>
              <button type="button" className="btn" onClick={() => onOpen('/attendance')}>{t(language, 'Davomat', 'Давомат', 'Attendance')}</button>
              <button type="button" className="btn primary" onClick={() => onOpen(`/today/${picked.id}`)}>{status === 'current' ? t(language, 'Darsni boshlash', 'Начать урок', 'Start the lesson') : t(language, 'Darsni ochish', 'Открыть урок', 'Open the lesson')}</button>
            </> : undefined}>
            <dl className="myday-facts">
              <div><dt>{t(language, 'Vaqt', 'Время', 'Time')}</dt><dd>{picked.start}–{picked.end} · {t(language, `${picked.period}-dars`, `${picked.period}-й урок`, `lesson ${picked.period}`)}</dd></div>
              <div><dt>{t(language, 'Xona', 'Кабинет', 'Room')}</dt><dd>{picked.room || '—'}</dd></div>
              <div><dt>{t(language, 'Mavzu', 'Тема', 'Topic')}</dt><dd>{topic ? <><b>{topic.code}</b> {topic.title}<small className="muted"> · {t(language, `${topic.page}-bet`, `стр. ${topic.page}`, `p. ${topic.page}`)}</small></> : t(language, 'Darslik bo‘yicha keyingi mavzu', 'Следующая тема по учебнику', 'Next textbook topic')}</dd></div>
              {picked.change && <div><dt>{t(language, 'O‘zgarish', 'Изменение', 'Change')}</dt><dd>{t(language, ...(CHANGE_TEXT[picked.change.kind] ?? CHANGE_TEXT.room!))}{picked.change.note ? ` · ${picked.change.note}` : ''}</dd></div>}
            </dl>
            {topic?.essence && <p className="myday-essence">{topic.essence}</p>}
          </Modal>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Messages: parents ↔ teachers                                      */
/* ------------------------------------------------------------------ */
type Thread = { studentId: string; studentName: string; otherId: string; otherName: string; subtitle: string; last: { body: string; at: string; mine: boolean } | null; unread: number };
type Message = { id: string; body: string; fromId: string; createdAt: string; mine: boolean };

export function MessagesPage({ user, language }: { user: User; language: Language }) {
  const threads = useLoad<{ threads: Thread[] }>('/api/me/family-threads');
  const [open, setOpen] = useState<Thread | null>(null);
  const [query, setQuery] = useState('');
  const list = useMemo(() => (threads.data?.threads ?? []).filter((item) => `${item.studentName} ${item.otherName} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())), [threads.data, query]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') threads.reload(); }, 15000);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isParent = user.role === 'parent';
  return (
    <div className={`eco eco-chat ${open ? 'has-open' : ''}`}>
      <aside className="panel eco-threads">
        <div className="eco-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isParent ? t(language, 'O‘qituvchini qidirish', 'Найти учителя', 'Find a teacher') : t(language, 'O‘quvchi yoki ota-ona', 'Ученик или родитель', 'Pupil or parent')} /></div>
        {threads.error ? <ErrorNote error={threads.error} language={language} /> : !threads.data ? <LoadingBlock language={language} /> : list.length === 0 ? (
          <p className="muted eco-empty">{isParent
            ? t(language, 'Farzandingiz hali sinfga biriktirilmagan.', 'Ребёнок ещё не добавлен в класс.', 'Your child is not in a class yet.')
            : t(language, 'Sinflaringizdagi o‘quvchilarga ota-onalar hali biriktirilmagan.', 'К ученикам ваших классов ещё не привязаны родители.', 'No parents are linked to your pupils yet.')}</p>
        ) : (
          <ul>
            {list.map((item) => (
              <li key={`${item.studentId}:${item.otherId}`}>
                <button type="button" className={`eco-thread ${open && open.studentId === item.studentId && open.otherId === item.otherId ? 'on' : ''}`} onClick={() => setOpen(item)}>
                  <span className="eco-avatar">{item.otherName.slice(0, 1).toUpperCase()}</span>
                  <span className="eco-thread-text">
                    <b>{item.otherName}</b>
                    <small>{isParent ? `${item.studentName} · ${item.subtitle}` : `${t(language, 'O‘quvchi', 'Ученик', 'Pupil')}: ${item.studentName} · ${item.subtitle}`}</small>
                    {item.last && <small className="muted">{item.last.mine ? `${t(language, 'Siz', 'Вы', 'You')}: ` : ''}{item.last.body}</small>}
                  </span>
                  {item.unread > 0 && <span className="eco-unread">{item.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="panel eco-conversation">
        {open ? <Conversation key={`${open.studentId}:${open.otherId}`} thread={open} language={language} onBack={() => setOpen(null)} onSent={threads.reload} /> : (
          <div className="empty-state eco-empty-chat">
            <span className="empty-icon"><MessageCircle /></span>
            <p>{isParent ? t(language, 'O‘qituvchini tanlang va yozing.', 'Выберите учителя и напишите.', 'Choose a teacher and write.') : t(language, 'Ota-onani tanlang.', 'Выберите родителя.', 'Choose a parent.')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Conversation({ thread, language, onBack, onSent }: { thread: Thread; language: Language; onBack: () => void; onSent: () => void }) {
  const url = `/api/family-threads/${thread.studentId}/${thread.otherId}`;
  const { data, error, reload, setData } = useLoad<{ messages: Message[] }>(url);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 8000);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setSendError(null);
    try {
      const response = await customFetch<{ message: Message }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      setData({ messages: [...(data?.messages ?? []), response.message] });
      setText('');
      onSent();
    } catch (requestError) {
      setSendError(requestError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="eco-conv-head">
        <button type="button" className="btn small eco-back" onClick={onBack} aria-label={t(language, 'Orqaga', 'Назад', 'Back')}><X size={14} /></button>
        <span className="eco-avatar">{thread.otherName.slice(0, 1).toUpperCase()}</span>
        <div><b>{thread.otherName}</b><small className="muted">{thread.studentName} · {thread.subtitle}</small></div>
      </header>
      <div className="eco-messages" aria-live="polite">
        {error ? <ErrorNote error={error} language={language} /> : !data ? <LoadingBlock language={language} /> : data.messages.length === 0
          ? <p className="muted eco-empty">{t(language, 'Hali xabar yo‘q. Birinchi bo‘lib yozing.', 'Сообщений пока нет. Напишите первым.', 'No messages yet. Write first.')}</p>
          : data.messages.map((message) => (
            <div key={message.id} className={`eco-bubble ${message.mine ? 'mine' : ''}`}>
              <p>{message.body}</p>
              <time>{new Date(message.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
        <div ref={bottom} />
      </div>
      {sendError ? <ErrorNote error={sendError} language={language} /> : null}
      <form className="eco-compose" onSubmit={send}>
        <textarea className="input" rows={2} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(event); } }} placeholder={t(language, 'Xabar…', 'Сообщение…', 'Message…')} />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()} aria-label={t(language, 'Yuborish', 'Отправить', 'Send')}><Send size={16} /></button>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3b. The parent's weekly report and payments                          */
/* ------------------------------------------------------------------ */
type WeekReport = {
  from: string; to: string; average: number | null; averagePrev: number | null;
  subjects: Array<{ subject: string; marks: number[]; average: number | null }>;
  absences: Array<{ date: string; subject: string }>; late: number; lessonsMarked: number;
  homework: Array<{ id: string; title: string; subject: string; dueAt: string | null; state: 'missing' | 'review' | 'graded'; grade: number | null }>;
};
type Payments = { plan: { monthlyFee: number; discountPercent: number; due: number; startMonth: string } | null; debt: number; payments: Array<{ id: string; amount: number; month: string; paidOn: string; receiptNo: number; method: string }> };

export function ParentWeekPanel({ language, onOpen }: { language: Language; onOpen: (path: string) => void }) {
  const children = useLoad<{ children: Array<{ id: string; name: string }> }>('/api/me/children');
  const [active, setActive] = useState(0);
  const child = children.data?.children[Math.min(active, (children.data?.children.length ?? 1) - 1)];
  const report = useLoad<WeekReport>(child ? `/api/me/children/${child.id}/report` : null);
  const payments = useLoad<Payments>(child ? `/api/students/${child.id}/payments` : null);
  if (!children.data || !child) return null;
  const r = report.data;
  return (
    <div className="eco">
      {children.data.children.length > 1 && (
        <LensRow>{children.data.children.map((item, index) => <button key={item.id} type="button" className={index === active ? 'on' : ''} onClick={() => setActive(index)}>{item.name}</button>)}</LensRow>
      )}
      <Section icon={<CalendarCheck2 size={16} />} title={children.data.children.length > 1 ? t(language, `Bu hafta · ${child.name}`, `Эта неделя · ${child.name}`, `This week · ${child.name}`) : t(language, 'Bu hafta', 'Эта неделя', 'This week')} actions={<button type="button" className="btn small" onClick={() => onOpen('/messages')}><MessageCircle size={14} /> {t(language, 'O‘qituvchiga yozish', 'Написать учителю', 'Write to a teacher')}</button>}>
        {report.error ? <ErrorNote error={report.error} language={language} /> : !r ? <LoadingBlock language={language} /> : <>
          <div className="eco-stats compact">
            <Stat icon={<GraduationCap size={16} />} label={t(language, 'Hafta o‘rtachasi', 'Средняя за неделю', 'Week average')} value={r.average !== null ? r.average.toFixed(1) : '—'} note={<Trend now={r.average} prev={r.averagePrev} />} />
            <Stat icon={<Ban size={16} />} label={t(language, 'Qoldirilgan darslar', 'Пропущено уроков', 'Missed lessons')} value={String(r.absences.length)} tone={r.absences.length ? 'warn' : 'good'} />
            <Stat icon={<NotebookPen size={16} />} label={t(language, 'Topshirilmagan', 'Не сдано заданий', 'Not handed in')} value={String(r.homework.filter((item) => item.state === 'missing').length)} tone={r.homework.some((item) => item.state === 'missing') ? 'warn' : 'good'} />
          </div>
          {r.subjects.length > 0 && (
            <ul className="eco-marks">
              <li className="eco-mark-line head"><span>{t(language, 'Fan', 'Предмет', 'Subject')}</span><span>{t(language, 'Baholar', 'Оценки за неделю', 'Marks this week')}</span><span>{t(language, 'O‘rtacha', 'Средняя', 'Average')}</span></li>
              {r.subjects.map((item) => <li key={item.subject} className="eco-mark-line"><span className="eco-mark-subject">{subj(item.subject, language)}</span><span className="eco-mark-list">{item.marks.map((mark, index) => <span key={index} className={`grade-mark ${mark < 5 ? 'low' : ''}`}>{mark}</span>)}</span><b className="eco-mark-avg" title={t(language, 'O‘rtacha', 'Средняя', 'Average')}>{item.average !== null ? item.average.toFixed(1) : '—'}</b></li>)}
            </ul>
          )}
          {r.absences.length > 0 && <p className="notice">{t(language, 'Qoldirgan', 'Пропуски', 'Absent')}: {r.absences.map((item) => `${shortDate(item.date)}${item.subject ? ` (${subj(item.subject, language)})` : ''}`).join(', ')}</p>}
          {r.subjects.length === 0 && r.absences.length === 0 && <p className="muted">{t(language, 'Bu haftada jurnalda yozuv yo‘q.', 'За эту неделю в журнале нет записей.', 'No journal entries this week.')}</p>}
        </>}
      </Section>
      {payments.data?.plan && (
        <Section icon={<Wallet size={16} />} title={t(language, 'O‘qish to‘lovi', 'Оплата обучения', 'Tuition')}>
          <div className="eco-stats compact">
            <Stat icon={<Receipt size={16} />} label={t(language, 'Oyiga', 'В месяц', 'Per month')} value={sum(payments.data.plan.due)} note={payments.data.plan.discountPercent ? <span className="muted">{t(language, 'chegirma', 'скидка', 'discount')} {payments.data.plan.discountPercent}%</span> : undefined} />
            <Stat icon={<Wallet size={16} />} label={t(language, 'Qarz', 'Задолженность', 'Debt')} value={sum(payments.data.debt)} tone={payments.data.debt > 0 ? 'bad' : 'good'} />
          </div>
          {payments.data.payments.length > 0 && (
            <ul className="eco-list">
              {payments.data.payments.slice(0, 6).map((item) => <li key={item.id}><span className="eco-date">{shortDate(item.paidOn)}</span><span>№ {item.receiptNo} · {t(language, 'oy', 'за', 'for')} {item.month}</span><b>{sum(item.amount)}</b></li>)}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Tuition                                                           */
/* ------------------------------------------------------------------ */
type FinanceStudent = { id: string; name: string; status: string; className: string; plan: { monthlyFee: number; discountPercent: number; startMonth: string; note: string } | null; due: number; paidThisMonth: number; debt: number; advance: number };
type FinancePayment = { id: string; studentId: string; name: string; amount: number; month: string; method: string; paidOn: string; receiptNo: number; note: string; cancelledAt: string | null; cancelReason: string };
type Finance = { month: string; school: string; totals: { expected: number; collected: number; debt: number; debtors: number; withoutPlan: number }; students: FinanceStudent[]; payments: FinancePayment[] };
const METHOD: Record<string, [string, string, string]> = { cash: ['Naqd', 'Наличные', 'Cash'], card: ['Karta', 'Карта', 'Card'], transfer: ['O‘tkazma', 'Перевод', 'Transfer'] };

function printReceipt(school: string, payment: { receiptNo: number; name: string; amount: number; month: string; paidOn: string; method: string }, language: Language) {
  const win = window.open('', '_blank', 'width=420,height=560');
  if (!win) return;
  const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>№ ${payment.receiptNo}</title><style>body{font:15px system-ui,sans-serif;padding:28px;color:#111}h1{font-size:18px;margin:0 0 4px}small{color:#666}table{width:100%;margin-top:18px;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-weight:600}.sum{font-size:22px;font-weight:700;margin-top:16px}.sign{margin-top:42px;display:flex;justify-content:space-between;color:#666}</style></head><body>
<h1>${esc(school)}</h1><small>${esc(t(language, 'To‘lov kvitansiyasi', 'Квитанция об оплате', 'Payment receipt'))} № ${payment.receiptNo}</small>
<table><tr><td>${esc(t(language, 'O‘quvchi', 'Ученик', 'Pupil'))}</td><td>${esc(payment.name)}</td></tr><tr><td>${esc(t(language, 'Qaysi oy uchun', 'За месяц', 'For month'))}</td><td>${esc(payment.month)}</td></tr><tr><td>${esc(t(language, 'Sana', 'Дата', 'Date'))}</td><td>${esc(payment.paidOn)}</td></tr><tr><td>${esc(t(language, 'Usul', 'Способ', 'Method'))}</td><td>${esc(t(language, ...(METHOD[payment.method] ?? METHOD.cash!)))}</td></tr></table>
<div class="sum">${esc(sum(payment.amount))}</div><div class="sign"><span>${esc(t(language, 'Qabul qildi', 'Принял', 'Received by'))} ________</span><span>${esc(t(language, 'Imzo', 'Подпись', 'Signature'))} ________</span></div>
<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

export function FinancePage({ schoolId, language }: { schoolId: string; language: Language }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, reload } = useLoad<Finance>(`/api/schools/${schoolId}/finance?month=${month}`);
  const [filter, setFilter] = useState<'all' | 'debt' | 'noplan'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FinanceStudent | null>(null);
  const [paying, setPaying] = useState<FinanceStudent | null>(null);
  const [notice, setNotice] = useState('');
  const students = (data?.students ?? []).filter((item) => (filter === 'debt' ? item.debt > 0 : filter === 'noplan' ? !item.plan : true) && `${item.name} ${item.className}`.toLowerCase().includes(query.toLowerCase()));
  const [showAll, setShowAll] = useState(false);
  // The page shows the first rows; the whole list (or a search) opens the rest, so the page stays short.
  const studentTable = (rows: FinanceStudent[]) => (
            <div className="journal-scroll">
              <table className="grade-table eco-table">
                <thead><tr>
                  <th>{t(language, 'O‘quvchi', 'Ученик', 'Pupil')}</th>
                  <th>{t(language, 'Oyiga', 'В месяц', 'Monthly')}</th>
                  <th>{t(language, 'Shu oy', 'За месяц', 'This month')}</th>
                  <th>{t(language, 'Qarz', 'Долг', 'Debt')}</th>
                  <th />
                </tr></thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className={item.debt > 0 ? 'row-warn' : ''}>
                      <td><b>{item.name}</b><br /><span className="muted">{item.className || '—'}{item.status !== 'active' ? ` · ${item.status}` : ''}</span></td>
                      <td>{item.plan ? <>{sum(item.due)}{item.plan.discountPercent ? <span className="tag green eco-tag">−{item.plan.discountPercent}%</span> : null}</> : <button type="button" className="btn small" onClick={() => { setShowAll(false); setEditing(item); }}><Plus size={13} /> {t(language, 'Belgilash', 'Назначить', 'Set')}</button>}</td>
                      <td>{item.paidThisMonth ? sum(item.paidThisMonth) : '—'}</td>
                      <td>{item.debt ? <b className="eco-debt">{sum(item.debt)}</b> : item.advance ? <span className="muted">+{sum(item.advance)}</span> : '—'}</td>
                      <td className="eco-row-actions">
                        {item.plan && <button type="button" className="btn small" onClick={() => { setShowAll(false); setEditing(item); }}>{t(language, 'Tarif', 'Тариф', 'Fee')}</button>}
                        <button type="button" className="btn small primary" onClick={() => { setShowAll(false); setPaying(item); }}><Wallet size={13} /> {t(language, 'To‘lov', 'Оплата', 'Pay')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
  );
  async function cancel(payment: FinancePayment) {
    const reason = window.prompt(t(language, 'Nega bekor qilinmoqda?', 'Почему отменяете оплату?', 'Why cancel this payment?'));
    if (!reason || reason.trim().length < 3) return;
    try {
      await customFetch(`/api/schools/${schoolId}/finance/payments/${payment.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      setNotice(t(language, `№ ${payment.receiptNo} bekor qilindi.`, `Оплата № ${payment.receiptNo} отменена.`, `Payment № ${payment.receiptNo} cancelled.`));
      reload();
    } catch (requestError) {
      setNotice(friendlyError(requestError, language));
    }
  }
  return (
    <div className="eco">
      <div className="eco-toolbar">
        <label className="eco-month-label">{t(language, 'Oy', 'Месяц', 'Month')} <DateField className="eco-month" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
        <div className="row eco-actions">
          <button type="button" className="btn small" onClick={reload}><RefreshCw size={14} /></button>
          <button type="button" className="btn small" disabled={!data} onClick={() => data && downloadCsv(`eduverse-oplata-${data.month}.csv`, [
            [t(language, 'O‘quvchi', 'Ученик', 'Pupil'), t(language, 'Sinf', 'Класс', 'Class'), t(language, 'Oyiga', 'В месяц', 'Monthly'), t(language, 'Chegirma, %', 'Скидка, %', 'Discount, %'), t(language, 'Shu oy to‘landi', 'Оплачено за месяц', 'Paid this month'), t(language, 'Qarz', 'Долг', 'Debt')],
            ...data.students.map((item) => [item.name, item.className, item.due, item.plan?.discountPercent ?? null, item.paidThisMonth, item.debt]),
          ])}><Download size={14} /> Excel</button>
        </div>
      </div>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error ? <ErrorNote error={error} language={language} /> : !data ? <LoadingBlock language={language} /> : <>
        <div className="eco-stats">
          <Stat icon={<Receipt size={18} />} label={t(language, 'Kutilmoqda', 'Ожидается за месяц', 'Expected this month')} value={sum(data.totals.expected)} />
          <Stat icon={<Wallet size={18} />} label={t(language, 'Yig‘ildi', 'Получено', 'Collected')} value={sum(data.totals.collected)} tone="good" note={data.totals.expected ? <span className="muted">{Math.round((data.totals.collected / data.totals.expected) * 100)}%</span> : undefined} />
          <Stat icon={<AlertTriangle size={18} />} label={t(language, 'Umumiy qarz', 'Общая задолженность', 'Total debt')} value={sum(data.totals.debt)} tone={data.totals.debt ? 'bad' : 'good'} note={<span className="muted">{data.totals.debtors} {t(language, 'o‘quvchi', 'учеников', 'pupils')}</span>} />
          <Stat icon={<Users size={18} />} label={t(language, 'To‘lov belgilanmagan', 'Без тарифа', 'No fee set')} value={String(data.totals.withoutPlan)} tone={data.totals.withoutPlan ? 'warn' : ''} />
        </div>
        <Section icon={<Users size={16} />} title={t(language, 'O‘quvchilar', 'Ученики', 'Pupils')} actions={<>
          <LensRow className="small">
            {([['all', t(language, 'Hammasi', 'Все', 'All')], ['debt', t(language, 'Qarzdorlar', 'Должники', 'Debtors')], ['noplan', t(language, 'Belgilanmagan', 'Без тарифа', 'No fee')]] as const).map(([key, label]) => <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>{label}</button>)}
          </LensRow>
          <div className="eco-search small"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'Qidirish', 'Поиск', 'Search')} /></div>
        </>}>
          {students.length === 0 ? <p className="muted">{t(language, 'Hech kim topilmadi.', 'Никого не найдено.', 'Nobody found.')}</p> : <>
            {studentTable(query ? students : students.slice(0, PAGE_ROWS))}
            {!query && students.length > PAGE_ROWS && <button type="button" className="btn small eco-more" onClick={() => setShowAll(true)}>{t(language, `Hammasi (${students.length})`, `Показать всех (${students.length})`, `Show all (${students.length})`)}</button>}
            {showAll && <Modal title={t(language, 'O‘quvchilar', 'Ученики', 'Pupils')} wide onClose={() => setShowAll(false)}>{studentTable(students)}</Modal>}
          </>}
        </Section>
        <Section icon={<Receipt size={16} />} title={t(language, 'Shu oy to‘lovlari', 'Оплаты за месяц', 'Payments this month')}>
          {data.payments.length === 0 ? <p className="muted">{t(language, 'Hali to‘lov yo‘q.', 'Оплат пока нет.', 'No payments yet.')}</p> : (
            <ShortList items={data.payments} title={t(language, 'Shu oy to‘lovlari', 'Оплаты за месяц', 'Payments this month')} language={language} row={(item) => (
                <li key={item.id} className={item.cancelledAt ? 'cancelled' : ''}>
                  <span className="eco-date">№ {item.receiptNo}</span>
                  <span><b>{item.name}</b> · {shortDate(item.paidOn)} · {t(language, ...(METHOD[item.method] ?? METHOD.cash!))}{item.cancelledAt ? ` · ${t(language, 'bekor qilingan', 'отменена', 'cancelled')}: ${item.cancelReason}` : ''}</span>
                  <b>{sum(item.amount)}</b>
                  {!item.cancelledAt && <span className="eco-row-actions">
                    <button type="button" className="btn small" onClick={() => printReceipt(data.school, item, language)} aria-label={t(language, 'Chop etish', 'Печать', 'Print')}><Printer size={13} /></button>
                    <button type="button" className="btn small danger" onClick={() => void cancel(item)} aria-label={t(language, 'Bekor qilish', 'Отменить', 'Cancel')}><X size={13} /></button>
                  </span>}
                </li>
            )} />
          )}
        </Section>
      </>}
      {editing && <PlanDialog schoolId={schoolId} student={editing} month={month} language={language} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {paying && data && <PayDialog schoolId={schoolId} school={data.school} student={paying} month={month} language={language} onClose={() => setPaying(null)} onSaved={(message) => { setPaying(null); setNotice(message); reload(); }} />}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="eco-dialog-backdrop" onClick={onClose}>
      <div className="panel eco-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="section-head"><h2>{title}</h2><button type="button" className="btn small" onClick={onClose} aria-label="×"><X size={14} /></button></div>
        {children}
      </div>
    </div>
  );
}

function PlanDialog({ schoolId, student, month, language, onClose, onSaved }: { schoolId: string; student: FinanceStudent; month: string; language: Language; onClose: () => void; onSaved: () => void }) {
  const [fee, setFee] = useState(String(student.plan?.monthlyFee ?? ''));
  const [discount, setDiscount] = useState(String(student.plan?.discountPercent ?? 0));
  const [start, setStart] = useState(student.plan?.startMonth ?? month);
  const [note, setNote] = useState(student.plan?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await customFetch(`/api/schools/${schoolId}/finance/plans/${student.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyFee: Number(fee.replace(/\s/g, '')), discountPercent: Number(discount), startMonth: start, note }) });
      onSaved();
    } catch (requestError) { setError(requestError); } finally { setBusy(false); }
  }
  const due = Math.round((Number(fee.replace(/\s/g, '')) || 0) * (100 - (Number(discount) || 0)) / 100);
  return (
    <Dialog title={`${t(language, 'Tarif', 'Тариф', 'Fee')} · ${student.name}`} onClose={onClose}>
      <form className="eco-form" onSubmit={save}>
        <label>{t(language, 'Oylik to‘lov, so‘m', 'Оплата в месяц, сум', 'Monthly fee, sum')}<input className="input" inputMode="numeric" value={fee} onChange={(event) => setFee(event.target.value.replace(/[^\d\s]/g, ''))} required /></label>
        <label>{t(language, 'Chegirma, %', 'Скидка, %', 'Discount, %')}<input className="input" type="number" min={0} max={100} value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
        <label>{t(language, 'Qaysi oydan', 'С какого месяца', 'From month')}<DateField className="input" type="month" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
        <label>{t(language, 'Izoh (masalan, ikkinchi farzand)', 'Примечание (например, второй ребёнок)', 'Note (e.g. second child)')}<input className="input" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="muted">{t(language, 'Oyiga to‘lanadi', 'К оплате в месяц', 'To pay monthly')}: <b>{sum(due)}</b></p>
        {error ? <ErrorNote error={error} language={language} /> : null}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? '…' : t(language, 'Saqlash', 'Сохранить', 'Save')}</button>
      </form>
    </Dialog>
  );
}

function PayDialog({ schoolId, school, student, month, language, onClose, onSaved }: { schoolId: string; school: string; student: FinanceStudent; month: string; language: Language; onClose: () => void; onSaved: (message: string) => void }) {
  const [amount, setAmount] = useState(String(student.debt || student.due || ''));
  const [forMonth, setForMonth] = useState(month);
  const [method, setMethod] = useState('cash');
  const [paidOn, setPaidOn] = useState(todayText());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [printAfter, setPrintAfter] = useState(true);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const value = Number(amount.replace(/\s/g, ''));
      const response = await customFetch<{ payment: { receiptNo: number } }>(`/api/schools/${schoolId}/finance/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: student.id, amount: value, month: forMonth, method, paidOn, note }) });
      if (printAfter) printReceipt(school, { receiptNo: response.payment.receiptNo, name: student.name, amount: value, month: forMonth, paidOn, method }, language);
      onSaved(t(language, `To‘lov qabul qilindi, kvitansiya № ${response.payment.receiptNo}.`, `Оплата принята, квитанция № ${response.payment.receiptNo}.`, `Payment saved, receipt № ${response.payment.receiptNo}.`));
    } catch (requestError) { setError(requestError); } finally { setBusy(false); }
  }
  return (
    <Dialog title={`${t(language, 'To‘lov', 'Оплата', 'Payment')} · ${student.name}`} onClose={onClose}>
      <form className="eco-form" onSubmit={save}>
        <label>{t(language, 'Summa, so‘m', 'Сумма, сум', 'Amount, sum')}<input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d\s]/g, ''))} required /></label>
        <label>{t(language, 'Qaysi oy uchun', 'За какой месяц', 'For month')}<DateField className="input" type="month" value={forMonth} onChange={(event) => setForMonth(event.target.value)} required /></label>
        <label>{t(language, 'Usul', 'Способ', 'Method')}
          <Select className="input" value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.entries(METHOD).map(([key, label]) => <option key={key} value={key}>{t(language, ...label)}</option>)}
          </Select>
        </label>
        <label>{t(language, 'Sana', 'Дата оплаты', 'Paid on')}<DateField className="input" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
        <label>{t(language, 'Izoh', 'Примечание', 'Note')}<input className="input" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></label>
        <label className="eco-check"><input type="checkbox" checked={printAfter} onChange={(event) => setPrintAfter(event.target.checked)} /> {t(language, 'Kvitansiyani chop etish', 'Распечатать квитанцию', 'Print the receipt')}</label>
        {student.debt > 0 && <p className="muted">{t(language, 'Hozirgi qarz', 'Текущий долг', 'Current debt')}: <b>{sum(student.debt)}</b></p>}
        {error ? <ErrorNote error={error} language={language} /> : null}
        <button type="submit" className="btn primary" disabled={busy}><Wallet size={15} /> {busy ? '…' : t(language, 'Qabul qilish', 'Принять оплату', 'Save payment')}</button>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Timetable changes                                                 */
/* ------------------------------------------------------------------ */
type Timetable = {
  slots: Array<{ id: string; classId: string; weekday: number; period: number; subject: string; teacherId: string | null; room: string | null }>;
  classes: Array<{ id: string; name: string }>;
  teachers: Array<{ id: string; name: string }>;
  bells: Array<{ start: string; end: string }>;
};
type Change = { id: string; classId: string; className: string; date: string; period: number; kind: string; teacherId: string | null; teacherName: string | null; room: string | null; note: string };

export function TimetableChangesPage({ schoolId, language }: { schoolId: string; language: Language }) {
  const timetable = useLoad<Timetable>(`/api/schools/${schoolId}/timetable`);
  const changes = useLoad<{ changes: Change[] }>(`/api/schools/${schoolId}/timetable-changes`);
  const [date, setDate] = useState(todayText());
  const [classId, setClassId] = useState('');
  const [period, setPeriod] = useState(0);
  const [kind, setKind] = useState<'substitute' | 'cancelled' | 'room'>('substitute');
  const [teacherId, setTeacherId] = useState('');
  const [room, setRoom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>(null);
  const weekday = (() => { const day = new Date(`${date}T12:00:00`).getDay(); return day === 0 ? 7 : day; })();
  const tt = timetable.data;
  const daySlots = (tt?.slots ?? []).filter((slot) => slot.weekday === weekday && (!classId || slot.classId === classId)).sort((a, b) => a.period - b.period);
  const slot = daySlots.find((item) => item.period === period && item.classId === classId) ?? null;
  const teacherOf = (id: string | null) => tt?.teachers.find((item) => item.id === id)?.name ?? '—';
  // Free teachers for this lesson: nobody else has a lesson at that period on that day.
  const busyTeachers = new Set((tt?.slots ?? []).filter((item) => item.weekday === weekday && item.period === period).map((item) => item.teacherId));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!slot) return;
    setBusy(true); setError(null); setMessage('');
    try {
      await customFetch(`/api/schools/${schoolId}/timetable-changes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, date, period, kind, teacherId: kind === 'substitute' ? teacherId : null, room: kind === 'room' ? room : null, note }) });
      setMessage(t(language, 'Saqlandi. O‘quvchilar, ota-onalar va o‘qituvchilar xabar oldi.', 'Сохранено. Ученики, родители и учителя получили уведомление.', 'Saved. Pupils, parents and teachers were notified.'));
      setNote(''); changes.reload();
    } catch (requestError) { setError(requestError); } finally { setBusy(false); }
  }
  async function remove(change: Change) {
    try {
      await customFetch(`/api/schools/${schoolId}/timetable-changes/${change.id}`, { method: 'DELETE' });
      changes.reload();
    } catch (requestError) { setError(requestError); }
  }
  return (
    <div className="eco">
      {timetable.error ? <ErrorNote error={timetable.error} language={language} /> : !tt ? <LoadingBlock language={language} /> : tt.slots.length === 0 ? (
        <div className="notice">{t(language, 'Avval dars jadvalini kiriting.', 'Сначала заполните расписание уроков.', 'Fill in the timetable first.')}</div>
      ) : (
        <div className="eco-grid">
          <Section icon={<CalendarClock size={16} />} title={t(language, 'Yangi o‘zgarish', 'Новое изменение', 'New change')}>
            <form className="eco-form" onSubmit={save}>
              <label>{t(language, 'Kun', 'День', 'Day')}<DateField className="input" type="date" min={todayText()} value={date} onChange={(event) => { setDate(event.target.value); setPeriod(0); }} /></label>
              <label>{t(language, 'Sinf', 'Класс', 'Class')}
                <Select className="input" value={classId} onChange={(event) => { setClassId(event.target.value); setPeriod(0); }}>
                  <option value="">—</option>
                  {tt.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </label>
              <label>{t(language, 'Dars', 'Урок', 'Lesson')}
                <Select className="input" value={period} disabled={!classId} onChange={(event) => setPeriod(Number(event.target.value))}>
                  <option value={0}>—</option>
                  {daySlots.map((item) => <option key={item.id} value={item.period}>{item.period}. {tt.bells[item.period - 1]?.start ?? ''} · {subj(item.subject, language)} · {teacherOf(item.teacherId)}</option>)}
                </Select>
              </label>
              {classId && weekday !== 7 && daySlots.length === 0 && <p className="muted">{t(language, 'Bu kuni bu sinfda dars yo‘q.', 'В этот день у класса нет уроков.', 'No lessons for this class that day.')}</p>}
              <LensRow>
                {(['substitute', 'cancelled', 'room'] as const).map((key) => <button key={key} type="button" className={kind === key ? 'on' : ''} onClick={() => setKind(key)}>{t(language, ...CHANGE_TEXT[key]!)}</button>)}
              </LensRow>
              {kind === 'substitute' && (
                <label>{t(language, 'Kim almashtiradi', 'Кто заменяет', 'Substitute teacher')}
                  <Select className="input" value={teacherId} onChange={(event) => setTeacherId(event.target.value)} required>
                    <option value="">—</option>
                    {tt.teachers.filter((item) => item.id !== slot?.teacherId).map((item) => <option key={item.id} value={item.id}>{item.name}{period && busyTeachers.has(item.id) ? ` · ${t(language, 'band', 'занят', 'busy')}` : ` · ${t(language, 'bo‘sh', 'свободен', 'free')}`}</option>)}
                  </Select>
                </label>
              )}
              {kind === 'room' && <label>{t(language, 'Xona', 'Кабинет', 'Room')}<input className="input" value={room} maxLength={40} onChange={(event) => setRoom(event.target.value)} required /></label>}
              <label>{t(language, 'Izoh', 'Причина / примечание', 'Note')}<input className="input" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={t(language, 'Masalan: o‘qituvchi kasal', 'Например: учитель заболел', 'E.g. the teacher is ill')} /></label>
              {error ? <ErrorNote error={error} language={language} /> : null}
              {message && <div className="notice" role="status">{message}</div>}
              <button type="submit" className="btn primary" disabled={busy || !slot || (kind === 'substitute' && !teacherId)}><CheckCircle2 size={15} /> {t(language, 'Saqlash va xabar berish', 'Сохранить и уведомить', 'Save and notify')}</button>
            </form>
          </Section>
          <Section icon={<CalendarCheck2 size={16} />} title={t(language, 'Yaqin kunlardagi o‘zgarishlar', 'Изменения на ближайшие дни', 'Upcoming changes')}>
            {!changes.data ? <LoadingBlock language={language} /> : changes.data.changes.length === 0 ? <p className="muted">{t(language, 'O‘zgarish yo‘q.', 'Изменений нет.', 'No changes.')}</p> : (
              <ul className="eco-list">
                {changes.data.changes.map((item) => (
                  <li key={item.id}>
                    <span className="eco-date">{shortDate(item.date)}</span>
                    <span><b>{item.className}</b> · {t(language, `${item.period}-dars`, `${item.period}-й урок`, `lesson ${item.period}`)}<br /><span className="muted">{t(language, ...(CHANGE_TEXT[item.kind] ?? CHANGE_TEXT.room!))}{item.kind === 'substitute' ? `: ${item.teacherName ?? ''}` : item.kind === 'room' ? `: ${item.room ?? ''}` : ''}{item.note ? ` · ${item.note}` : ''}</span></span>
                    <button type="button" className="btn small" onClick={() => void remove(item)} aria-label={t(language, 'O‘chirish', 'Убрать', 'Remove')}><X size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
