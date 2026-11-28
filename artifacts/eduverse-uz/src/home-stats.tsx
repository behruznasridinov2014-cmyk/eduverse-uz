import { useEffect, useState, type ReactNode } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { AlertTriangle, Ban, CalendarCheck2, ClipboardCheck, GraduationCap, NotebookPen, Users } from 'lucide-react';
import type { AppLanguage } from './localization';

/**
 * A short row of numbers at the top of the overview, different for every role:
 * pupil — average mark, attendance, missed lessons; parent — the child's week;
 * teacher — work to check, pupils, average; director — attendance, average, work to check, pupils to watch.
 * Each number opens the page where it comes from. Nothing is shown until the numbers arrive.
 */
const t = (language: AppLanguage, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Tile = { icon: ReactNode; label: string; value: string; tone?: '' | 'good' | 'warn' | 'bad'; path?: string };
const get = <T,>(url: string) => customFetch<T>(url, { method: 'GET' });
const avg = (list: number[]) => (list.length ? Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10 : null);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

async function pupilTiles(language: AppLanguage): Promise<Tile[]> {
  const [marks, attendance] = await Promise.all([
    get<{ marks: Array<{ date: string; mark: number | null; absent: boolean }> }>('/api/me/marks').catch(() => null),
    get<{ total: number; present: number; late: number; absent: number }>('/api/me/attendance-summary').catch(() => null),
  ]);
  const recent = (marks?.marks ?? []).filter((item) => item.date >= monthAgo() && typeof item.mark === 'number').map((item) => item.mark as number);
  const average = avg(recent);
  const percent = attendance && attendance.total ? Math.round(((attendance.present + attendance.late) / attendance.total) * 100) : null;
  return [
    { icon: <GraduationCap size={16} />, label: t(language, 'O‘rtacha baho (oy)', 'Средняя оценка за месяц', 'Average mark (month)'), value: average !== null ? average.toFixed(1) : '—', path: '/grades' },
    { icon: <CalendarCheck2 size={16} />, label: t(language, 'Davomat', 'Посещаемость', 'Attendance'), value: percent !== null ? `${percent}%` : '—', tone: percent === null ? '' : percent >= 90 ? 'good' : 'warn', path: '/grades' },
    { icon: <Ban size={16} />, label: t(language, 'Qoldirilgan darslar', 'Пропущено уроков', 'Missed lessons'), value: String(attendance?.absent ?? 0), tone: attendance?.absent ? 'warn' : 'good', path: '/grades' },
  ];
}

type WeekReport = { average: number | null; absences: unknown[]; homework: Array<{ state: string }> };
async function parentTiles(language: AppLanguage): Promise<Tile[]> {
  const children = await get<{ children: Array<{ id: string; name: string }> }>('/api/me/children').catch(() => null);
  const list = children?.children ?? [];
  const reports = await Promise.all(list.map((child) => get<WeekReport>(`/api/me/children/${child.id}/report`).catch(() => null)));
  return list.flatMap((child, index) => {
    const report = reports[index];
    if (!report) return [];
    const who = list.length > 1 ? ` · ${child.name.split(' ')[1] ?? child.name}` : '';
    const missing = report.homework.filter((item) => item.state === 'missing').length;
    return [
      { icon: <GraduationCap size={16} />, label: t(language, `Hafta o‘rtachasi${who}`, `Средняя за неделю${who}`, `Week average${who}`), value: report.average !== null ? report.average.toFixed(1) : '—', path: '/parent' },
      { icon: <Ban size={16} />, label: t(language, `Qoldirgan darslar${who}`, `Пропусков за неделю${who}`, `Missed this week${who}`), value: String(report.absences.length), tone: report.absences.length ? 'warn' : 'good', path: '/parent' },
      { icon: <NotebookPen size={16} />, label: t(language, `Topshirilmagan${who}`, `Не сдано заданий${who}`, `Not handed in${who}`), value: String(missing), tone: missing ? 'warn' : 'good', path: '/parent' },
    ] as Tile[];
  });
}

async function teacherTiles(language: AppLanguage): Promise<Tile[]> {
  const [work, stats] = await Promise.all([
    get<{ toReview: Array<{ count: number }>; attention: unknown[]; emptyJournals: unknown[] }>('/api/me/workspace').catch(() => null),
    get<{ students: number; averageGrade: number | null }>('/api/me/teaching-stats').catch(() => null),
  ]);
  const toCheck = (work?.toReview ?? []).reduce((sum, item) => sum + item.count, 0);
  return [
    { icon: <ClipboardCheck size={16} />, label: t(language, 'Tekshirish kerak', 'Проверить работ', 'Work to check'), value: String(toCheck), tone: toCheck ? 'warn' : 'good', path: '/check' },
    { icon: <NotebookPen size={16} />, label: t(language, 'Bo‘sh jurnallar', 'Незаполненные уроки', 'Empty journals'), value: String(work?.emptyJournals.length ?? 0), tone: work?.emptyJournals.length ? 'warn' : 'good', path: '/workspace' },
    { icon: <Users size={16} />, label: t(language, 'O‘quvchilar', 'Учеников', 'Pupils'), value: String(stats?.students ?? 0), path: '/teacher' },
    { icon: <GraduationCap size={16} />, label: t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average mark'), value: stats?.averageGrade != null ? stats.averageGrade.toFixed(1) : '—', path: '/teacher' },
  ];
}

type Totals = { attendancePercent: number | null; average: number | null; unchecked: number; needAttention: number; absentToday: number };
async function schoolTiles(language: AppLanguage, schoolId: string): Promise<Tile[]> {
  const data = await get<{ totals: Totals }>(`/api/schools/${schoolId}/analytics?period=week`).catch(() => null);
  if (!data) return [];
  const { totals } = data;
  return [
    { icon: <CalendarCheck2 size={16} />, label: t(language, 'Davomat (hafta)', 'Посещаемость за неделю', 'Attendance (week)'), value: totals.attendancePercent !== null ? `${totals.attendancePercent}%` : '—', tone: totals.attendancePercent === null ? '' : totals.attendancePercent >= 90 ? 'good' : 'warn', path: '/analytics' },
    { icon: <Ban size={16} />, label: t(language, 'Bugun yo‘q', 'Сегодня отсутствуют', 'Absent today'), value: String(totals.absentToday), path: '/attendance' },
    { icon: <GraduationCap size={16} />, label: t(language, 'O‘rtacha baho', 'Средняя оценка', 'Average mark'), value: totals.average !== null ? totals.average.toFixed(1) : '—', path: '/analytics' },
    { icon: <ClipboardCheck size={16} />, label: t(language, 'Tekshirilmagan ishlar', 'Не проверено работ', 'Unchecked work'), value: String(totals.unchecked), tone: totals.unchecked > 20 ? 'warn' : '', path: '/analytics' },
    { icon: <AlertTriangle size={16} />, label: t(language, 'E’tibor kerak', 'Требуют внимания', 'Need attention'), value: String(totals.needAttention), tone: totals.needAttention ? 'bad' : 'good', path: '/analytics' },
  ];
}

const SHOW_PUPIL = false as boolean;

export function HomeStats({ role, schoolId, language, onOpen }: { role: string; schoolId?: string; language: AppLanguage; onOpen: (path: string) => void }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  useEffect(() => {
    let alive = true;
    // The pupil's overview already has its own "My learning" numbers further down.
    const load = role === 'student' && SHOW_PUPIL ? pupilTiles(language)
      : role === 'parent' ? parentTiles(language)
      : role === 'teacher' ? teacherTiles(language)
      : (role === 'school_director' || role === 'school_admin') && schoolId ? schoolTiles(language, schoolId)
      : Promise.resolve([] as Tile[]);
    void load.then((value) => { if (alive) setTiles(value); }).catch(() => { if (alive) setTiles([]); });
    return () => { alive = false; };
  }, [role, schoolId, language]);
  if (!tiles || tiles.length === 0) return null;
  return (
    <div className="home-stats" role="list">
      {tiles.map((tile) => (
        <button key={tile.label} type="button" role="listitem" className={`home-stat ${tile.tone ?? ''}`} onClick={() => tile.path && onOpen(tile.path)}>
          <span className="home-stat-icon">{tile.icon}</span>
          <b>{tile.value}</b>
          <span>{tile.label}</span>
        </button>
      ))}
    </div>
  );
}
