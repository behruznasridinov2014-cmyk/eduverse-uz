import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateField } from './ui/date-field';
import { Select } from './ui/select';
import { customFetch } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import {
  ApiError,
  getMySchools,
  getStudentAttendance,
  type AttendanceRecord,
  type AttendanceResponse,
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
  X,
} from 'lucide-react';
import type { Language } from './school-data';
import { attendanceSubject, lessonSubjectName, statusOf, useToday } from './today';

/** Lesson subjects. The value is stored with each mark; course books open by `book`. */
const SUBJECTS: Array<{ value: string; uz: string; ru: string; en: string; book?: 'physics' | 'chemistry' | 'biology' | 'math' }> = [
  { value: 'Математика', uz: 'Matematika', ru: 'Математика', en: 'Mathematics', book: 'math' },
  { value: 'Физика', uz: 'Fizika', ru: 'Физика', en: 'Physics', book: 'physics' },
  { value: 'Химия', uz: 'Kimyo', ru: 'Химия', en: 'Chemistry', book: 'chemistry' },
  { value: 'Биология', uz: 'Biologiya', ru: 'Биология', en: 'Biology', book: 'biology' },
  { value: 'Узбекский язык', uz: 'O‘zbek tili', ru: 'Узбекский язык', en: 'Uzbek' },
  { value: 'Русский язык', uz: 'Rus tili', ru: 'Русский язык', en: 'Russian' },
  { value: 'Английский язык', uz: 'Ingliz tili', ru: 'Английский язык', en: 'English' },
  { value: 'История', uz: 'Tarix', ru: 'История', en: 'History' },
  { value: 'География', uz: 'Geografiya', ru: 'География', en: 'Geography' },
  { value: 'Информатика', uz: 'Informatika', ru: 'Информатика', en: 'Computer science' },
  { value: 'Литература', uz: 'Adabiyot', ru: 'Литература', en: 'Literature' },
  { value: 'Физкультура', uz: 'Jismoniy tarbiya', ru: 'Физкультура', en: 'PE' },
];
const subjectLabel = (language: Language, value: string) => {
  const item = SUBJECTS.find((entry) => entry.value === value);
  return !item ? value : language === 'Русский' ? item.ru : language === 'English' ? item.en : item.uz;
};
import { friendlyError } from './errors';
import { LoadingBlock } from './ui/loading';

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

/** `lesson` locks the page to one lesson of today's timetable: its class and subject. */
export function AttendancePage({ user, language, lesson }: { user: User; language: Language; lesson?: { classId: string; subject: string } }) {
  const copy = COPY[language];
  const isTeacher = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';
  const isManager = user.role === 'school_director' || user.role === 'school_admin';
  // A teacher marks attendance only during the lesson. The director and deputy only look.
  const today = useToday();
  const hasTimetable = Boolean(today.data && (today.data.lessons.length || (today.data.next ?? []).some((day) => day.lessons.length)));
  const currentLesson = today.data?.lessons.find((item) => statusOf(item, today.now) === 'current');
  const lessonIsNow = Boolean(currentLesson && (!lesson || (currentLesson.classId === lesson.classId && attendanceSubject(currentLesson.subject) === attendanceSubject(lesson.subject))));
  const editable = user.role === 'teacher' && (lessonIsNow || (!hasTimetable && Boolean(today.data)));
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState(lesson?.classId ?? '');
  const [date, setDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [, navigate] = useLocation();
  const [subject, setSubject] = useState<string>(() => {
    const fromLesson = lesson ? SUBJECTS.find((item) => item.book === lesson.subject || item.value === lesson.subject)?.value ?? lesson.subject : null;
    if (fromLesson) return fromLesson;
    try { return localStorage.getItem('eduverse:attendance-subject') ?? 'Физика'; } catch { return 'Физика'; }
  });
  const [savedLesson, setSavedLesson] = useState(false);
  const pickSubject = (value: string) => { setSubject(value); try { localStorage.setItem('eduverse:attendance-subject', value); } catch { /* private mode */ } };
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<StudentAttendanceRecord[]>([]);
  const [rate, setRate] = useState(0);

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
      const response = await customFetch<AttendanceResponse>(`/api/classes/${classId}/attendance?date=${encodeURIComponent(date)}&subject=${encodeURIComponent(subject)}`, { method: 'GET' });
      setRecords(response.records);
      setCanManage(response.canManage);
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setLoading(false);
    }
  }, [classId, date, subject, language]);

  useEffect(() => {
    if (isTeacher) void load();
  }, [isTeacher, load]);
  useEffect(() => {
    if (user.role !== 'teacher' || lesson || !currentLesson) return;
    setClassId(currentLesson.classId);
    setSubject(attendanceSubject(currentLesson.subject));
  }, [user.role, lesson, currentLesson?.id]);

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
      await customFetch(`/api/classes/${classId}/attendance`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, subject, records: payload }) });
      setNotice(`${copy.saved}: ${subjectLabel(language, subject)}`);
      setSavedLesson(true);
      await load();
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setSaving(false);
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
        {editable && <button type="button" className="btn primary" disabled={saving || records.length === 0} onClick={() => void save()}>
          {saving ? <RefreshCw className="school-spin" size={15} /> : <Check size={15} />}
          {copy.save}
        </button>}
      </div>
      {user.role === 'teacher' && today.data && hasTimetable && !lessonIsNow && (() => {
        const next = today.data.lessons.find((item) => statusOf(item, today.now) === 'upcoming');
        return (
          <div className="empty-state attendance-closed">
            <span className="empty-icon"><Clock3 /></span>
            <h2>{language === 'Русский' ? 'Давомат отмечается во время урока' : language === 'English' ? 'Attendance is marked during the lesson' : 'Davomat dars vaqtida belgilanadi'}</h2>
            <p>{next
              ? (language === 'Русский' ? `Следующий урок в ${next.start}: ${next.className} · ${lessonSubjectName(next.subject, language)}` : language === 'English' ? `Next lesson at ${next.start}: ${next.className} · ${lessonSubjectName(next.subject, language)}` : `Keyingi dars ${next.start} da: ${next.className} · ${lessonSubjectName(next.subject, language)}`)
              : (language === 'Русский' ? 'На сегодня уроки закончились.' : language === 'English' ? 'Today’s lessons are over.' : 'Bugungi darslar tugadi.')}</p>
          </div>
        );
      })()}

      {(editable || isManager) && <div className="attendance-toolbar">
        {!lesson && (isManager || !hasTimetable) && <><div className="control">
          <label htmlFor="attendance-class">{copy.pickClass}</label>
          <Select id="attendance-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
            {classes.length === 0 && <option value="">{copy.noClasses}</option>}
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.academicYear}
              </option>
            ))}
          </Select>
        </div>
        <div className="control">
          <label htmlFor="attendance-subject">{language === 'Русский' ? 'Предмет урока' : language === 'English' ? 'Lesson subject' : 'Dars fani'}</label>
          <Select id="attendance-subject" value={subject} onChange={(event) => { pickSubject(event.target.value); setSavedLesson(false); }}>
            {SUBJECTS.map((item) => <option key={item.value} value={item.value}>{subjectLabel(language, item.value)}</option>)}
          </Select>
        </div></>}
        {isManager && <div className="control">
          <label htmlFor="attendance-date">{copy.date}</label>
          <DateField id="attendance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>}
        {editable && currentLesson && !lesson && <b className="attendance-now">{currentLesson.start}–{currentLesson.end} · {currentLesson.className} · {lessonSubjectName(currentLesson.subject, language)}</b>}
        {editable && <button type="button" className="btn" onClick={() => setRecords((current) => current.map((record) => ({ ...record, status: 'present' })))}>
          <UserCheck size={14} /> {copy.markAllPresent}
        </button>}
        <button type="button" className="btn small" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'school-spin' : ''} />
        </button>
      </div>}


      {error && <div className="notice" role="alert"><CircleAlert size={15} /> {error}</div>}
      {notice && <div className="notice school-inline-success" role="status"><Check size={15} /> {notice}</div>}
      {savedLesson && (() => {
        const book = SUBJECTS.find((item) => item.value === subject)?.book;
        if (!book) return null;
        return (
          <button type="button" className="btn primary attendance-topic-btn" onClick={() => {
            try { localStorage.setItem('eduverse:course-class', classId); localStorage.setItem('eduverse:course-subject', book); } catch { /* private mode */ }
            navigate('/course');
          }}>
            {language === 'Русский' ? 'Открыть сегодняшнюю тему урока' : language === 'English' ? 'Open today’s lesson topic' : 'Bugungi dars mavzusini ochish'} · {subjectLabel(language, subject)}
          </button>
        );
      })()}

      {(editable || isManager) && <><div className="attendance-summary">
        {STATUS_ORDER.map((status) => (
          <div className={`attendance-pill status-${status}`} key={status}>
            <span>{copy[status]}</span>
            <b>{summary[status]}</b>
          </div>
        ))}
      </div>

      <section className="panel reveal-up">
        {loading ? (
          <LoadingBlock language={language} kind="inline" />
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
                {!editable ? (record.status !== 'unmarked' ? <StatusTag status={record.status as MarkStatus} copy={copy} /> : <span className="muted">—</span>) : <div className="attendance-actions">
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
                </div>}
              </div>
            ))}
          </div>
        )}
      </section></>}
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
  return friendlyError(error, language, { en: 'Attendance could not be loaded.', ru: 'Не удалось загрузить давомат.', uz: 'Davomatni yuklab bo‘lmadi.' });
}
