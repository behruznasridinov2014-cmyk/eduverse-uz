import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
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
import { PhotoPicker, SignaturePad, SignatureStamp, SubmissionPhotos } from './homework';

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

export function SchoolScopeSummary({ school, language }: { school: SchoolData; language: Language }) {
  const statusLabel =
    school.status === 'loading'
      ? t(language, 'Loading server records…', 'Загружаем данные сервера…', 'Server ma’lumotlari yuklanmoqda…')
      : school.status === 'ready'
        ? t(language, 'Server school data connected', 'Данные школы подключены', 'Maktab server ma’lumotlari ulandi')
        : school.status === 'unavailable'
          ? t(language, 'Server school data unavailable', 'Данные школы недоступны', 'Maktab server ma’lumotlari mavjud emas')
          : t(language, 'Waiting for account session', 'Ожидаем сессию аккаунта', 'Hisob sessiyasi kutilmoqda');

  return (
    <Panel className="school-scope-summary">
      <SectionHead
        title={t(language, 'School account scope', 'Учебный профиль', 'Maktab hisobi doirasi')}
        detail={statusLabel}
        tag={
          <span className={`tag ${school.status === 'ready' ? 'green' : school.status === 'unavailable' ? 'gold' : 'blue'}`}>
            {school.status === 'ready' ? t(language, 'Live', 'Активно', 'Faol') : t(language, 'Server', 'Сервер', 'Server')}
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
                'Rosters, classes, and assignments come from the authenticated school API.',
                'Списки, классы и задания загружаются из школьного API.',
                'Ro‘yxatlar, sinflar va topshiriqlar maktab API’sidan olinadi.',
              )
            : t(
                language,
                'Clearly-labelled local samples remain available when the server cannot be reached.',
                'Явно помеченные локальные образцы доступны, если сервер недоступен.',
                'Server ishlamasa, aniq belgilangan mahalliy namunalar mavjud.',
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
  const [selectedId, setSelectedId] = useState('');
  const [workspace, setWorkspace] = useState<ClassWorkspace>(EMPTY_WORKSPACE);
  const [revision, setRevision] = useState(0);
  const [draftAssignmentId, setDraftAssignmentId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftPhotos, setDraftPhotos] = useState<string[]>([]);
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
        setWorkspace({ ...EMPTY_WORKSPACE, error: describeSchoolError(error) });
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
    if (!draftContent.trim()) return;
    if (draftPhotos.length === 0 && !assignment.mySubmission?.attachmentCount) {
      setMutationError(t(language, 'Add at least one photo of your notebook.', 'Добавьте хотя бы одно фото тетради.', 'Daftaringizning kamida bitta rasmini qo‘shing.'));
      return;
    }
    setBusyId(assignment.id);
    setMutationError('');
    setNotice('');
    try {
      await submitAssignment(assignment.id, {
        content: draftContent.trim(),
        ...(draftPhotos.length ? { attachments: draftPhotos } : {}),
      });
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
    } catch (error) {
      setMutationError(describeSchoolError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="notice school-connected-notice" style={{ marginBottom: 16 }}>
        <ShieldCheck size={16} />
        <span>
          <b>{t(language, 'Server class records', 'Данные классов с сервера', 'Serverdagi sinf ma’lumotlari')}</b>
          {' — '}
          {t(
            language,
            'Only classes linked to this account are shown. Rosters and assignments are read from the school API.',
            'Показаны только классы, связанные с этим аккаунтом. Списки и задания загружаются из школьного API.',
            'Faqat shu hisobga bog‘langan sinflar ko‘rsatiladi. Ro‘yxat va topshiriqlar maktab API’sidan olinadi.',
          )}
        </span>
      </div>

      <div className="grid grid-3">
        {school.classes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`panel class-card ${item.id === activeClassId ? 'selected' : ''}`}
            onClick={() => {
              setSelectedId(item.id);
              setDraftAssignmentId(null);
              setNotice('');
              setMutationError('');
            }}
            style={{ textAlign: 'left' }}
          >
            <div className="row-between">
              <span className="tag blue">{item.name}</span>
              <span className="muted">
                {item.studentCount ?? 0} {t(language, 'students', 'учеников', 'o‘quvchi')}
              </span>
            </div>
            <h2 style={{ marginTop: 12 }}>
              {item.grade}
              {t(language, ' grade', ' класс', '-sinf')} · {item.academicYear}
            </h2>
            <p className="muted">{item.schoolName ?? activeClass?.schoolName ?? ''}</p>
            <div className="progress-track" style={{ marginTop: 14 }}>
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (item.studentCount ?? 0) * 3)}%` }}
              />
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Panel>
          <SectionHead
            title={activeClass?.name ?? t(language, 'Class', 'Класс', 'Sinf')}
            detail={activeClass?.schoolName}
            tag={<span className="tag green">{t(language, 'Server roster', 'Список с сервера', 'Server ro‘yxati')}</span>}
          />
          {workspace.loading ? (
            <p className="muted" role="status">{t(language, 'Loading roster…', 'Загружаем список…', 'Ro‘yxat yuklanmoqda…')}</p>
          ) : workspace.error ? (
            <InlineError>{workspace.error}</InlineError>
          ) : (
            <>
              <div className="list-row">
                <span className="list-title">{t(language, 'Students', 'Ученики', 'O‘quvchilar')}</span>
                <b>{studentMembers.length}</b>
              </div>
              <div className="list-row">
                <span className="list-title">{t(language, 'Teachers', 'Учителя', 'O‘qituvchilar')}</span>
                <b>{teacherMembers.length}</b>
              </div>
              <div className="list-row">
                <span className="list-title">{t(language, 'Academic year', 'Учебный год', 'O‘quv yili')}</span>
                <span>{activeClass?.academicYear}</span>
              </div>
              <div className="list-row">
                <span className="list-title">{t(language, 'Your class role', 'Ваша роль в классе', 'Sinfdagi rolingiz')}</span>
                <span className="tag">{workspace.role ? formatStatus(workspace.role) : t(language, 'Manager access', 'Доступ руководителя', 'Rahbar ruxsati')}</span>
              </div>
              <div className="school-member-chips">
                {workspace.members.slice(0, 8).map((member) => (
                  <span className="tag" key={member.userId} title={member.accountRole ?? member.role}>
                    {member.username} · {formatStatus(member.role)}
                  </span>
                ))}
                {workspace.members.length > 8 && (
                  <span className="tag gold">+{workspace.members.length - 8}</span>
                )}
                {workspace.members.length === 0 && (
                  <span className="muted">{t(language, 'No roster members have been added yet.', 'В списке пока нет участников.', 'Ro‘yxatga hali a’zo qo‘shilmagan.')}</span>
                )}
              </div>
              {canManageClass && (
                <button type="button" className="btn primary" style={{ marginTop: 14 }} onClick={() => onOpen('/teacher')}>
                  {t(language, 'Manage class in teacher workspace', 'Управлять классом в кабинете учителя', 'Sinfni o‘qituvchi kabinetida boshqarish')}
                  <ArrowRight size={15} />
                </button>
              )}
            </>
          )}
        </Panel>

        <Panel>
          <SectionHead
            title={t(language, 'Class assignments', 'Задания класса', 'Sinf topshiriqlari')}
            detail={t(language, 'Posted work visible to this class.', 'Работы, доступные этому классу.', 'Bu sinfga ko‘rinadigan topshiriqlar.')}
            tag={
              <button type="button" className="btn small" onClick={() => setRevision((value) => value + 1)}>
                <RefreshCw size={13} />
                {t(language, 'Reload', 'Обновить', 'Yangilash')}
              </button>
            }
          />
          {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}
          {mutationError && <InlineError>{mutationError}</InlineError>}
          {classAssignments.length === 0 ? (
            <div className="callout">
              {t(
                language,
                'No assignments have been posted to this class yet.',
                'В этот класс пока не добавлено ни одного задания.',
                'Bu sinfga hali topshiriq joylanmagan.',
              )}
            </div>
          ) : (
            <div className="stack school-assignment-list">
              {classAssignments.map((assignment) => {
                const submission = assignment.mySubmission;
                const isEditing = draftAssignmentId === assignment.id;
                return (
                  <article className="school-assignment-card" key={assignment.id}>
                    <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                      <div>
                        <b>{assignment.title}</b>
                        <div className="list-meta">
                          {assignment.subject} · {formatDue(assignment.dueAt)}
                        </div>
                      </div>
                      <span className={`tag ${submission ? 'green' : 'gold'}`}>
                        {submission ? formatStatus(submission.status) : formatStatus(assignment.status)}
                      </span>
                    </div>
                    <p className="muted school-assignment-copy">{assignment.description}</p>
                    {assignment.topicTitle && (
                      <button type="button" className="hw-topic-link" onClick={() => onOpen('/topics')}>
                        <BookOpen size={14} />
                        {t(language, 'Theory', 'Теория', 'Nazariya')}: {assignment.topicTitle}
                        <ArrowRight size={13} />
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
                            · {t(language, 'Score', 'Оценка', 'Ball')}: {submission.score}
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
                    {canSubmit && !(submission?.signedAt && submission.status === 'checked') && (
                      <div className="stack" style={{ gap: 8 }}>
                        {isEditing ? (
                          <>
                            <div className="control">
                              <label>{t(language, '1. Do it in your notebook, then photograph it', '1. Выполните в тетради и сфотографируйте', '1. Daftarda bajaring va suratga oling')}</label>
                              <PhotoPicker
                                photos={draftPhotos}
                                onChange={setDraftPhotos}
                                language={language}
                                existingCount={submission?.attachmentCount ?? 0}
                              />
                            </div>
                            <div className="control">
                              <label htmlFor={`submit-${assignment.id}`}>
                                {t(language, '2. In your own words: what did you understand?', '2. Своими словами: что вы поняли?', '2. O‘z so‘zingiz bilan: nimani tushundingiz?')}
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
                                disabled={!draftContent.trim() || busyId === assignment.id || (draftPhotos.length === 0 && !submission?.attachmentCount)}
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
                );
              })}
            </div>
          )}
        </Panel>
      </div>
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
  const [form, setForm] = useState({ title: '', subject: 'Mathematics', description: '', dueAt: '', topicId: '' });
  const [topics, setTopics] = useState<LessonTopic[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyAssignmentId, setBusyAssignmentId] = useState<string | null>(null);
  const [reviewAssignmentId, setReviewAssignmentId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithStudent[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
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
        if (!cancelled) setError(describeSchoolError(requestError));
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
        t(language, 'Assignment published to the server.', 'Задание опубликовано на сервере.', 'Topshiriq serverga joylandi.'),
      );
      await school.refresh();
    } catch (requestError) {
      setError(describeSchoolError(requestError));
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
      setError(describeSchoolError(requestError));
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
      setError(describeSchoolError(requestError));
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
      setNotice(t(language, 'Review saved.', 'Проверка сохранена.', 'Tekshiruv saqlandi.'));
      const refreshed = await listSubmissions(reviewAssignmentId);
      setSubmissions(refreshed.submissions);
    } catch (requestError) {
      setError(describeSchoolError(requestError));
    } finally {
      setReviewBusyId(null);
    }
  }

  return (
    <>
      <div className="notice school-connected-notice" style={{ marginBottom: 16 }}>
        <ShieldCheck size={16} />
        <span>
          <b>{t(language, 'Server teaching workspace', 'Кабинет учителя на сервере', 'Serverdagi o‘qituvchi kabineti')}</b>
          {' — '}
          {t(
            language,
            'Assignments and reviews below are stored by the school API. The local drafting tools further down stay in this browser.',
            'Задания и проверки ниже хранятся в школьном API. Инструменты черновиков ниже остаются в браузере.',
            'Quyidagi topshiriq va tekshiruvlar maktab API’sida saqlanadi. Pastdagi qoralama vositalar brauzerda qoladi.',
          )}
        </span>
      </div>

      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}

      <div className="grid grid-2" style={{ marginTop: error || notice ? 12 : 0 }}>
        <Panel>
          <SectionHead
            title={t(language, 'Publish an assignment', 'Опубликовать задание', 'Topshiriq joylash')}
            detail={activeClass ? `${activeClass.name} · ${activeClass.academicYear}` : undefined}
            tag={
              <select
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
              </select>
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
                <select
                  id="server-assignment-subject"
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                >
                  {['Mathematics', 'Biology', 'History', 'Physics', 'Chemistry', 'Uzbek', 'Russian', 'English'].map((subject) => (
                    <option value={subject} key={subject}>{subject}</option>
                  ))}
                </select>
              </div>
              <div className="control">
                <label htmlFor="server-assignment-due">{t(language, 'Due date', 'Срок', 'Muddat')}</label>
                <input
                  id="server-assignment-due"
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
                />
              </div>
            </div>
            <div className="control">
              <label htmlFor="server-assignment-topic">{t(language, 'Linked 3D theory topic', 'Связанная тема 3D-теории', 'Bog‘langan 3D nazariya mavzusi')}</label>
              <select
                id="server-assignment-topic"
                value={form.topicId}
                onChange={(event) => setForm({ ...form, topicId: event.target.value })}
              >
                <option value="">{t(language, 'No topic', 'Без темы', 'Mavzusiz')}</option>
                {topics.map((topic) => (
                  <option value={topic.id} key={topic.id}>{topic.subject} · {topic.title}</option>
                ))}
              </select>
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

        <Panel>
          <SectionHead
            title={t(language, 'Review queue', 'Очередь проверки', 'Tekshiruv navbati')}
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
                      <div className="grid grid-2" style={{ gap: 8 }}>
                        <div className="control">
                          <label htmlFor={`review-status-${submission.studentId}`}>{t(language, 'Status', 'Статус', 'Holat')}</label>
                          <select
                            id={`review-status-${submission.studentId}`}
                            value={draft.status}
                            onChange={(event) => updateDraft(submission.studentId, { status: event.target.value })}
                          >
                            {REVIEW_STATUSES.map((status) => (
                              <option value={status} key={status}>{formatStatus(status)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="control">
                          <label htmlFor={`review-score-${submission.studentId}`}>{t(language, 'Score (0–100)', 'Оценка (0–100)', 'Ball (0–100)')}</label>
                          <input
                            id={`review-score-${submission.studentId}`}
                            type="number"
                            min={0}
                            max={100}
                            value={draft.score}
                            onChange={(event) => updateDraft(submission.studentId, { score: event.target.value })}
                          />
                        </div>
                      </div>
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
                        disabled={reviewBusyId === submission.studentId}
                        onClick={() => void saveReview(submission.studentId)}
                      >
                        <CheckCircle2 size={13} />
                        {t(language, 'Save review', 'Сохранить проверку', 'Tekshiruvni saqlash')}
                      </button>
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
          title={t(language, 'Class assignments on the server', 'Задания класса на сервере', 'Serverdagi sinf topshiriqlari')}
          detail={activeClass ? `${activeClass.schoolName ?? ''} · ${activeClass.name}` : undefined}
          tag={<span className="tag green">{classAssignments.length}</span>}
        />
        {classAssignments.length === 0 ? (
          <div className="callout">
            {t(language, 'No assignments in this class yet. Use the form above to publish the first one.', 'В этом классе пока нет заданий. Опубликуйте первое через форму выше.', 'Bu sinfda hali topshiriq yo‘q. Yuqoridagi shakl orqali birinchisini joylang.')}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t(language, 'Assignment', 'Задание', 'Topshiriq')}</th>
                  <th>{t(language, 'Due', 'Срок', 'Muddat')}</th>
                  <th>{t(language, 'Status', 'Статус', 'Holat')}</th>
                  <th>{t(language, 'Submissions', 'Работы', 'Javoblar')}</th>
                  <th>{t(language, 'Actions', 'Действия', 'Amallar')}</th>
                </tr>
              </thead>
              <tbody>
                {classAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      <b>{assignment.title}</b>
                      <div className="list-meta">{assignment.subject}</div>
                    </td>
                    <td>{formatDue(assignment.dueAt)}</td>
                    <td>
                      <select
                        className="top-select"
                        aria-label={`${t(language, 'Status for', 'Статус для', 'Holati')} ${assignment.title}`}
                        value={assignment.status}
                        disabled={busyAssignmentId === assignment.id}
                        onChange={(event) => void changeStatus(assignment, event.target.value)}
                      >
                        {ASSIGNMENT_STATUSES.map((status) => (
                          <option value={status} key={status}>{formatStatus(status)}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {assignment.submissionCount ?? 0}
                      {assignment.reviewCount ? ` · ${assignment.reviewCount} ${t(language, 'reviewed', 'проверено', 'tekshirilgan')}` : ''}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className={`btn small ${reviewAssignmentId === assignment.id ? 'subtle' : ''}`}
                          onClick={() =>
                            setReviewAssignmentId((current) =>
                              current === assignment.id ? null : assignment.id,
                            )
                          }
                        >
                          <ClipboardCheck size={13} />
                          {t(language, 'Review', 'Проверить', 'Tekshirish')}
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          aria-label={`${t(language, 'Delete', 'Удалить', 'O‘chirish')} ${assignment.title}`}
                          disabled={busyAssignmentId === assignment.id}
                          onClick={() => void removeAssignment(assignment)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        if (!cancelled) setError(describeSchoolError(requestError));
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
      setNotice(t(language, 'Class created on the server.', 'Класс создан на сервере.', 'Sinf serverda yaratildi.'));
      await school.refresh();
      setRevision((value) => value + 1);
    } catch (requestError) {
      setError(describeSchoolError(requestError));
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
          <span className="tag green">{t(language, 'Server records', 'Данные сервера', 'Server ma’lumotlari')}</span>
          <RefreshButton onClick={() => setRevision((value) => value + 1)} busy={loading} language={language} />
        </div>
      </div>

      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}

      <div className="grid grid-4" style={{ marginTop: 12 }}>
        <Panel>
          <div className="metric">
            <div>
              <div className="metric-label">{t(language, 'Members', 'Участники', 'A’zolar')}</div>
              <div className="metric-value">{detail?.memberCount ?? members.length}</div>
              <div className="metric-note">{t(language, 'From the server roster', 'Из списка сервера', 'Server ro‘yxatidan')}</div>
            </div>
            <div className="metric-icon"><Users /></div>
          </div>
        </Panel>
        <Panel>
          <div className="metric">
            <div>
              <div className="metric-label">{t(language, 'Classes', 'Классы', 'Sinflar')}</div>
              <div className="metric-value">{detail?.classCount ?? schoolClasses.length}</div>
              <div className="metric-note">{t(language, 'Linked to this school', 'Привязаны к школе', 'Bu maktabga bog‘langan')}</div>
            </div>
            <div className="metric-icon"><BookOpen /></div>
          </div>
        </Panel>
        <Panel>
          <div className="metric">
            <div>
              <div className="metric-label">{t(language, 'Assignments', 'Задания', 'Topshiriqlar')}</div>
              <div className="metric-value">{schoolAssignments.length}</div>
              <div className="metric-note">{t(language, 'Visible to this account', 'Видимы этому аккаунту', 'Bu hisobga ko‘rinadi')}</div>
            </div>
            <div className="metric-icon"><ClipboardCheck /></div>
          </div>
        </Panel>
        <Panel>
          <div className="metric">
            <div>
              <div className="metric-label">{t(language, 'Your school role', 'Ваша роль в школе', 'Maktabdagi rolingiz')}</div>
              <div className="metric-value" style={{ fontSize: 17 }}>
                {activeMembership ? formatStatus(activeMembership.role) : '—'}
              </div>
              <div className="metric-note">{activeMembership?.region}</div>
            </div>
            <div className="metric-icon"><ShieldCheck /></div>
          </div>
        </Panel>
      </div>

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
            tag={<span className="tag blue">{t(language, 'Server record', 'Запись сервера', 'Server yozuvi')}</span>}
          />
          {loading ? (
            <p className="muted" role="status">{t(language, 'Loading school record…', 'Загружаем школу…', 'Maktab yozuvi yuklanmoqda…')}</p>
          ) : (
            <>
              <h3>{t(language, 'Roster', 'Список', 'Ro‘yxat')}</h3>
              {members.length === 0 ? (
                <div className="callout">
                  {canManage
                    ? t(language, 'No members yet. Add accounts through the school API or a teacher workspace.', 'Участников пока нет. Добавьте аккаунты через API школы или кабинет учителя.', 'Hali a’zo yo‘q. Hisoblarni maktab API’si yoki o‘qituvchi kabineti orqali qo‘shing.')
                    : t(language, 'The roster is only shown to school managers.', 'Список видят только руководители школы.', 'Ro‘yxat faqat maktab rahbarlariga ko‘rinadi.')}
                </div>
              ) : (
                <div className="school-member-chips">
                  {members.map((member) => (
                    <span className="tag" key={member.userId} title={member.login ?? member.accountRole}>
                      {member.username} · {formatStatus(member.role)}
                    </span>
                  ))}
                </div>
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

export function ServerAdminSchoolsPanel({ language }: { language: Language }) {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', region: '', district: '', address: '' });
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
        if (!cancelled) setError(describeSchoolError(requestError));
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
      await createSchool(payload);
      setForm({ name: '', region: form.region, district: '', address: '' });
      setNotice(t(language, 'School created on the server.', 'Школа создана на сервере.', 'Maktab serverda yaratildi.'));
      setRevision((value) => value + 1);
    } catch (requestError) {
      setError(describeSchoolError(requestError));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel className="school-admin-panel">
      <SectionHead
        title={t(language, 'Organizations on the server', 'Организации на сервере', 'Serverdagi tashkilotlar')}
        detail={t(
          language,
          'Global administrators can create and inspect real school records. The local demo lists below are separate.',
          'Глобальные администраторы могут создавать и просматривать реальные школы. Локальные демо-списки ниже не связаны с ними.',
          'Global administratorlar haqiqiy maktab yozuvlarini yaratishi va ko‘rishi mumkin. Pastdagi mahalliy demo ro‘yxatlar alohida.',
        )}
        tag={
          <div className="row">
            <span className="tag green">{schools.length}</span>
            <RefreshButton onClick={() => setRevision((value) => value + 1)} busy={loading} language={language} />
          </div>
        }
      />
      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="notice school-inline-success" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div>}
      {loading ? (
        <p className="muted" role="status">{t(language, 'Loading schools…', 'Загружаем школы…', 'Maktablar yuklanmoqda…')}</p>
      ) : schools.length === 0 ? (
        <div className="callout">
          {t(language, 'No school records exist on the server yet.', 'На сервере пока нет школ.', 'Serverda hali maktab yozuvlari yo‘q.')}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="stack school-admin-create" onSubmit={handleCreate}>
        <h3>{t(language, 'Create a school record', 'Создать школу', 'Maktab yozuvini yaratish')}</h3>
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
        <button type="submit" className="btn primary" disabled={creating || !form.name.trim() || !form.region.trim()}>
          <Plus size={14} />
          {creating
            ? t(language, 'Creating…', 'Создаём…', 'Yaratilmoqda…')
            : t(language, 'Create school', 'Создать школу', 'Maktab yaratish')}
        </button>
      </form>
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
      setError(describeSchoolError(requestError));
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
          <select
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
          </select>
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
      setError(describeSchoolError(requestError));
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
          <select
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
          </select>
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
          {t(language, 'Create a topic with AI', 'Создать тему с ИИ', 'AI bilan mavzu yaratish')}
        </a>
      </div>
    </Panel>
  );
}
