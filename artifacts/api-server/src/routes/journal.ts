import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  attendanceTable,
  classMembersTable,
  classesTable,
  db,
  journalMarksTable,
  schoolMembersTable,
  timetableSlotsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { canManageClass, isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { tashkentNow } from "./timetable";
import { notifyFamily, subjectText, tl, escapeHtml } from "../lib/notify";
import { pushNotice, withParents } from "../lib/inbox";

/*
 * The class journal, like the electronic school journal: one column per lesson date of a subject
 * (taken from the timetable), one row per pupil. A cell is a mark 2…10 or «нб» (absent).
 * Marks below 2 do not exist. A teacher marks only the subjects they teach in that class.
 */
const router: IRouter = Router();
type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const STAFF = ["teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUBJECT_RE = /^[\p{L}\p{N} .,'’()\-/]{1,40}$/u;
/** Attendance is saved under Russian subject names. */
const ATTENDANCE_NAME: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };
/** Behaviour marks live next to the lesson marks under their own key, e.g. "behavior:math". */
type MarkKind = "class" | "behavior" | "homework";
const kindOf = (value: unknown): MarkKind => (value === "behavior" ? "behavior" : value === "homework" ? "homework" : "class");
const keyOf = (subject: string, kind: MarkKind) => (kind === "class" ? subject : `${kind}:${subject}`);
const limiter = createRateLimiter(600, 10 * 60 * 1000, "Too many changes. Try again later.", "journal-marks");

async function access(viewer: Viewer, classId: string) {
  const [klass] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!klass) return null;
  if (isGlobalAdminRole(viewer.role)) return { schoolId: klass.schoolId, manager: true };
  const [[school], [member]] = await Promise.all([
    db.select({ role: schoolMembersTable.role }).from(schoolMembersTable).where(and(eq(schoolMembersTable.schoolId, klass.schoolId), eq(schoolMembersTable.userId, viewer.id))).limit(1),
    db.select({ role: classMembersTable.role }).from(classMembersTable).where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, viewer.id))).limit(1),
  ]);
  if (!canManageClass(viewer.role, school?.role, member?.role)) return null;
  const manager = school?.role === "school_director" || school?.role === "school_admin";
  return { schoolId: klass.schoolId, manager };
}

/** Subjects of a class from the timetable; a teacher gets only their own (all of them if the class has no timetable). */
async function subjectsFor(viewer: Viewer, classId: string, manager: boolean) {
  const slots = await db.select({ subject: timetableSlotsTable.subject, weekday: timetableSlotsTable.weekday, teacherId: timetableSlotsTable.teacherId })
    .from(timetableSlotsTable).where(eq(timetableSlotsTable.classId, classId));
  const mine = manager ? slots : slots.filter((slot) => slot.teacherId === viewer.id);
  const subjects = [...new Set(mine.map((slot) => slot.subject))];
  return { slots, subjects: subjects.length || slots.length ? subjects : ["math", "physics", "chemistry", "biology"] };
}

/** School days (Mon–Sat) of the last weeks on which the class has this subject, up to today. */
function lessonDates(weekdays: Set<number>, today: string, weeks = 6): string[] {
  const out: string[] = [];
  const end = new Date(`${today}T12:00:00Z`);
  for (let back = weeks * 7; back >= 0; back -= 1) {
    const day = new Date(end.getTime() - back * 86400000);
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (weekdays.has(weekday)) out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

router.get("/classes/:classId/marks", requireAuthenticatedRole(...STAFF), async (req, res) => {
  const classId = String(req.params.classId);
  if (!isValidUuid(classId)) { res.status(400).json({ error: "Invalid class." }); return; }
  const viewer = viewerOf(res);
  const allowed = await access(viewer, classId);
  if (!allowed) { res.status(403).json({ error: "Not your class." }); return; }
  const { slots, subjects } = await subjectsFor(viewer, classId, allowed.manager);
  const wanted = String(req.query.subject ?? "");
  const subject = subjects.includes(wanted) ? wanted : subjects[0] ?? "";
  const kind = kindOf(req.query.kind);
  const key = keyOf(subject, kind);
  const today = tashkentNow().date;
  const students = await db.select({ id: usersTable.id, name: usersTable.username, status: usersTable.status })
    .from(classMembersTable).innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
    .orderBy(asc(usersTable.username));
  const weekdays = new Set(slots.filter((slot) => slot.subject === subject).map((slot) => slot.weekday));
  const dates = weekdays.size ? lessonDates(weekdays, today) : [];
  const from = dates[0] ?? today;
  const [marks, absences] = subject ? await Promise.all([
    db.select({ studentId: journalMarksTable.studentId, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent, comment: journalMarksTable.comment })
      .from(journalMarksTable).where(and(eq(journalMarksTable.classId, classId), eq(journalMarksTable.subject, key), gte(journalMarksTable.date, from))),
    db.select({ studentId: attendanceTable.studentId, date: attendanceTable.attendanceDate })
      .from(attendanceTable).where(and(eq(attendanceTable.classId, classId), eq(attendanceTable.subject, ATTENDANCE_NAME[subject] ?? subject), eq(attendanceTable.status, "absent"), gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, today))),
  ]) : [[], []];
  // Dates with marks outside the timetable (an extra lesson) are shown too.
  const allDates = [...new Set([...dates, ...marks.map((mark) => mark.date)])].sort();
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    subject, subjects, kind, today, dates: allDates,
    students: students.filter((student) => !student.status || student.status === "active").map(({ id, name }) => ({ id, name })),
    marks,
    absences: absences.map((row) => ({ studentId: row.studentId, date: String(row.date).slice(0, 10) })),
  });
});

/**
 * "My class": for each pupil the average lesson mark, the last marks, attendance and homework
 * of the last 60 days. A teacher sees the marks of their own subjects; the director sees all.
 */
router.get("/classes/:classId/overview", requireAuthenticatedRole(...STAFF), async (req, res) => {
  const classId = String(req.params.classId);
  if (!isValidUuid(classId)) { res.status(400).json({ error: "Invalid class." }); return; }
  const viewer = viewerOf(res);
  const allowed = await access(viewer, classId);
  if (!allowed) { res.status(403).json({ error: "Not your class." }); return; }
  const { subjects } = await subjectsFor(viewer, classId, allowed.manager);
  const today = tashkentNow().date;
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const students = (await db.select({ id: usersTable.id, name: usersTable.username, status: usersTable.status })
    .from(classMembersTable).innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
    .orderBy(asc(usersTable.username))).filter((row) => !row.status || row.status === "active");
  const markRows = () => db.select({ studentId: journalMarksTable.studentId, subject: journalMarksTable.subject, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent })
    .from(journalMarksTable).where(and(eq(journalMarksTable.classId, classId), inArray(journalMarksTable.subject, subjects), gte(journalMarksTable.date, from)))
        .orderBy(asc(journalMarksTable.date));
  const [marks, visits, tasks] = await Promise.all([
    subjects.length ? markRows() : Promise.resolve([] as Awaited<ReturnType<typeof markRows>>),
    db.select({ studentId: attendanceTable.studentId, status: attendanceTable.status })
      .from(attendanceTable).where(and(eq(attendanceTable.classId, classId), gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, today))),
    db.select({ id: assignmentsTable.id, dueAt: assignmentsTable.dueAt }).from(assignmentsTable)
      .where(and(eq(assignmentsTable.classId, classId), gte(assignmentsTable.createdAt, new Date(`${from}T00:00:00+05:00`)))),
  ]);
  const handed = tasks.length
    ? await db.select({ studentId: assignmentSubmissionsTable.studentId, score: assignmentSubmissionsTable.score })
      .from(assignmentSubmissionsTable).where(inArray(assignmentSubmissionsTable.assignmentId, tasks.map((task) => task.id)))
    : [];
  const due = tasks.filter((task) => !task.dueAt || task.dueAt.getTime() < Date.now()).length;
  const pupils = students.map((student) => {
    const own = marks.filter((mark) => mark.studentId === student.id && mark.mark !== null);
    const sum = own.reduce((total, mark) => total + (mark.mark ?? 0), 0);
    const seen = visits.filter((visit) => visit.studentId === student.id);
    const count = (status: string) => seen.filter((visit) => visit.status === status).length;
    const work = handed.filter((row) => row.studentId === student.id);
    return {
      id: student.id, name: student.name,
      average: own.length ? Math.round((sum / own.length) * 10) / 10 : null,
      marks: own.slice(-8).map((mark) => ({ subject: mark.subject, date: mark.date, mark: mark.mark })),
      attendance: { lessons: seen.length, present: count("present"), late: count("late"), absent: count("absent"), excused: count("excused") },
      homework: { given: Math.max(due, work.length), handed: work.length },
    };
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ from, today, subjects, pupils });
});

router.put("/classes/:classId/marks", requireAuthenticatedRole(...STAFF), limiter, async (req, res) => {
  const classId = String(req.params.classId);
  if (!isValidUuid(classId)) { res.status(400).json({ error: "Invalid class." }); return; }
  const viewer = viewerOf(res);
  const allowed = await access(viewer, classId);
  if (!allowed) { res.status(403).json({ error: "Not your class." }); return; }
  const body = (typeof req.body === "object" && req.body) ? req.body as Record<string, unknown> : {};
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const kind = kindOf(body.kind);
  const absent = kind === "class" && body.absent === true;
  const mark = body.mark === null || body.mark === undefined ? null : Number(body.mark);
  const comment = typeof body.comment === "string" ? body.comment.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  const realDate = DATE_RE.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if (!SUBJECT_RE.test(subject) || !realDate || !isValidUuid(studentId)) { res.status(400).json({ error: "Invalid mark." }); return; }
  if (mark !== null && (!Number.isInteger(mark) || mark < 2 || mark > 10)) { res.status(400).json({ error: "A mark is from 2 to 10." }); return; }
  if (date > tashkentNow().date) { res.status(400).json({ error: "A mark cannot be given ahead of the lesson." }); return; }
  const { subjects } = await subjectsFor(viewer, classId, allowed.manager);
  if (!subjects.includes(subject)) { res.status(403).json({ error: "You do not teach this subject in this class." }); return; }
  const key = keyOf(subject, kind);
  const [pupil] = await db.select({ id: classMembersTable.id }).from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, studentId), eq(classMembersTable.role, "student"))).limit(1);
  if (!pupil) { res.status(404).json({ error: "This pupil is not in the class." }); return; }
  const [previous] = await db.select({ mark: journalMarksTable.mark, absent: journalMarksTable.absent }).from(journalMarksTable)
    .where(and(eq(journalMarksTable.classId, classId), eq(journalMarksTable.studentId, studentId), eq(journalMarksTable.subject, key), eq(journalMarksTable.date, date))).limit(1);
  const changed = !previous || previous.mark !== (absent ? null : mark) || previous.absent !== absent;
  if (mark === null && !absent) {
    await db.delete(journalMarksTable).where(and(eq(journalMarksTable.classId, classId), eq(journalMarksTable.studentId, studentId), eq(journalMarksTable.subject, key), eq(journalMarksTable.date, date)));
  } else {
    await db.insert(journalMarksTable).values({ classId, studentId, subject: key, date, mark: absent ? null : mark, absent, comment, markedBy: viewer.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [journalMarksTable.classId, journalMarksTable.studentId, journalMarksTable.subject, journalMarksTable.date], set: { mark: absent ? null : mark, absent, comment, markedBy: viewer.id, updatedAt: new Date() } });
  }
  // The pupil and the parents hear about a new mark or an absence.
  if ((mark !== null || absent) && changed) {
    const SUBJECT_NAME: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };
    const day = date.split("-").reverse().join(".");
    await notifyFamily(studentId, (lang, name) => absent
      ? `⚠️ <b>${tl(lang, "Jurnalda «nb» (kelmadi)", "В журнале «нб» (не был на уроке)", "Absent («ab») in the journal")}</b>\n👤 ${name}\n📖 ${subjectText(lang, subject)} · ${day}`
      : `${kind === "behavior" ? "🙂" : "📘"} <b>${kind === "behavior" ? tl(lang, "Xulq", "Поведение", "Behaviour") : kind === "homework" ? tl(lang, "Uy vazifasi bahosi", "Оценка за домашку", "Homework mark") : tl(lang, "Darsdagi baho", "Оценка за урок", "Lesson mark")}: ${mark}/10</b>\n👤 ${name}\n📖 ${subjectText(lang, subject)} · ${day}${comment ? `\n💬 ${escapeHtml(comment)}` : ""}`, true);
    await pushNotice(await withParents([studentId]), "grades", absent ? `«нб» в журнале: ${SUBJECT_NAME[subject] ?? subject}` : `${kind === "behavior" ? "Поведение" : kind === "homework" ? "Оценка за домашку" : "Оценка за урок"}: ${mark}/10`, `${SUBJECT_NAME[subject] ?? subject}, ${day}`, "/grades");
  }
  res.json({ ok: true });
});

/** A pupil's (or a parent's child's) own journal marks, newest first. */
router.get("/me/marks", requireAuthenticatedRole("student"), async (_req, res) => {
  const viewer = viewerOf(res);
  const rows = await db.select({ subject: journalMarksTable.subject, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent, comment: journalMarksTable.comment })
    .from(journalMarksTable).where(eq(journalMarksTable.studentId, viewer.id));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ marks: rows.slice(0, 200) });
});

export default router;

