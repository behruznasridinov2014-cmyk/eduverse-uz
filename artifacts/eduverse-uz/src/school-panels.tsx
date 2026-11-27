import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { DateField } from './ui/date-field';
import { Select } from './ui/select';
import { LoadingBlock } from './ui/loading';
import { friendlyError } from './errors';
import { statusOf, useToday } from './today';
import { customFetch } from '@workspace/api-client-react';
import {
  assignTopicToClass,
  createAssignment,
  createClass,
  createClassAccounts,
  createSchool,
  deleteAssignment,
  getClass,
  getSchool,
  listClassMembers,
  listSchoolMembers,
  listSchools,
  listSubmissions,
  listTopics,
  reviewSubmission,
  submitAssignment,
  updateAssignment,
  type AssignmentSummary,
  type ClassAccount,
  type ClassMember,
  type CreateAssignmentRequest,
  type CreateClassRequest,
  type CreateSchoolRequest,
  type LessonTopic,
  type MyAssignment,
  type ReviewSubmissionRequest,
  type SchoolClass,
  type SchoolMember,
  type SchoolRecord,
  type SubmissionWithStudent,
  type UpdateAssignmentRequest,
  type User,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  GraduationCap,
  Info,
  KeyRound,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import {
  describeSchoolError,
  formatDue,
  formatStatus,
  isManagerRole,
  type Language,
  type SchoolData,
} from './school-data';
import { HomeworkAiCheck, PhotoPicker, SignaturePad, SignatureStamp, SubmissionPhotos, honestCode, photoMetaFor } from './homework';
import { MARKS, markBand, markOf, scoreOf } from './marks';
import { COURSE, pdfPageOf } from './course-data';

const ASSIGNMENT_STATUSES = [
  'assigned',
  'in_progress',
  'submitted',
  'under_review',
  'needs_revision',
  'checked',
] as const;

const REVIEW_STATUSES = [
  'in_progress',
  'submitted',
  'under_review',
  'needs_revision',
  'checked',
] as const;

function t(language: Language, en: string, ru: string, uz: string): string {
  if (language === 'English') return en;
  if (language === 'Русский') return ru;
  return uz;
}

function Panel({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`panel ${className}`} style={style}>{children}</section>;
}

function SectionHead({ title, detail, tag }: { title: string; detail?: string; tag?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {detail && <p className="muted" style={{ margin: '3px 0 0' }}>{detail}</p>}
      </div>
      {tag}
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="notice school-inline-error" role="alert">
      <Info size={15} />
      <span>{children}</span>
    </div>
  );
}

function RefreshButton({ onClick, busy, language }: { onClick: () => void; busy: boolean; language: Language }) {
  return (
    <button type="button" className="btn small" onClick={onClick} disabled={busy}>
      <RefreshCw size={14} className={busy ? 'school-spin' : undefined} />
      {t(language, 'Refresh', 'Обновить', 'Yangilash')}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Account school scope                                                        */
/* -------------------------------------------------------------------------- */

const SUBJECT_TEXT: Record<string, [string, string, string]> = {
  Mathematics: ['Mathematics', 'Математика', 'Matematika'],
  Biology: ['Biology', 'Биология', 'Biologiya'],
  History: ['History', 'История', 'Tarix'],
  Physics: ['Physics', 'Физика', 'Fizika'],
  Chemistry: ['Chemistry', 'Химия', 'Kimyo'],
  Uzbek: ['Uzbek', 'Узбекский язык', 'O‘zbek tili'],
  Russian: ['Russian', 'Русский язык', 'Rus tili'],
  English: ['English', 'Английский язык', 'Ingliz tili'],
};

export function SchoolScopeSummary({ school, language }: { school: SchoolData; language: Language }) {
  const statusLabel =
    school.status === 'loading'
      ? t(language, 'Loading…', 'Загружаем…', 'Yuklanmoqda…')
      : school.status === 'ready'
        ? t(language, 'School data loaded', 'Данные школы загружены', 'Maktab ma’lumotlari yuklandi')
        : school.status === 'unavailable'
          ? t(language, 'School data not loaded', 'Данные школы не загрузились', 'Maktab ma’lumotlari yuklanmadi')
          : t(language, 'Opening your account…', 'Открываем ваш аккаунт…', 'Hisobingiz ochilmoqda…');

  return (
    <Panel className="school-scope-summary">
      <SectionHead
        title={t(language, 'School account scope', 'Учебный профиль', 'Maktab hisobi doirasi')}
        detail={statusLabel}
        tag={
          <span className={`tag ${school.status === 'ready' ? 'green' : school.status === 'unavailable' ? 'gold' : 'blue'}`}>
            {school.status === 'ready' ? t(language, 'Live', 'Активно', 'Faol') : t(language, 'Wait', 'Ждём', 'Kuting')}
          </span>
        }
      />
      <div className="grid grid-3 school-scope-grid">
        <div className="school-scope-metric">
          <span>{t(language, 'Organizations', 'Организации', 'Tashkilotlar')}</span>
          <b>{school.memberships.length}</b>
          <small>{school.memberships[0]?.schoolName ?? t(language, 'No school membership', 'Нет членства в школе', 'Maktabga a’zolik yo‘q')}</small>
        </div>
        <div className="school-scope-metric">
          <span>{t(language, 'Classes', 'Классы', 'Sinflar')}</span>
          <b>{school.classes.length}</b>
          <small>
            {school.classes
              .slice(0, 3)
              .map((item) => item.name)
              .join(' · ') || t(language, 'No linked class', 'Нет привязанного класса', 'Bog‘langan sinf yo‘q')}
          </small>
        </div>
        <div className="school-scope-metric">
          <span>{t(language, 'Assignments', 'Задания', 'Topshiriqlar')}</span>
          <b>{school.assignments.length}</b>
          <small>
            {t(language, 'Submitted by you', 'Сдано вами', 'Siz topshirgan')}: {school.mySubmissionCount}
          </small>
        </div>
      </div>
      {school.error && <InlineError>{school.error}</InlineError>}
      <div className="row school-scope-actions">
        <RefreshButton onClick={() => void school.refresh()} busy={school.status === 'loading'} language={language} />
        <span className="muted">
          {school.status === 'ready'
            ? t(
                language,
                'Rosters, classes and assignments of your school.',
                'Списки, классы и задания вашей школы.',
                'Maktabingizning ro‘yxatlari, sinflari va topshiriqlari.',
              )
            : t(
                language,
                'School data is not available right now. Refresh in a moment.',
                'Данные школы сейчас недоступны. Обновите чуть позже.',
                'Maktab ma’lumotlari hozir mavjud emas. Birozdan so‘ng yangilang.',
              )}
        </span>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Classes                                                                     */
/* -------------------------------------------------------------------------- */

type ClassWorkspace = {
  role: string | null;
  schoolRole: string | null;
  members: ClassMember[];
  loading: boolean;
  error: string;
};

const EMPTY_WORKSPACE: ClassWorkspace = {
  role: null,
  schoolRole: null,
  members: [],
  loading: false,
  error: '',
};

export function ServerClassesPanel({
  school,
  user,
  language,
  onOpen,
}: {
  school: SchoolData;
  user: User;
  language: Language;
  onOpen: (path: string) => void;
}) {
  const today = useToday();
  const [selectedId, setSelectedId] = useState('');
  const [workspace, setWorkspace] = useState<ClassWorkspace>(EMPTY_WORKSPACE);
  const [revision, setRevision] = useState(0);
  // The homework being written is kept on the device: when a phone reloads the page after the
  // camera (Android and iOS do that when memory is short), the photos and the text come back.
  const draftKey = `eduverse:hw-draft:${user.id}`;
  const savedDraft = useMemo(() => {
    try { const raw = localStorage.getItem(draftKey); return raw ? JSON.parse(raw) as { assignmentId: string; content: string; photos: string[] } : null; } catch { return null; }
  }, [draftKey]);
  const [draftAssignmentId, setDraftAssignmentId] = useState<string | null>(savedDraft?.assignmentId ?? null);
  const [draftContent, setDraftContent] = useState(savedDraft?.content ?? '');
  const [draftPhotos, setDraftPhotos] = useState<string[]>(savedDraft?.photos ?? []);
  useEffect(() => {
    try {
      if (!draftAssignmentId) { localStorage.removeItem(draftKey); return; }
      const value = { assignmentId: draftAssignmentId, content: draftContent, photos: draftPhotos };
      try { localStorage.setItem(draftKey, JSON.stringify(value)); } catch { localStorage.setItem(draftKey, JSON.stringify({ ...value, photos: [] })); }
    } catch { /* private mode */ }
  }, [draftKey, draftAssignmentId, draftContent, draftPhotos]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [mutationError, setMutationError] = useState('');

  const activeClass =
    school.classes.find((item) => item.id === selectedId) ?? school.classes[0];
  const activeClassId = activeClass?.id ?? '';

  useEffect(() => {
    if (!activeClassId) {
      setWorkspace(EMPTY_WORKSPACE);
      return;
    }
    let cancelled = false;
    setWorkspace((current) => ({ ...current, loading: true, error: '' }));

    Promise.all([getClass(activeClassId), listClassMembers(activeClassId)])
      .then(([detail, members]) => {
        if (cancelled) return;
        setWorkspace({
          role: detail.role ?? null,
          schoolRole: detail.schoolRole ?? null,
          members: members.members,
          loading: false,
          error: '',
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkspace({ ...EMPTY_WORKSPACE, error: friendlyError(error, language) });
      });

    return () => {
      cancelled = true;
    };
  }, [activeClassId, revision]);

  const classAssignments = useMemo(
    () => school.assignments.filter((item) => item.classId === activeClassId),
    [school.assignments, activeClassId],
  );
  const studentMembers = workspace.members.filter((member) => member.role === 'student');
  const teacherMembers = workspace.members.filter((member) => member.role === 'teacher');
  const canSubmit = user.role === 'student' && workspace.role === 'student';
  const canManageClass = isManagerRole(user.role) || workspace.role === 'teacher';

  async function submitWork(assignment: MyAssignment) {
    if (draftPhotos.length === 0 && !assignment.mySubmission?.attachmentCount) {
      setMutationError(t(language, 'Add at least one photo of your notebook.', 'Добавьте хотя бы одно фото тетради.', 'Daftaringizning kamida bitta rasmini qo‘shing.'));
      return;
    }
    setBusyId(assignment.id);
    setMutationError('');
    setNotice('');
    try {
      await submitAssignment(assignment.id, {
        content: draftContent.trim() || t(language, 'Notebook photo', 'Фото тетради', 'Daftar rasmi'),
        ...(draftPhotos.length ? { attachments: draftPhotos, photoMeta: photoMetaFor(draftPhotos) } : {}),
      } as Parameters<typeof submitAssignment>[1]);
      setDraftAssignmentId(null);
      setDraftContent('');
      setDraftPhotos([]);
      setNotice(
        t(
          language,
          assignment.mySubmission ? 'Submission updated.' : 'Work submitted to the teacher.',
          assignment.mySubmission ? 'Работа обновлена.' : 'Работа отправлена учителю.',
          assignment.mySubmission ? 'Topshiriq yangilandi.' : 'Ish o‘qituvchiga yuborildi.',
        ),
      );
      await school.refresh();
      setRevision((value) => value + 1);
      window.setTimeout(() => setNotice(''), 4000);
    } catch (error) {
      setMutationError(friendlyError(error, language));
    } finally {
      setBusyId(null);
    }
  }

  const isStudent = user.role === 'student';
  // A pupil sees only what is still to do; handed-in work goes to "My grades".
  // Homework is accepted until 00:00 of the lesson day; missed work stays visible for 3 days, marked late.
  const isOverdue = (item: MyAssignment) => !item.mySubmission && Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now();
  const todoAssignments = classAssignments.filter((item) => !item.mySubmission && !isOverdue(item));
  // Missed work: can be looked at, but not handed in any more.
  const expiredAssignments = classAssignments.filter((item) => isOverdue(item) && Date.now() - new Date(item.dueAt as string).getTime() < 14 * 86_400_000);
  const [showStudents, setShowStudents] = useState(false);
  if (isStudent) {
    const renderCard = (assignment: MyAssignment, at: number, list: MyAssignment[]) => {
                const submission = assignment.mySubmission;
                const subjectHead = at === 0 || list[at - 1]!.subject !== assignment.subject;
                const isEditing = draftAssignmentId === assignment.id;
                const overdue = isOverdue(assignment);
                const bookTopic = (() => {
                  if (!assignment.topicId?.startsWith('course:')) return null;
                  const key = assignment.topicId.slice(7);
                  for (const book of COURSE) { const topic = book.topics.find((item) => item.key === key); if (topic) return { book, topic }; }
                  return null;
                })();
                const openBook = () => {
                  if (!bookTopic) { onOpen('/topics'); return; }
                  const page = pdfPageOf(bookTopic.book, bookTopic.topic);
                  try {
                    if (page) localStorage.setItem(`eduverse:pdf-page:/books/${bookTopic.book.bookId}.pdf`, String(page));
                    localStorage.removeItem(`eduverse:pdf-range:/books/${bookTopic.book.bookId}.pdf`);
                  } catch { /* private mode */ }
                  onOpen(`/read/${bookTopic.book.bookId}`);
                };
                return (
                  <div key={assignment.id} className="stack" style={{ gap: 6 }}>
                  {subjectHead && <h3 className="hw-subject-head">{assignment.subject}</h3>}
                  <article className="school-assignment-card">
                    <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                      <div>
                        <b>{assignment.title}</b>
                      </div>
                      <span className={`tag ${overdue ? 'red' : submission ? (submission.score !== null && submission.score !== undefined ? 'green' : 'blue') : 'gold'}`}>
                        {overdue
                          ? t(language, 'Time is up', 'Срок истёк', 'Muddat tugadi')
                          : !submission
                          ? (() => {
                            const due = assignment.dueAt ? new Date(assignment.dueAt) : null;
                            const time = due ? due.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }) : '00:00';
                            const shown = time === '23:59' ? '00:00' : time;
                            return t(language, `Due by ${shown}`, `Сдать до ${shown}`, `${shown} gacha topshiring`);
                          })()
                          : submission.score !== null && submission.score !== undefined
                            ? `${t(language, 'Checked', 'Проверено', 'Tekshirildi')} · ${markOf(submission.score)}`
                            : t(language, 'In review', 'На проверке', 'Tekshirilmoqda')}
                      </span>
                    </div>
                    {bookTopic && !assignment.title.includes(bookTopic.topic.title) && <div className="hw-topic-line"><BookOpen size={14} /> §{bookTopic.topic.code} · {bookTopic.topic.title}</div>}
                    {assignment.description && (
                      <details className="hw-task">
                        <summary>{t(language, 'What to do', 'Что сделать', 'Nima qilish kerak')}</summary>
                        <p className="muted school-assignment-copy">{assignment.description}</p>
                      </details>
                    )}
                    {(assignment.topicTitle || bookTopic) && (
                      <button type="button" className="btn small hw-book-btn" onClick={openBook}>
                        <BookOpen size={14} />
                        {t(language, 'Textbook', 'Учебник', 'Darslik')}
                      </button>
                    )}
                    {submission && (
                      <div className="callout school-submission-copy">
                        <b>{t(language, 'Your submission', 'Ваша работа', 'Sizning topshirig‘ingiz')}</b>
                        <br />
                        {submission.content}
                        {(submission.attachmentCount ?? 0) > 0 && (
                          <SubmissionPhotos
                            assignmentId={assignment.id}
                            studentId={submission.studentId}
                            count={submission.attachmentCount ?? 0}
                            language={language}
                            refreshKey={submission.updatedAt}
                          />
                        )}
                        {submission.feedback && (
                          <>
                            <br />
                            <b>{t(language, 'Teacher feedback', 'Комментарий учителя', 'O‘qituvchi izohi')}:</b> {submission.feedback}
                          </>
                        )}
                        {submission.score !== null && submission.score !== undefined && (
                          <>
                            {' '}
                            · {t(language, 'Grade', 'Оценка', 'Baho')}: {markOf(submission.score)}
                          </>
                        )}
                        {submission.signature && (
                          <SignatureStamp
                            signature={submission.signature}
                            signedBy={submission.signedBy}
                            signedAt={submission.signedAt}
                            language={language}
                          />
                        )}
                      </div>
                    )}
                    {canSubmit && !overdue && !(submission && submission.score !== null && submission.score !== undefined) && !(submission?.signedAt && submission.status === 'checked') && (
                      <div className="stack" style={{ gap: 8 }}>
                        {isEditing ? (
                          <>
                            <div className="control">
                              <label>{t(language, '1. Do it in your notebook, then photograph it', '1. Выполните в тетради и сфотографируйте', '1. Daftarda bajaring va suratga oling')}</label>
                              <div className="hw-code">
                                <b>{honestCode(assignment.id, user.id)}</b>
                                <span>{t(language, 'Write this code in the corner of the page before taking the photo.', 'Напишите этот код в углу страницы, потом сфотографируйте.', 'Bu kodni sahifa burchagiga yozing, keyin suratga oling.')}</span>
                              </div>
                              <PhotoPicker
                                photos={draftPhotos}
                                onChange={setDraftPhotos}
                                language={language}
                                existingCount={submission?.attachmentCount ?? 0}
                              />
                            </div>
                            <div className="control">
                              <label htmlFor={`submit-${assignment.id}`}>
                                {t(language, '2. In your own words (optional)', '2. Своими словами (по желанию)', '2. O‘z so‘zingiz bilan (ixtiyoriy)')}
                              </label>
                              <textarea
                                id={`submit-${assignment.id}`}
                                value={draftContent}
                                onChange={(event) => setDraftContent(event.target.value)}
                                placeholder={t(language, 'A few sentences about the topic…', 'Несколько предложений о теме…', 'Mavzu haqida bir necha gap…')}
                              />
                            </div>
                            <div className="row">
                              <button
                                type="button"
                                className="btn primary"
                                disabled={busyId === assignment.id || (draftPhotos.length === 0 && !submission?.attachmentCount)}
                                onClick={() => void submitWork(assignment)}
                              >
                                <Send size={14} />
                                {submission
                                  ? t(language, 'Update submission', 'Обновить работу', 'Topshiriqni yangilash')
                                  : t(language, 'Submit work', 'Отправить работу', 'Ishni topshirish')}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  setDraftAssignmentId(null);
                                  setDraftContent('');
                                  setDraftPhotos([]);
                                }}
                              >
                                {t(language, 'Cancel', 'Отмена', 'Bekor qilish')}
                              </button>
                            </div>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => {
                              setDraftAssignmentId(assignment.id);
                              setDraftContent(submission?.content ?? '');
                              setDraftPhotos([]);
                              setNotice('');
                              setMutationError('');
                            }}
                          >
                            <Send size={13} />
                            {submission
                              ? t(language, 'Edit submission', 'Изменить работу', 'Topshiriqni tahrirlash')
                              : t(language, 'Submit work', 'Отправить работу', 'Ishni topshirish')}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                  </div>
                );
    };
    // A pupil sees only the homework that is still to do.
    return (
      <Panel>
          {/* On a phone the top of the page is off screen: the result of sending pops up at the bottom. */}
          {notice && <div className="notice school-inline-success hw-toast" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}
          {mutationError && <div className="hw-toast is-error" role="alert"><InlineError>{mutationError}</InlineError></div>}
          {todoAssignments.length === 0 ? (
            <div className="callout">
              {classAssignments.length === 0
                ? t(language, 'No homework yet.', 'Заданий пока нет.', 'Hali vazifa yo‘q.')
                : t(language, 'All homework is done. Grades are in “My grades”.', 'Все задания сделаны. Оценки — во вкладке «Мои оценки».', 'Barcha vazifalar bajarilgan. Baholar — «Mening baholarim»da.')}
            </div>
          ) : (
            <div className="stack school-assignment-list">
              {(() => {
                // Subjects to hand in today: one glance, then the cards below grouped by subject.
                const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
                const dueToday = [...new Set(todoAssignments.filter((item) => !isOverdue(item) && item.dueAt && new Date(new Date(item.dueAt).getTime() + 5 * 3600_000).toISOString().slice(0, 10) === today).map((item) => item.subject))];
                return dueToday.length > 0 && (
                  <div className="hw-today">
                    <b>{t(language, 'Today, by 00:00', 'Сегодня до 00:00', 'Bugun 00:00 gacha')}:</b>
                    {dueToday.map((subject) => <span key={subject} className="tag gold">{subject}</span>)}
                  </div>
                );
              })()}
              {[...todoAssignments].sort((a, b) => a.subject.localeCompare(b.subject)).map(renderCard)}
            </div>
          )}
          {expiredAssignments.length > 0 && (
            <details className="hw-expired">
              <summary>{t(language, `Time is up (${expiredAssignments.length})`, `Срок истёк (${expiredAssignments.length})`, `Muddati tugagan (${expiredAssignments.length})`)}</summary>
              <div className="stack school-assignment-list">{[...expiredAssignments].sort((a, b) => a.subject.localeCompare(b.subject)).map(renderCard)}</div>
            </details>
          )}
      </Panel>
    );
  }
  return (
    <>
      <div className="class-pick">
        {school.classes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`class-pick-card ${item.id === activeClassId ? 'selected' : ''}`}
            onClick={() => { setSelectedId(item.id); setShowStudents(false); }}
          >
            <b>{t(language, `Class ${item.name}`, `${item.name} класс`, `${item.name} sinf`)}</b>
            <small className="muted">{item.studentCount ?? 0} {t(language, 'students', 'учеников', 'o‘quvchi')}</small>
          </button>
        ))}
      </div>

      <Panel className="class-info">
        <h2>{activeClass ? t(language, `Class ${activeClass.name}`, `${activeClass.name} класс`, `${activeClass.name} sinf`) : ''}</h2>
        {workspace.loading ? (
          <p className="muted" role="status">{t(language, 'Loading…', 'Загружаем…', 'Yuklanmoqda…')}</p>
        ) : workspace.error ? (
          <InlineError>{workspace.error}</InlineError>
        ) : (
          <>
            <div className="class-info-grid">
              <div><small className="muted">{t(language, 'Grade', 'Параллель', 'Sinf')}</small><b>{activeClass?.grade}{t(language, ' grade', ' класс', '-sinf')}</b></div>
              <div><small className="muted">{t(language, 'School year', 'Учебный год', 'O‘quv yili')}</small><b>{activeClass ? (/^\d{4}$/.test(String(activeClass.academicYear).trim()) ? `${activeClass.academicYear}–${Number(activeClass.academicYear) + 1}` : activeClass.academicYear) : ''}</b></div>
              <div><small className="muted">{t(language, 'Students', 'Учеников', 'O‘quvchilar')}</small><b>{studentMembers.length}</b></div>
            </div>
            <div className="class-info-block">
              <small className="muted">{t(language, 'Teachers', 'Учителя класса', 'Sinf o‘qituvchilari')}</small>
              <p>{teacherMembers.map((member) => member.username).join(', ') || t(language, 'Not added yet', 'Пока не добавлены', 'Hali qo‘shilmagan')}</p>
            </div>
            <button type="button" className="btn" onClick={() => setShowStudents((value) => !value)}>
              <Users size={15} /> {showStudents ? t(language, 'Hide students', 'Скрыть учеников', 'O‘quvchilarni yashirish') : t(language, `Students · ${studentMembers.length}`, `Ученики · ${studentMembers.length}`, `O‘quvchilar · ${studentMembers.length}`)}
            </button>
            {showStudents && (
              <ol className="class-students">
                {studentMembers.map((member) => <li key={member.userId}>{member.username}</li>)}
                {studentMembers.length === 0 && <li className="muted">{t(language, 'No students yet.', 'Учеников пока нет.', 'Hali o‘quvchi yo‘q.')}</li>}
              </ol>
            )}
            {user.role === 'teacher' && canManageClass && (today.data?.lessons ?? []).some((lesson) => lesson.classId === activeClass?.id && statusOf(lesson, today.now) === 'current') && (
              <button type="button" className="btn primary" style={{ marginTop: 14 }} onClick={() => onOpen('/attendance')}>
                {t(language, 'Mark attendance', 'Отметить давомат', 'Davomatni belgilash')}
                <ArrowRight size={15} />
              </button>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Teacher workspace                                                           */
/* -------------------------------------------------------------------------- */

type ReviewDraft = {
  status: string;
  score: string;
  feedback: string;
  signature: string | null;
};

export function ServerTeachingPanel({
  school,
  language,
}: {
  school: SchoolData;
  language: Language;
}) {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', subject: 'Mathematics', description: '', dueAt: '', topicId: '' });
  const [topics, setTopics] = useState<LessonTopic[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyAssignmentId, setBusyAssignmentId] = useState<string | null>(null);
  const [reviewAssignmentId, setReviewAssignmentId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithStudent[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeClass: SchoolClass | undefined =
    school.classes.find((item) => item.id === selectedClassId) ?? school.classes[0];
  const activeClassId = activeClass?.id ?? '';
  const classAssignments = useMemo(
    () => school.assignments.filter((item) => item.classId === activeClassId),
    [school.assignments, activeClassId],
  );
  const reviewAssignment = classAssignments.find((item) => item.id === reviewAssignmentId) ?? null;

  useEffect(() => {
    listTopics().then((response) => setTopics(response.topics ?? [])).catch(() => setTopics([]));
  }, []);

  useEffect(() => {
    if (!reviewAssignmentId) {
      setSubmissions([]);
      setReviewDrafts({});
      return;
    }
    let cancelled = false;
    setReviewLoading(true);
    setError('');
    listSubmissions(reviewAssignmentId)
      .then((response) => {
        if (cancelled) return;
        setSubmissions(response.submissions);
        setReviewDrafts(
          Object.fromEntries(
            response.submissions.map((submission) => [
              submission.studentId,
              {
                status: submission.status,
                score: submission.score === null || submission.score === undefined ? '' : String(submission.score),
                feedback: submission.feedback,
                signature: null,
              },
            ]),
          ),
        );
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(friendlyError(requestError, language));
      })
      .finally(() => {
        if (!cancelled) setReviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewAssignmentId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeClassId || !form.title.trim() || !form.description.trim()) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const payload: CreateAssignmentRequest = {
        title: form.title.trim(),
        subject: form.subject.trim(),
        description: form.description.trim(),
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        ...(form.topicId
          ? {
              topicId: form.topicId,
              topicTitle: topics.find((topic) => topic.id === form.topicId)?.title ?? '',
            }
          : {}),
      };
      await createAssignment(activeClassId, payload);
      setForm({ title: '', subject: form.subject, description: '', dueAt: '', topicId: '' });
      setNotice(
        t(language, 'Assignment published.', 'Задание опубликовано.', 'Topshiriq joylandi.'),
      );
      await school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(assignment: AssignmentSummary, status: string) {
    setBusyAssignmentId(assignment.id);
    setError('');
    setNotice('');
    try {
      await updateAssignment(assignment.id, { status: status as UpdateAssignmentRequest['status'] });
      await school.refresh();
      setNotice(t(language, 'Assignment status updated.', 'Статус задания обновлён.', 'Topshiriq holati yangilandi.'));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusyAssignmentId(null);
    }
  }

  async function removeAssignment(assignment: AssignmentSummary) {
    if (!window.confirm(t(
      language,
      `Delete “${assignment.title}”? Submissions for it will also be removed.`,
      `Удалить «${assignment.title}»? Работы по нему тоже будут удалены.`,
      `“${assignment.title}” o‘chirilsinmi? Uning topshiriq javoblari ham o‘chiriladi.`,
    ))) {
      return;
    }
    setBusyAssignmentId(assignment.id);
    setError('');
    try {
      await deleteAssignment(assignment.id);
      if (reviewAssignmentId === assignment.id) setReviewAssignmentId(null);
      await school.refresh();
      setNotice(t(language, 'Assignment deleted.', 'Задание удалено.', 'Topshiriq o‘chirildi.'));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusyAssignmentId(null);
    }
  }

  function updateDraft(studentId: string, patch: Partial<ReviewDraft>) {
    setReviewDrafts((current) => ({
      ...current,
      [studentId]: {
        status: current[studentId]?.status ?? 'submitted',
        score: current[studentId]?.score ?? '',
        feedback: current[studentId]?.feedback ?? '',
        signature: current[studentId]?.signature ?? null,
        ...patch,
      },
    }));
  }

  async function saveReview(studentId: string) {
    if (!reviewAssignmentId) return;
    const draft = reviewDrafts[studentId];
    if (!draft) return;
    setReviewBusyId(studentId);
    setError('');
    setNotice('');
    try {
      const payload: ReviewSubmissionRequest = {
        status: draft.status as ReviewSubmissionRequest['status'],
        score: draft.score.trim() === '' ? null : Number(draft.score),
        feedback: draft.feedback,
        ...(draft.signature ? { signature: draft.signature } : {}),
      };
      await reviewSubmission(reviewAssignmentId, studentId, payload);
      setSavedIds((current) => [...current.filter((id) => id !== studentId), studentId]);
      // The list and counters refresh in the background: the button is free at once.
      void listSubmissions(reviewAssignmentId).then((refreshed) => setSubmissions(refreshed.submissions)).catch(() => {});
      void school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setReviewBusyId(null);
    }
  }

  return (
    <>
      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}

      <div className="grid grid-2" style={{ marginTop: error || notice ? 12 : 0 }}>
        {!showForm ? (
          <Panel>
            <SectionHead title={t(language, 'Your own assignment', 'Своё задание', 'O‘z topshirig‘ingiz')} detail={t(language, 'If the textbook homework is not enough, write your own.', 'Если домашки из учебника мало, напишите своё.', 'Darslikdagi topshiriqlar yetmasa, o‘zingiz yozing.')} />
            <button type="button" className="btn" onClick={() => setShowForm(true)}>{t(language, 'Write an assignment', 'Написать задание', 'Topshiriq yozish')}</button>
          </Panel>
        ) : (
        <Panel>
          <SectionHead
            title={t(language, 'Publish an assignment', 'Опубликовать задание', 'Topshiriq joylash')}
            detail={activeClass ? `${activeClass.name} · ${activeClass.academicYear}` : undefined}
            tag={
              <Select
                className="top-select"
                aria-label={t(language, 'Class', 'Класс', 'Sinf')}
                value={activeClassId}
                onChange={(event) => {
                  setSelectedClassId(event.target.value);
                  setReviewAssignmentId(null);
                }}
              >
                {school.classes.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · {item.academicYear}
                  </option>
                ))}
              </Select>
            }
          />
          <form className="stack" onSubmit={handleCreate}>
            <div className="control">
              <label htmlFor="server-assignment-title">{t(language, 'Title', 'Название', 'Sarlavha')}</label>
              <input
                id="server-assignment-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder={t(language, 'A short, clear title', 'Короткое понятное название', 'Qisqa va aniq sarlavha')}
                maxLength={180}
              />
            </div>
            <div className="grid grid-2">
              <div className="control">
                <label htmlFor="server-assignment-subject">{t(language, 'Subject', 'Предмет', 'Fan')}</label>
                <Select
                  id="server-assignment-subject"
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                >
                  {['Mathematics', 'Biology', 'History', 'Physics', 'Chemistry', 'Uzbek', 'Russian', 'English'].map((subject) => (
                    <option value={subject} key={subject}>{t(language, ...(SUBJECT_TEXT[subject] ?? [subject, subject, subject]))}</option>
                  ))}
                </Select>
              </div>
              <div className="control">
                <label htmlFor="server-assignment-due">{t(language, 'Due date', 'Срок', 'Muddat')}</label>
                <DateField
                  id="server-assignment-due"
                  type="datetime"
                  value={form.dueAt}
                  onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
                />
              </div>
            </div>
            <div className="control">
              <label htmlFor="server-assignment-topic">{t(language, 'Linked 3D theory topic', 'Связанная тема 3D-теории', 'Bog‘langan 3D nazariya mavzusi')}</label>
              <Select
                id="server-assignment-topic"
                value={form.topicId}
                onChange={(event) => setForm({ ...form, topicId: event.target.value })}
              >
                <option value="">{t(language, 'No topic', 'Без темы', 'Mavzusiz')}</option>
                {topics.map((topic) => (
                  <option value={topic.id} key={topic.id}>{topic.subject} · {topic.title}</option>
                ))}
              </Select>
            </div>
            <div className="control">
              <label htmlFor="server-assignment-description">{t(language, 'Instructions', 'Инструкции', 'Ko‘rsatmalar')}</label>
              <textarea
                id="server-assignment-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder={t(language, 'Describe what students should do…', 'Опишите, что должны сделать ученики…', 'O‘quvchilar nima qilishini yozing…')}
                maxLength={4000}
              />
            </div>
            <button
              type="submit"
              className="btn primary"
              disabled={creating || !form.title.trim() || !form.description.trim()}
            >
              <Plus size={15} />
              {creating
                ? t(language, 'Publishing…', 'Публикуем…', 'Joylanmoqda…')
                : t(language, 'Publish assignment', 'Опубликовать задание', 'Topshiriqni joylash')}
            </button>
          </form>
        </Panel>
        )}

        <Panel className="review-queue-panel">
          <span id="review-queue" />
          <SectionHead
            title={t(language, 'Review queue', 'Проверка работ', 'Tekshiruv')}
            detail={
              reviewAssignment
                ? `${reviewAssignment.title} · ${formatStatus(reviewAssignment.status)}`
                : t(language, 'Choose an assignment to review student work.', 'Выберите задание для проверки работ.', 'O‘quvchi ishlarini tekshirish uchun topshiriq tanlang.')
            }
            tag={
              <span className="tag gold">
                {t(language, 'Teacher only', 'Только учитель', 'Faqat o‘qituvchi')}
              </span>
            }
          />
          {reviewLoading ? (
            <p className="muted" role="status">{t(language, 'Loading submissions…', 'Загружаем работы…', 'Topshiriqlar yuklanmoqda…')}</p>
          ) : reviewAssignment ? (
            submissions.length === 0 ? (
              <div className="callout">
                {t(language, 'No student has submitted this assignment yet.', 'Пока никто не сдал это задание.', 'Bu topshiriqni hali hech bir o‘quvchi topshirmagan.')}
              </div>
            ) : (
              <div className="stack">
                {submissions.map((submission) => {
                  const draft = reviewDrafts[submission.studentId];
                  if (!draft) return null;
                  return (
                    <article className="school-review-card" key={submission.studentId}>
                      <div className="row-between">
                        <b>{submission.studentName}</b>
                        <span className="tag">{formatStatus(submission.status)}</span>
                      </div>
                      <SubmissionPhotos
                        assignmentId={reviewAssignment.id}
                        studentId={submission.studentId}
                        count={submission.attachmentCount ?? 0}
                        language={language}
                        refreshKey={submission.updatedAt}
                      />
                      <p className="muted school-assignment-copy">
                        <b>{t(language, 'In their words', 'Своими словами', 'O‘z so‘zlari bilan')}:</b> {submission.content}
                      </p>
                      <HomeworkAiCheck assignmentId={reviewAssignment.id} studentId={submission.studentId} language={language} />
                      <ReviewVerdict
                        draft={draft}
                        language={language}
                        onChange={(patch) => updateDraft(submission.studentId, patch)}
                      />
                      <div className="control" style={{ marginTop: 8 }}>
                        <label htmlFor={`review-feedback-${submission.studentId}`}>{t(language, 'Feedback', 'Комментарий', 'Izoh')}</label>
                        <textarea
                          id={`review-feedback-${submission.studentId}`}
                          value={draft.feedback}
                          onChange={(event) => updateDraft(submission.studentId, { feedback: event.target.value })}
                          maxLength={4000}
                        />
                      </div>
                      <div className="control" style={{ marginTop: 8 }}>
                        <label>{t(language, 'Teacher signature', 'Подпись учителя', 'O‘qituvchi imzosi')}</label>
                        {submission.signature && !draft.signature && (
                          <SignatureStamp
                            signature={submission.signature}
                            signedBy={submission.signedBy}
                            signedAt={submission.signedAt}
                            language={language}
                          />
                        )}
                        <SignaturePad
                          language={language}
                          onChange={(dataUrl) => updateDraft(submission.studentId, { signature: dataUrl })}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn primary small"
                        style={{ marginTop: 8 }}
                        disabled={reviewBusyId === submission.studentId || draft.score.trim() === ''}
                        onClick={() => void saveReview(submission.studentId)}
                      >
                        <CheckCircle2 size={13} />
                        {reviewBusyId === submission.studentId ? t(language, 'Saving…', 'Сохраняем…', 'Saqlanmoqda…') : t(language, 'Save review', 'Сохранить проверку', 'Tekshiruvni saqlash')}
                      </button>
                      {savedIds.includes(submission.studentId) && reviewBusyId !== submission.studentId && <span className="review-saved"><CheckCircle2 size={14} /> {t(language, 'Saved. The pupil sees the mark.', 'Сохранено. Ученик видит оценку.', 'Saqlandi. O‘quvchi bahoni ko‘radi.')}</span>}
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            <div className="callout">
              {t(
                language,
                'Select “Review” on an assignment to load its submissions.',
                'Нажмите «Проверить» у задания, чтобы загрузить работы.',
                'Topshiriq javoblarini yuklash uchun “Tekshirish” tugmasini bosing.',
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel style={{ marginTop: 16 }}>
        <SectionHead
          title={t(language, 'Work to check', 'Работы на проверку', 'Tekshiriladigan ishlar')}
          detail={t(language, 'Only the tasks where pupils handed in work and it is not checked yet.', 'Только задания, где ученики сдали работу и она ещё не проверена.', 'Faqat o‘quvchilar ish topshirgan va hali tekshirilmagan vazifalar.')}
        />
        {(() => {
          const pending = school.assignments
            .map((item) => ({ item, waiting: Math.max(0, (item.submissionCount ?? 0) - (item.reviewCount ?? 0)), className: school.classes.find((klass) => klass.id === item.classId)?.name ?? '' }))
            .filter((row) => row.waiting > 0);
          if (!pending.length) return <div className="callout">{t(language, 'Nothing to check. New work appears here by itself.', 'Проверять нечего. Новые работы появятся здесь сами.', 'Tekshiradigan ish yo‘q. Yangi ishlar shu yerda o‘zi chiqadi.')}</div>;
          return (
            <ul className="check-list">
              {pending.map(({ item, waiting, className }) => (
                <li key={item.id} className={reviewAssignmentId === item.id ? 'on' : ''}>
                  <div><b>{item.title}</b><small className="muted">{className} · {item.subject}</small></div>
                  <span className="tag gold">{t(language, `${waiting} waiting`, `ждут: ${waiting}`, `${waiting} ta kutmoqda`)}</span>
                  <button type="button" className="btn small primary" onClick={() => { setSelectedClassId(item.classId); setReviewAssignmentId(item.id); window.setTimeout(() => document.getElementById('review-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>
                    <ClipboardCheck size={13} /> {t(language, 'Check', 'Проверить', 'Tekshirish')}
                  </button>
                </li>
              ))}
            </ul>
          );
        })()}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* School overview                                                             */
/* -------------------------------------------------------------------------- */

export function ServerSchoolOverview({
  school,
  user,
  language,
}: {
  school: SchoolData;
  user: User;
  language: Language;
}) {
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [detail, setDetail] = useState<SchoolRecord | null>(null);
  const [members, setMembers] = useState<SchoolMember[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [resetCard, setResetCard] = useState<{ name: string; login: string; password: string } | null>(null);
  const [resetError, setResetError] = useState('');
  async function resetPassword(member: SchoolMember) {
    if (!activeSchoolId) return;
    if (!window.confirm(t(language, `Give ${member.username} a new one-time password? The old one stops working.`, `Выдать новый одноразовый пароль: ${member.username}? Старый перестанет работать.`, `${member.username} uchun yangi bir martalik parol berilsinmi? Eskisi ishlamaydi.`))) return;
    setResetError('');
    try {
      const result = await customFetch<{ name: string; login: string; password: string }>(`/api/schools/${activeSchoolId}/members/${member.userId}/reset-password`, { method: 'POST' });
      setResetCard(result);
    } catch (requestError) {
      setResetCard(null);
      setResetError(friendlyError(requestError, language));
    }
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [classForm, setClassForm] = useState({ name: '', grade: '7', academicYear: '2025–26' });
  const [creatingClass, setCreatingClass] = useState(false);

  const activeSchoolId =
    school.memberships.find((item) => item.schoolId === selectedSchoolId)?.schoolId ??
    school.memberships[0]?.schoolId ??
    '';
  const activeMembership = school.memberships.find((item) => item.schoolId === activeSchoolId);
  const schoolClasses = school.classes.filter((item) => item.schoolId === activeSchoolId);
  const schoolAssignments = school.assignments.filter((item) => item.schoolId === activeSchoolId);
  const canManage =
    isManagerRole(user.role) ||
    activeMembership?.role === 'school_director' ||
    activeMembership?.role === 'school_admin';

  useEffect(() => {
    if (!activeSchoolId) {
      setDetail(null);
      setMembers([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([
      getSchool(activeSchoolId),
      listSchoolMembers(activeSchoolId).catch(() => ({ members: [] as SchoolMember[] })),
    ])
      .then(([schoolResponse, memberResponse]) => {
        if (cancelled) return;
        setDetail(schoolResponse.school);
        setMembers(memberResponse.members);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(friendlyError(requestError, language));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSchoolId, revision]);

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSchoolId || !classForm.name.trim()) return;
    setCreatingClass(true);
    setError('');
    setNotice('');
    try {
      const payload: CreateClassRequest = {
        name: classForm.name.trim(),
        grade: Number(classForm.grade),
        academicYear: classForm.academicYear.trim(),
      };
      await createClass(activeSchoolId, payload);
      setClassForm({ ...classForm, name: '' });
      setNotice(t(language, 'Class created.', 'Класс создан.', 'Sinf yaratildi.'));
      await school.refresh();
      setRevision((value) => value + 1);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setCreatingClass(false);
    }
  }

  return (
    <>
      <div className="row-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {school.memberships.map((membership) => (
            <button
              type="button"
              key={membership.schoolId}
              className={`btn small ${membership.schoolId === activeSchoolId ? 'subtle' : ''}`}
              onClick={() => setSelectedSchoolId(membership.schoolId)}
            >
              {membership.schoolName}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="tag green">{t(language, 'School data', 'Данные школы', 'Maktab ma’lumotlari')}</span>
          <RefreshButton onClick={() => setRevision((value) => value + 1)} busy={loading} language={language} />
        </div>
      </div>

      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Panel>
          <SectionHead
            title={detail?.name ?? activeMembership?.schoolName ?? t(language, 'School', 'Школа', 'Maktab')}
            detail={
              detail
                ? [detail.region, detail.district, detail.address].filter(Boolean).join(' · ')
                : activeMembership
                  ? [activeMembership.region, activeMembership.district].filter(Boolean).join(' · ')
                  : undefined
            }
            tag={<span className="tag blue">{t(language, 'Record', 'Запись', 'Yozuv')}</span>}
          />
          {loading ? (
            <p className="muted" role="status">{t(language, 'Loading school record…', 'Загружаем школу…', 'Maktab yozuvi yuklanmoqda…')}</p>
          ) : (
            <>
              <h3>{t(language, 'Roster', 'Список', 'Ro‘yxat')}</h3>
              {members.length === 0 ? (
                <div className="callout">
                  {canManage
                    ? t(language, 'No members yet. The director or deputy adds them from an Excel list.', 'Участников пока нет. Директор или завуч добавляет их из списка Excel.', 'Hali a’zo yo‘q. Direktor yoki zavuch Excel ro‘yxatidan qo‘shadi.')
                    : t(language, 'The roster is only shown to school managers.', 'Список видят только руководители школы.', 'Ro‘yxat faqat maktab rahbarlariga ko‘rinadi.')}
                </div>
              ) : (
                <>
                  {canManage && (
                    <input className="input" style={{ marginBottom: 8 }} value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder={t(language, 'Find a person (name or login)', 'Найти человека (ФИО или логин)', 'Odamni topish (F.I.Sh. yoki login)')} />
                  )}
                  {resetError && <InlineError>{resetError}</InlineError>}
                  {resetCard && (
                    <div className="notice school-inline-success reset-card" role="status">
                      <KeyRound size={15} />
                      <span>{resetCard.name} · {t(language, 'login', 'логин', 'login')}: <b>{resetCard.login}</b> · {t(language, 'new password', 'новый пароль', 'yangi parol')}: <b>{resetCard.password}</b><br /><small>{t(language, 'Shown once. They set their own password at the next sign-in.', 'Показывается один раз. При входе человек поставит свой пароль.', 'Bir marta ko‘rsatiladi. Keyingi kirishda o‘z parolini qo‘yadi.')}</small></span>
                      <button type="button" className="btn small" onClick={() => setResetCard(null)}>{t(language, 'Done', 'Готово', 'Tayyor')}</button>
                    </div>
                  )}
                  <div className="school-member-list">
                    {members
                      .filter((member) => !memberQuery.trim() || `${member.username} ${member.login ?? ''}`.toLowerCase().includes(memberQuery.trim().toLowerCase()))
                      .map((member) => (
                        <div className="school-member-row" key={member.userId}>
                          <span><b>{member.username}</b> <small className="muted">{formatStatus(member.role)}{member.login ? ` · ${member.login}` : ''}</small></span>
                          {canManage && member.role !== 'school_director' && (
                            <button type="button" className="btn small" onClick={() => void resetPassword(member)}>
                              <KeyRound size={13} /> {t(language, 'New password', 'Новый пароль', 'Yangi parol')}
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>

        <Panel>
          <SectionHead
            title={t(language, 'Classes in this school', 'Классы школы', 'Bu maktabdagi sinflar')}
            detail={t(language, 'Counts come from class membership records.', 'Данные берутся из состава классов.', 'Ma’lumotlar sinf a’zolaridan olinadi.')}
            tag={<span className="tag">{schoolClasses.length}</span>}
          />
          {schoolClasses.length === 0 ? (
            <div className="callout">
              {t(language, 'No classes have been created for this school yet.', 'В этой школе пока нет классов.', 'Bu maktabda hali sinflar yaratilmagan.')}
            </div>
          ) : (
            <div className="stack">
              {schoolClasses.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <div className="list-title">{item.name}</div>
                    <div className="list-meta">
                      {item.grade} {t(language, 'grade', 'класс', 'sinf')} · {item.academicYear}
                    </div>
                  </div>
                  <span className="tag blue">
                    {item.studentCount ?? 0} {t(language, 'students', 'учеников', 'o‘quvchi')}
                  </span>
                </div>
              ))}
            </div>
          )}
          {canManage && (
            <form className="stack" style={{ marginTop: 14 }} onSubmit={handleCreateClass}>
              <h3>{t(language, 'Create a class', 'Создать класс', 'Sinf yaratish')}</h3>
              <div className="grid grid-3" style={{ gap: 8 }}>
                <div className="control">
                  <label htmlFor="new-class-name">{t(language, 'Name', 'Название', 'Nomi')}</label>
                  <input
                    id="new-class-name"
                    value={classForm.name}
                    onChange={(event) => setClassForm({ ...classForm, name: event.target.value })}
                    placeholder="7-B"
                    maxLength={80}
                  />
                </div>
                <div className="control">
                  <label htmlFor="new-class-grade">{t(language, 'Grade', 'Класс', 'Sinf')}</label>
                  <input
                    id="new-class-grade"
                    type="number"
                    min={1}
                    max={11}
                    value={classForm.grade}
                    onChange={(event) => setClassForm({ ...classForm, grade: event.target.value })}
                  />
                </div>
                <div className="control">
                  <label htmlFor="new-class-year">{t(language, 'Year', 'Год', 'Yil')}</label>
                  <input
                    id="new-class-year"
                    value={classForm.academicYear}
                    onChange={(event) => setClassForm({ ...classForm, academicYear: event.target.value })}
                    maxLength={20}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn primary"
                disabled={creatingClass || !classForm.name.trim() || !classForm.academicYear.trim()}
              >
                <Plus size={14} />
                {creatingClass
                  ? t(language, 'Creating…', 'Создаём…', 'Yaratilmoqda…')
                  : t(language, 'Create class', 'Создать класс', 'Sinf yaratish')}
              </button>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Administration                                                              */
/* -------------------------------------------------------------------------- */

export function ServerAdminSchoolsPanel({ language, onSelect, onCreated, selectedId, part = 'all' }: { language: Language; onSelect?: (school: { id: string; name: string }) => void; onCreated?: (school: { id: string; name: string }) => void; selectedId?: string; part?: 'all' | 'list' | 'create' }) {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', region: '', district: '', address: '', fee: '' });
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listSchools()
      .then((response) => {
        if (!cancelled) setSchools(response.schools);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(friendlyError(requestError, language));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.region.trim()) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const payload: CreateSchoolRequest = {
        name: form.name.trim(),
        region: form.region.trim(),
        district: form.district.trim() || undefined,
        address: form.address.trim() || undefined,
      };
      const response = await createSchool(payload);
      const fee = Number(form.fee || 0);
      if (fee > 0 && response?.school?.id) {
        const month = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
        await customFetch(`/api/admin/schools/${response.school.id}/billing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyFee: fee, billingStart: month }) }).catch(() => undefined);
      }
      if (onCreated && response?.school?.id) {
        onCreated({ id: response.school.id, name: response.school.name });
        return;
      }
      setForm({ name: '', region: form.region, district: '', address: '', fee: '' });
      setNotice(t(language, 'School created.', 'Школа создана.', 'Maktab yaratildi.'));
      setRevision((value) => value + 1);
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel className="school-admin-panel">
      <SectionHead
        title={part === 'create' ? t(language, 'Create a school', 'Создать школу', 'Maktab yaratish') : t(language, 'Schools', 'Школы', 'Maktablar')}
        detail={part === 'create'
          ? t(language, 'Then add the director and deputy.', 'Потом добавите директора и завуча.', 'Keyin direktor va zavuchni qo‘shasiz.')
          : t(language, 'Press “Set up” to open a school.', 'Нажмите «Настроить», чтобы открыть школу.', 'Maktabni ochish uchun «Sozlash» ni bosing.')}
        tag={part === 'create' ? undefined :
          <div className="row">
            <span className="tag green">{schools.length}</span>
            <RefreshButton onClick={() => setRevision((value) => value + 1)} busy={loading} language={language} />
          </div>
        }
      />
      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}
      {part !== 'create' && (loading ? (
        <LoadingBlock language={language} kind="inline" />
      ) : schools.length === 0 ? (
        <div className="callout">
          {t(language, 'No schools yet.', 'Школ пока нет.', 'Hali maktablar yo‘q.')}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t(language, 'School', 'Школа', 'Maktab')}</th>
                <th>{t(language, 'Region', 'Регион', 'Hudud')}</th>
                <th>{t(language, 'District', 'Район', 'Tuman')}</th>
                <th>{t(language, 'Members', 'Участники', 'A’zolar')}</th>
                <th>{t(language, 'Classes', 'Классы', 'Sinflar')}</th>
                {onSelect && <th />}
              </tr>
            </thead>
            <tbody>
              {schools.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.name}</b></td>
                  <td>{item.region}</td>
                  <td>{item.district || '—'}</td>
                  <td>{item.memberCount ?? 0}</td>
                  <td>{item.classCount ?? 0}</td>
                  {onSelect && <td><button type="button" className={`btn small ${selectedId === item.id ? 'primary' : ''}`} onClick={() => onSelect({ id: item.id, name: item.name })}>{t(language, 'Set up', 'Настроить', 'Sozlash')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {part !== 'list' && <form className="stack school-admin-create" onSubmit={handleCreate}>
        {part !== 'create' && <h3>{t(language, 'Create a school record', 'Создать школу', 'Maktab yozuvini yaratish')}</h3>}
        <div className="grid grid-2" style={{ gap: 8 }}>
          <div className="control">
            <label htmlFor="new-school-name">{t(language, 'School name', 'Название школы', 'Maktab nomi')}</label>
            <input
              id="new-school-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              maxLength={160}
            />
          </div>
          <div className="control">
            <label htmlFor="new-school-region">{t(language, 'Region', 'Регион', 'Hudud')}</label>
            <input
              id="new-school-region"
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
              maxLength={120}
            />
          </div>
        </div>
        <div className="control">
          <label htmlFor="new-school-fee">{t(language, 'Sum per month (cash)', 'Сумма в месяц (наличными)', 'Oyiga summa (naqd)')}</label>
          <input id="new-school-fee" inputMode="numeric" value={form.fee} onChange={(event) => setForm({ ...form, fee: event.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="1500000" />
        </div>
        <details className="admin-more-fields">
          <summary>{t(language, 'More', 'Ещё', 'Yana')}</summary>
          <div className="grid grid-2" style={{ gap: 8, marginTop: 8 }}>
          <div className="control">
            <label htmlFor="new-school-district">{t(language, 'District (optional)', 'Район (необязательно)', 'Tuman (ixtiyoriy)')}</label>
            <input
              id="new-school-district"
              value={form.district}
              onChange={(event) => setForm({ ...form, district: event.target.value })}
              maxLength={120}
            />
          </div>
          <div className="control">
            <label htmlFor="new-school-address">{t(language, 'Address (optional)', 'Адрес (необязательно)', 'Manzil (ixtiyoriy)')}</label>
            <input
              id="new-school-address"
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              maxLength={240}
            />
          </div>
          </div>
        </details>
        <button type="submit" className="btn primary" disabled={creating || !form.name.trim() || !form.region.trim()}>
          <Plus size={14} />
          {creating
            ? t(language, 'Creating…', 'Создаём…', 'Yaratilmoqda…')
            : t(language, 'Create school', 'Создать школу', 'Maktab yaratish')}
        </button>
      </form>}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Director: create student accounts                                          */
/* -------------------------------------------------------------------------- */

export function ServerAccountsPanel({
  school,
  language,
  defaultClassId,
}: {
  school: SchoolData;
  language: Language;
  defaultClassId?: string;
}) {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ClassAccount[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const activeClassId = selectedClassId || defaultClassId || school.classes[0]?.id || '';
  const activeClass = school.classes.find((item) => item.id === activeClassId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const list = names
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!activeClassId || list.length === 0) return;
    setBusy(true);
    setError('');
    setCreated([]);
    try {
      const response = await createClassAccounts(activeClassId, { names: list });
      setCreated(response.created);
      setNames('');
      await school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const credentials = created.map((row) => `${row.username}\t${row.login}\t${row.password}`).join('\n');

  return (
    <Panel className="director-accounts-panel">
      <SectionHead
        title={t(language, 'Create student accounts', 'Создать аккаунты учеников', 'O‘quvchi hisoblarini yaratish')}
        detail={
          activeClass
            ? `${activeClass.name} · ${activeClass.academicYear}`
            : t(language, 'Choose a class', 'Выберите класс', 'Sinfni tanlang')
        }
        tag={
          <Select
            className="top-select"
            aria-label={t(language, 'Class', 'Класс', 'Sinf')}
            value={activeClassId}
            onChange={(event) => setSelectedClassId(event.target.value)}
          >
            {school.classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.academicYear}
              </option>
            ))}
          </Select>
        }
      />
      <form className="stack" onSubmit={submit}>
        <div className="control">
          <label htmlFor="student-names">
            {t(
              language,
              'Student names — one per line',
              'Имена учеников — по одному на строку',
              'O‘quvchilar ismlari — har bir qatorda bittadan',
            )}
          </label>
          <textarea
            id="student-names"
            rows={5}
            value={names}
            onChange={(event) => setNames(event.target.value)}
            placeholder={'Aziza Karimova\nBekzod Yusupov\nDilnoza Ismoilova'}
          />
        </div>
        {error && <InlineError>{error}</InlineError>}
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !names.trim() || !activeClassId}
        >
          {busy ? <RefreshCw className="school-spin" size={15} /> : <Plus size={15} />}
          {t(language, 'Create accounts', 'Создать аккаунты', 'Hisoblar yaratish')}
        </button>
      </form>

      {created.length > 0 && (
        <div className="account-results">
          <div className="section-head">
            <div>
              <h2>
                <GraduationCap size={17} />{' '}
                {t(
                  language,
                  `Created ${created.length} account(s)`,
                  `Создано ${created.length} аккаунтов`,
                  `${created.length} ta hisob yaratildi`,
                )}
              </h2>
              <p className="muted">
                {t(
                  language,
                  'Passwords are shown only here. Copy and hand them to students.',
                  'Пароли показаны только здесь. Скопируйте и раздайте ученикам.',
                  'Parollar faqat shu yerda ko‘rsatiladi. Ularni nusxalab o‘quvchilarga bering.',
                )}
              </p>
            </div>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(credentials);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
              {copied ? t(language, 'Copied', 'Скопировано', 'Nusxalandi') : t(language, 'Copy all', 'Копировать все', 'Hammasini nusxalash')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t(language, 'Name', 'Имя', 'Ism')}</th>
                  <th>{t(language, 'Login', 'Логин', 'Login')}</th>
                  <th>{t(language, 'Temporary password', 'Временный пароль', 'Vaqtinchalik parol')}</th>
                </tr>
              </thead>
              <tbody>
                {created.map((row) => (
                  <tr key={row.login}>
                    <td>{row.username}</td>
                    <td><code>{row.login}</code></td>
                    <td><code>{row.password}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Director: assign topics to a class                                        */
/* -------------------------------------------------------------------------- */

export function ServerTopicAssignPanel({
  school,
  language,
  defaultClassId,
}: {
  school: SchoolData;
  language: Language;
  defaultClassId?: string;
}) {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [topics, setTopics] = useState<LessonTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const activeClassId = selectedClassId || defaultClassId || school.classes[0]?.id || '';
  const activeClass = school.classes.find((item) => item.id === activeClassId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTopics()
      .then((response) => {
        if (!cancelled) setTopics(response.topics);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function assign(topicId: string) {
    if (!activeClassId) return;
    setAssigningId(topicId);
    setError('');
    setNotice('');
    try {
      await assignTopicToClass(topicId, { classId: activeClassId });
      setTopics((current) =>
        current.map((topic) => (topic.id === topicId ? { ...topic, classId: activeClassId } : topic)),
      );
      setNotice(
        t(
          language,
          'Topic assigned to the class. Students see it in “Topics & 3D”.',
          'Тема назначена классу. Ученики видят её в «Темы и 3D».',
          'Mavzu sinfga biriktirildi. O‘quvchilar uni «Mavzular va 3D»da ko‘radi.',
        ),
      );
      await school.refresh();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setAssigningId('');
    }
  }

  return (
    <Panel className="director-topic-assign">
      <SectionHead
        title={t(language, 'Assign topics to a class', 'Назначить темы классу', 'Mavzularni sinfga biriktirish')}
        detail={
          activeClass
            ? `${activeClass.name} · ${activeClass.academicYear}`
            : t(language, 'Choose a class', 'Выберите класс', 'Sinfni tanlang')
        }
        tag={
          <Select
            className="top-select"
            aria-label={t(language, 'Class', 'Класс', 'Sinf')}
            value={activeClassId}
            onChange={(event) => setSelectedClassId(event.target.value)}
          >
            {school.classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.academicYear}
              </option>
            ))}
          </Select>
        }
      />
      {error && <InlineError>{error}</InlineError>}
      {notice && (
        <div className="notice school-inline-success" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}
      {loading ? (
        <p className="muted" role="status">{t(language, 'Loading topics…', 'Загружаем темы…', 'Mavzular yuklanmoqda…')}</p>
      ) : topics.length === 0 ? (
        <div className="callout">
          {t(
            language,
            'No published topics yet. Create one in “Topics & 3D”.',
            'Опубликованных тем пока нет. Создайте тему в «Темы и 3D».',
            'Hozircha e’lon qilingan mavzu yo‘q. «Mavzular va 3D»da yarating.',
          )}
        </div>
      ) : (
        <div className="grid grid-2 topic-assign-grid">
          {topics.map((topic) => {
            const assignedToThis = topic.classId === activeClassId;
            return (
              <article className={`topic-assign-card ${assignedToThis ? 'assigned' : ''}`} key={topic.id}>
                <span className="tag blue">{topic.subject}</span>
                <strong>{topic.title}</strong>
                <small className="muted">
                  {topic.slides.reduce((sum, slide) => sum + (slide.durationMinutes || 0), 0)}{' '}
                  {t(language, 'min lesson', 'минут урока', 'daqiqa dars')}
                </small>
                <button
                  type="button"
                  className={`btn small ${assignedToThis ? 'subtle' : 'primary'}`}
                  disabled={!activeClassId || assigningId === topic.id}
                  onClick={() => void assign(topic.id)}
                >
                  {assigningId === topic.id ? (
                    <RefreshCw size={13} className="school-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {assignedToThis
                    ? t(language, 'Assigned to this class', 'Назначено этому классу', 'Bu sinfga biriktirilgan')
                    : t(language, 'Assign to class', 'Назначить классу', 'Sinfga biriktirish')}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <a className="btn primary" href="/topics">
          <Sparkles size={15} />
          {t(language, 'Create your own topic', 'Создать свою тему', 'O‘z mavzuingizni yaratish')}
        </a>
      </div>
    </Panel>
  );
}


/**
 * Checking one homework: «Checked» → how it was done (all right / partly, with mistakes / wrong)
 * → the mark 2…10. The verdict only suggests a mark: the teacher can set any mark afterwards
 * (for effort or behaviour), and the chosen verdict stays as it is. There is no mark below 2.
 */
const VERDICTS: Array<{ id: 'right' | 'partly' | 'wrong'; mark: number; status: string; label: [string, string, string]; note: [string, string, string]; tone: string }> = [
  { id: 'right', mark: 10, status: 'checked', label: ['All correct', 'Всё правильно', 'Hammasi to‘g‘ri'], note: ['Well done, everything is correct.', 'Молодец, всё сделано правильно.', 'Barakalla, hammasi to‘g‘ri.'], tone: 'green' },
  { id: 'partly', mark: 7, status: 'checked', label: ['Partly, some mistakes', 'Частично, есть ошибки', 'Qisman, xatolar bor'], note: ['Good, but there are mistakes. Look at them again.', 'Хорошо, но есть ошибки. Посмотри их ещё раз.', 'Yaxshi, lekin xatolar bor. Ularni qayta ko‘rib chiq.'], tone: 'gold' },
  { id: 'wrong', mark: 3, status: 'needs_revision', label: ['Wrong', 'Неправильно', 'Noto‘g‘ri'], note: ['Wrong. Read the topic again and redo the task.', 'Неправильно. Перечитай тему и переделай задание.', 'Noto‘g‘ri. Mavzuni qayta o‘qib, vazifani qayta bajar.'], tone: 'red' },
];
function ReviewVerdict({ draft, language, onChange }: { draft: ReviewDraft; language: Language; onChange: (patch: Partial<ReviewDraft>) => void }) {
  const mark = draft.score.trim() === '' ? null : markOf(Number(draft.score));
  const [opened, setOpened] = useState(mark !== null);
  const [verdict, setVerdict] = useState<'right' | 'partly' | 'wrong' | null>(
    mark === null ? null : draft.status === 'needs_revision' ? 'wrong' : mark >= 9 ? 'right' : 'partly',
  );
  if (!opened) {
    return (
      <button type="button" className="btn primary review-checked-btn" onClick={() => setOpened(true)}>
        <CheckCircle2 size={16} /> {t(language, 'Checked', 'Проверил', 'Tekshirdim')}
      </button>
    );
  }
  const status = VERDICTS.find((item) => item.id === verdict)?.status ?? 'checked';
  return (
    <div className="review-verdict">
      <span className="muted">{t(language, 'How is it done?', 'Как сделано?', 'Qanday bajarilgan?')}</span>
      <div className="review-verdict-options">
        {VERDICTS.map((item) => (
          <button type="button" key={item.id} className={`review-verdict-btn tone-${item.tone} ${verdict === item.id ? 'on' : ''}`}
            onClick={() => {
              setVerdict(item.id);
              onChange({ status: item.status, score: String(scoreOf(item.mark)), feedback: draft.feedback.trim() && !VERDICTS.some((v) => draft.feedback === t(language, ...v.note)) ? draft.feedback : t(language, ...item.note) });
            }}>
            {t(language, ...item.label)}
          </button>
        ))}
      </div>
      <span className="muted">{t(language, 'Mark (out of 10) — change it if you like, e.g. for effort or behaviour', 'Оценка из 10 — можно поменять, например за старание или поведение', 'Baho (10 dan) — o‘zgartirsa bo‘ladi, masalan, harakat yoki xulq uchun')}</span>
      <div className="review-marks" role="group">
        {MARKS.map((value) => (
          <button type="button" key={value} className={`grade-pick ${markBand(value)} ${mark === value ? 'on' : ''}`}
            onClick={() => onChange({ score: String(scoreOf(value)), status })}>{value}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * One pupil's homework opened from the journal: notebook photos and their words first,
 * then «Checked» → verdict → mark 2…10. The teacher cannot grade without seeing the work.
 */
export function SubmissionReviewDialog({ assignmentId, assignmentTitle, studentId, studentName, language, onClose, onSaved }: {
  assignmentId: string; assignmentTitle: string; studentId: string; studentName: string; language: Language; onClose: () => void; onSaved: () => void;
}) {
  const [submission, setSubmission] = useState<SubmissionWithStudent | null | undefined>(undefined);
  const [draft, setDraft] = useState<ReviewDraft>({ status: 'checked', score: '', feedback: '', signature: null });
  const [verdictKey, setVerdictKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    listSubmissions(assignmentId)
      .then((response) => {
        if (!alive) return;
        const found = response.submissions.find((item) => item.studentId === studentId) ?? null;
        setSubmission(found);
        if (found) setDraft({ status: found.status, score: found.score === null || found.score === undefined ? '' : String(found.score), feedback: found.feedback, signature: null });
      })
      .catch((requestError: unknown) => { if (alive) { setSubmission(null); setError(friendlyError(requestError, language)); } });
    return () => { alive = false; };
  }, [assignmentId, studentId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  async function save() {
    if (draft.score.trim() === '') return;
    setBusy(true); setError('');
    try {
      await reviewSubmission(assignmentId, studentId, { status: draft.status as ReviewSubmissionRequest['status'], score: Number(draft.score), feedback: draft.feedback });
      onSaved();
      onClose();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal review-dialog" role="dialog" aria-modal="true" aria-label={studentName}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div><b>{studentName}</b><div className="muted">{assignmentTitle}</div></div>
          <button type="button" className="btn small" onClick={onClose} aria-label={t(language, 'Close', 'Закрыть', 'Yopish')}>×</button>
        </div>
        {submission === undefined && <LoadingBlock language={language} kind="inline" />}
        {submission === null && !error && <div className="callout">{t(language, 'The pupil has not handed in this work.', 'Ученик ещё не сдал эту работу.', 'O‘quvchi bu ishni hali topshirmagan.')}</div>}
        {submission && (
          <>
            {(submission.attachmentCount ?? 0) > 0
              ? <SubmissionPhotos assignmentId={assignmentId} studentId={studentId} count={submission.attachmentCount ?? 0} language={language} refreshKey={submission.updatedAt} />
              : <p className="muted">{t(language, 'No photos attached.', 'Фото не прикреплено.', 'Rasm biriktirilmagan.')}</p>}
            {(submission.attachmentCount ?? 0) > 0 && <HomeworkAiCheck key={`honest-${studentId}`} assignmentId={assignmentId} studentId={studentId} language={language} />}
            {(submission.attachmentCount ?? 0) > 0 && <HomeworkHelpCheck assignmentId={assignmentId} studentId={studentId} language={language} onUseMark={(mark, feedback) => { setDraft((current) => ({ ...current, status: mark >= 5 ? 'checked' : 'needs_revision', score: String(scoreOf(mark)), feedback: current.feedback.trim() ? current.feedback : feedback })); setVerdictKey((value) => value + 1); }} />}
            {submission.content && <p className="school-assignment-copy"><b>{t(language, 'In their words', 'Своими словами', 'O‘z so‘zlari bilan')}:</b> {submission.content}</p>}
            <ReviewVerdict key={verdictKey} draft={draft} language={language} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
            <div className="control">
              <label htmlFor="dialog-feedback">{t(language, 'Comment', 'Комментарий', 'Izoh')}</label>
              <textarea id="dialog-feedback" value={draft.feedback} maxLength={4000} onChange={(event) => setDraft((current) => ({ ...current, feedback: event.target.value }))} />
            </div>
            <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={busy || draft.score.trim() === ''} onClick={() => void save()}>
              <CheckCircle2 size={15} /> {t(language, 'Save', 'Сохранить', 'Saqlash')}
            </button>
          </>
        )}
        {error && <InlineError>{error}</InlineError>}
      </section>
    </div>
  );
}


type HomeworkReview = { summary: string; mistakes: Array<{ where: string; why: string; fix: string }>; good: string[]; advice: string; suggestedMark: number | null; realPhoto: 'yes' | 'no' | 'unsure' };

/**
 * Help with checking: the helper reads the notebook photos against the task and lists the
 * mistakes (where, why, how to fix), what is good and a suggested mark. The teacher decides.
 */
function HomeworkHelpCheck({ assignmentId, studentId, language, onUseMark }: { assignmentId: string; studentId: string; language: Language; onUseMark: (mark: number, feedback: string) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'off' | 'error'>('idle');
  const [review, setReview] = useState<HomeworkReview | null>(null);
  const [error, setError] = useState('');
  async function run() {
    setState('busy'); setError('');
    try {
      const lang = language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru';
      const response = await customFetch<{ review: HomeworkReview }>(`/api/assignments/${assignmentId}/submissions/${studentId}/ai-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
      setReview(response.review); setState('done');
    } catch (requestError) {
      const body = (requestError as { data?: { error?: string } })?.data;
      if (body?.error === 'not-configured') { setState('off'); return; }
      setError(friendlyError(requestError, language)); setState('error');
    }
  }
  const feedbackText = (item: HomeworkReview) => [item.summary, ...item.mistakes.map((m) => `• ${m.where ? `${m.where}: ` : ''}${m.why}${m.fix ? ` → ${m.fix}` : ''}`), item.advice].filter(Boolean).join('\n');
  return (
    <div className="photo-ai-check">
      {(state === 'idle' || state === 'busy' || state === 'error') && (
        <button type="button" className="btn" disabled={state === 'busy'} onClick={() => void run()}>
          {state === 'busy' ? <LoadingBlock language={language} kind="inline" label={t(language, 'Reading the notebook…', 'Читаем тетрадь…', 'Daftar o‘qilmoqda…')} /> : <>🔍 {t(language, 'Help me check: mistakes and advice', 'Помочь проверить: ошибки и советы', 'Tekshirishga yordam: xatolar va maslahat')}</>}
        </button>
      )}
      {state === 'off' && <p className="muted">{t(language, 'Check help is not connected for this school yet. Check the photos yourself.', 'Помощь в проверке для школы ещё не подключена. Проверьте фото сами.', 'Tekshirish yordamchisi hali ulanmagan. Rasmlarni o‘zingiz tekshiring.')}</p>}
      {state === 'done' && review && (
        <div className="photo-ai-result is-review">
          {review.summary && <b>{review.summary}</b>}
          {review.mistakes.length > 0 && (
            <ul className="hw-review-mistakes">
              {review.mistakes.map((item, index) => <li key={index}><b>{item.where || `${index + 1}`}</b> — {item.why}{item.fix && <><br /><span className="muted">✎ {item.fix}</span></>}</li>)}
            </ul>
          )}
          {review.good.length > 0 && <p>✅ {review.good.join(' · ')}</p>}
          {review.advice && <p>💬 {review.advice}</p>}
          {review.realPhoto === 'no' && <p className="notice">⚠️ {t(language, 'This may not be a real notebook photo (screenshot or generated picture).', 'Возможно, это не настоящее фото тетради (скриншот или созданная картинка).', 'Bu haqiqiy daftar rasmi bo‘lmasligi mumkin (skrinshot yoki yasalgan rasm).')}</p>}
          {review.suggestedMark !== null && (
            <button type="button" className="btn small primary" onClick={() => onUseMark(review.suggestedMark!, feedbackText(review))}>
              {t(language, `Use the suggested mark: ${review.suggestedMark}`, `Взять предложенную оценку: ${review.suggestedMark}`, `Taklif qilingan baho: ${review.suggestedMark}`)}
            </button>
          )}
          <small className="muted">{t(language, 'Only a hint. The final mark is yours.', 'Это только подсказка. Итоговую оценку ставите вы.', 'Bu faqat maslahat. Yakuniy bahoni siz qo‘yasiz.')}</small>
        </div>
      )}
      {error && <span className="notice">{error}</span>}
    </div>
  );
}

