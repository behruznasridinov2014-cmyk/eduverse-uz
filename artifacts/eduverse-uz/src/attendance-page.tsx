import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  addClassMemberByLogin,
  getClassAttendance,
  getMySchools,
  getStudentAttendance,
  saveClassAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
  type SchoolClass,
  type StudentAttendanceRecord,
  type User,
} from '@workspace/api-client-react';
import {
  CalendarCheck,
  Check,
  CircleAlert,
  Clock3,
  Percent,
  RefreshCw,
  UserCheck,
  Users,
  UserPlus,
  X,
} from 'lucide-react';
import type { Language } from './school-data';

type MarkStatus = Exclude<AttendanceStatus, 'unmarked'>;

const STATUS_ORDER: MarkStatus[] = ['present', 'late', 'absent', 'excused'];

const COPY: Record<Language, Record<string, string>> = {
  Русский: {
    eyebrow: 'ДАВОМАТ · КТО ПРИШЁЛ',
    titleTeacher: 'Давомат класса',
    titleStudent: 'Мой давомат',
    subtitleTeacher: 'Отметьте, кто пришёл на урок. Сохранённые отметки видны ученикам и родителям.',
    subtitleStudent: 'История посещения и общий процент вашей посещаемости.',
    pickClass: 'Класс',
    date: 'Дата',
    save: 'Сохранить давомат',
    saved: 'Давомат сохранён',
    markAllPresent: 'Отметить всех',
    present: 'Пришёл',
    late: 'Опоздал',
    absent: 'Отсутствует',
    excused: 'Уважительная',
    unmarked: 'Не отмечен',
    noClasses: 'Нет привязанных классов.',
    noStudents: 'В классе пока нет учеников.',
    rate: 'Посещаемость',
    totalMarks: 'Всего отметок',
    presentDays: 'Дней с посещением',
    history: 'История',
    noHistory: 'Отметок пока нет.',
    addPrompt: 'Логин ученика для добавления в класс…',
    addStudent: 'Добавить ученика',
    studentAdded: 'Ученик добавлен в класс.',
  },
  Uzbek: {
    eyebrow: 'DAVOMAT · KIM KELDI',
    titleTeacher: 'Sinf davomati',
    titleStudent: 'Mening davomatim',
    subtitleTeacher: 'Darsga kim kelganini belgilang. Saqlangan belgilar o‘quvchi va ota-onaga ko‘rinadi.',
    subtitleStudent: 'Davomat tarixi va umumiy davomat foizi.',
    pickClass: 'Sinf',
    date: 'Sana',
    save: 'Davomatni saqlash',
    saved: 'Davomat saqlandi',
    markAllPresent: 'Hammasini belgilash',
    present: 'Keldi',
    late: 'Kechikdi',
    absent: 'Yo‘q',
    excused: 'Sababli',
    unmarked: 'Belgilanmagan',
    noClasses: 'Bog‘langan sinf yo‘q.',
    noStudents: 'Sinfda hali o‘quvchi yo‘q.',
    rate: 'Davomat',
    totalMarks: 'Jami belgilar',
    presentDays: 'Kelgan kunlar',
    history: 'Tarix',
    noHistory: 'Hozircha belgi yo‘q.',
    addPrompt: 'Sinfga qo‘shish uchun o‘quvchi logini…',
    addStudent: 'O‘quvchi qo‘shish',
    studentAdded: 'O‘quvchi sinfga qo‘shildi.',
  },
  English: {
    eyebrow: 'ATTENDANCE · WHO CAME',
    titleTeacher: 'Class attendance',
    titleStudent: 'My attendance',
    subtitleTeacher: 'Mark who came to the lesson. Saved marks are visible to students and parents.',
    subtitleStudent: 'Visit history and your overall attendance rate.',
    pickClass: 'Class',
    date: 'Date',
    save: 'Save attendance',
    saved: 'Attendance saved',
    markAllPresent: 'Mark all present',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    excused: 'Excused',
    unmarked: 'Unmarked',
    noClasses: 'No linked classes.',
    noStudents: 'No students in this class yet.',
    rate: 'Attendance',
    totalMarks: 'Total marks',
    presentDays: 'Days present',
    history: 'History',
    noHistory: 'No marks yet.',
    addPrompt: 'Student login to add to the class…',
    addStudent: 'Add student',
    studentAdded: 'Student added to the class.',
  },
};

export function AttendancePage({ user, language }: { user: User; language: Language }) {
  const copy = COPY[language];
  const isTeacher = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<StudentAttendanceRecord[]>([]);
  const [rate, setRate] = useState(0);
  const [addLogin, setAddLogin] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addNotice, setAddNotice] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const response = await getMySchools();
        setClasses(response.classes);
        setClassId((current) => current || response.classes[0]?.id || '');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (isTeacher) return;
    void (async () => {
      try {
        const response = await getStudentAttendance(user.id);
        setHistory(response.records);
        setRate(response.summary.rate);
      } catch {
        /* ignore */
      }
    })();
  }, [isTeacher, user.id]);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await getClassAttendance(classId, { date });
      setRecords(response.records);
      setCanManage(response.canManage);
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setLoading(false);
    }
  }, [classId, date, language]);

  useEffect(() => {
    if (isTeacher) void load();
  }, [isTeacher, load]);

  const summary = useMemo(() => {
    const counted: Record<MarkStatus, number> = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const record of records) {
      if (record.status !== 'unmarked' && record.status in counted) counted[record.status as MarkStatus] += 1;
    }
    return counted;
  }, [records]);

  function setStatus(studentId: string, status: MarkStatus) {
    setRecords((current) => current.map((record) => (record.studentId === studentId ? { ...record, status } : record)));
  }

  async function save() {
    if (!classId) return;
    const payload = records
      .filter((record) => record.status !== 'unmarked')
      .map((record) => ({ studentId: record.studentId, status: record.status as MarkStatus, note: record.note }));
    if (payload.length === 0) return;
    setSaving(true);
    setError('');
    try {
      await saveClassAttendance(classId, { date, records: payload });
      setNotice(copy.saved);
      await load();
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setSaving(false);
    }
  }

  async function addStudent() {
    if (!classId || !addLogin.trim()) return;
    setAddBusy(true);
    setAddNotice('');
    try {
      await addClassMemberByLogin(classId, { login: addLogin.trim(), role: 'student' });
      setAddLogin('');
      setAddNotice(copy.studentAdded);
      await load();
    } catch (requestError) {
      setAddNotice(describe(requestError, language));
    } finally {
      setAddBusy(false);
    }
  }

  if (!isTeacher) {
    return (
      <div className="attendance-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{copy.eyebrow}</div>
            <h1>{copy.titleStudent}</h1>
            <p className="page-subtitle">{copy.subtitleStudent}</p>
          </div>
        </div>
        <div className="grid grid-3">
          <MetricCard icon={<Percent />} label={copy.rate} value={`${rate}%`} />
          <MetricCard icon={<CalendarCheck />} label={copy.totalMarks} value={String(history.length)} />
          <MetricCard icon={<UserCheck />} label={copy.presentDays} value={String(history.filter((h) => h.status === 'present' || h.status === 'late').length)} />
        </div>
        <section className="panel reveal-up" style={{ marginTop: 16 }}>
          <div className="section-head"><h2>{copy.history}</h2></div>
          {history.length === 0 ? (
            <p className="muted">{copy.noHistory}</p>
          ) : (
            <div className="stack">
              {history.map((entry) => (
                <div className="list-row" key={entry.id}>
                  <div>
                    <div className="list-title">{entry.className ?? '—'}</div>
                    <div className="list-meta">{entry.attendanceDate}</div>
                  </div>
                  <StatusTag status={entry.status as MarkStatus} copy={copy} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="attendance-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1>{copy.titleTeacher}</h1>
          <p className="page-subtitle">{copy.subtitleTeacher}</p>
        </div>
        <button type="button" className="btn primary" disabled={saving || records.length === 0} onClick={() => void save()}>
          {saving ? <RefreshCw className="school-spin" size={15} /> : <Check size={15} />}
          {copy.save}
        </button>
      </div>

      <div className="attendance-toolbar">
        <div className="control">
          <label htmlFor="attendance-class">{copy.pickClass}</label>
          <select id="attendance-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
            {classes.length === 0 && <option value="">{copy.noClasses}</option>}
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.academicYear}
              </option>
            ))}
          </select>
        </div>
        <div className="control">
          <label htmlFor="attendance-date">{copy.date}</label>
          <input id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <button type="button" className="btn" onClick={() => setRecords((current) => current.map((record) => ({ ...record, status: 'present' })))}>
          <UserCheck size={14} /> {copy.markAllPresent}
        </button>
        <button type="button" className="btn small" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'school-spin' : ''} />
        </button>
      </div>

      {canManage && (
        <form className="attendance-add-row" onSubmit={(event) => { event.preventDefault(); void addStudent(); }}>
          <label className="sr-only" htmlFor="attendance-add-login">{copy.addPrompt}</label>
          <input
            id="attendance-add-login"
            className="input"
            placeholder={copy.addPrompt}
            value={addLogin}
            onChange={(event) => setAddLogin(event.target.value)}
            maxLength={32}
          />
          <button type="submit" className="btn" disabled={addBusy || !addLogin.trim()}>
            {addBusy ? <RefreshCw className="school-spin" size={14} /> : <UserPlus size={14} />}
            {copy.addStudent}
          </button>
          {addNotice && <span className="muted attendance-add-notice">{addNotice}</span>}
        </form>
      )}

      {error && <div className="notice" role="alert"><CircleAlert size={15} /> {error}</div>}
      {notice && <div className="notice school-inline-success" role="status"><Check size={15} /> {notice}</div>}

      <div className="attendance-summary">
        {STATUS_ORDER.map((status) => (
          <div className={`attendance-pill status-${status}`} key={status}>
            <span>{copy[status]}</span>
            <b>{summary[status]}</b>
          </div>
        ))}
      </div>

      <section className="panel reveal-up">
        {loading ? (
          <p className="muted" role="status">…</p>
        ) : records.length === 0 ? (
          <p className="muted">{copy.noStudents}</p>
        ) : (
          <div className="attendance-list">
            {records.map((record) => (
              <div className="attendance-row" key={record.studentId}>
                <div className="attendance-person">
                  <span className="avatar">{record.studentName.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <b>{record.studentName}</b>
                    <small className="muted">@{record.login}</small>
                  </span>
                </div>
                <div className="attendance-actions">
                  {STATUS_ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`attendance-btn status-${status} ${record.status === status ? 'active' : ''}`}
                      onClick={() => setStatus(record.studentId, status)}
                      aria-label={copy[status]}
                    >
                      {record.status === status ? <Check size={13} /> : STATUS_ICON[status]}
                      {copy[status]}
                    </button>
                  ))}
                </div>
                {!canManage && <span className="tag gold">read-only</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const STATUS_ICON: Record<MarkStatus, React.ReactNode> = {
  present: <Check size={13} />,
  late: <Clock3 size={13} />,
  absent: <X size={13} />,
  excused: <Users size={13} />,
};

function StatusTag({ status, copy }: { status: MarkStatus; copy: Record<string, string> }) {
  return <span className={`tag attendance-tag status-${status}`}>{copy[status] ?? status}</span>;
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="panel metric">
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
      </div>
      <div className="metric-icon">{icon}</div>
    </div>
  );
}

function describe(error: unknown, language: Language): string {
  if (error instanceof ApiError) {
    if (typeof error.data === 'object' && error.data !== null && 'error' in error.data) {
      const message = (error.data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
    return `HTTP ${error.status}`;
  }
  return language === 'Русский' ? 'Не удалось загрузить давомат.' : 'Davomatni yuklab bo‘lmadi.';
}
