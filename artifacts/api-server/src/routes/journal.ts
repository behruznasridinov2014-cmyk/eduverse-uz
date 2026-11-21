import { and, asc, eq, gte, lte } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
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
import { escapeHtml, notifyFamily } from "../lib/notify";
import { pushNotice, withParents } from "../lib/inbox";

/*
 * The class journal, like the electronic school journal: one column per lesson date of a subject
 * (taken from the timetable), one row per pupil. A cell is a mark 2…5 or «нб» (absent).
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
  const today = tashkentNow().date;
  const students = await db.select({ id: usersTable.id, name: usersTable.username, status: usersTable.status })
    .from(classMembersTable).innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
    .orderBy(asc(usersTable.username));
  const weekdays = new Set(slots.filter((slot) => slot.subject === subject).map((slot) => slot.weekday));
  const dates = weekdays.size ? lessonDates(weekdays, today) : [];
  const from = dates[0] ?? today;
  const [marks, absences] = subject ? await Promise.all([
    db.select({ studentId: journalMarksTable.studentId, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent })
      .from(journalMarksTable).where(and(eq(journalMarksTable.classId, classId), eq(journalMarksTable.subject, subject))),
    db.select({ studentId: attendanceTable.studentId, date: attendanceTable.attendanceDate })
      .from(attendanceTable).where(and(eq(attendanceTable.classId, classId), eq(attendanceTable.subject, ATTENDANCE_NAME[subject] ?? subject), eq(attendanceTable.status, "absent"), gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, today))),
  ]) : [[], []];
  // Dates with marks outside the timetable (an extra lesson) are shown too.
  const allDates = [...new Set([...dates, ...marks.map((mark) => mark.date)])].sort();
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    subject, subjects, today, dates: allDates,
    students: students.filter((student) => !student.status || student.status === "active").map(({ id, name }) => ({ id, name })),
    marks,
    absences: absences.map((row) => ({ studentId: row.studentId, date: String(row.date).slice(0, 10) })),
  });
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
  const absent = body.absent === true;
  const mark = body.mark === null || body.mark === undefined ? null : Number(body.mark);
  if (!SUBJECT_RE.test(subject) || !DATE_RE.test(date) || !isValidUuid(studentId)) { res.status(400).json({ error: "Invalid mark." }); return; }
  if (mark !== null && (!Number.isInteger(mark) || mark < 2 || mark > 5)) { res.status(400).json({ error: "A mark is 2, 3, 4 or 5." }); return; }
  if (date > tashkentNow().date) { res.status(400).json({ error: "A mark cannot be given ahead of the lesson." }); return; }
  const { subjects } = await subjectsFor(viewer, classId, allowed.manager);
  if (!subjects.includes(subject)) { res.status(403).json({ error: "You do not teach this subject in this class." }); return; }
  const [pupil] = await db.select({ id: classMembersTable.id }).from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, studentId), eq(classMembersTable.role, "student"))).limit(1);
  if (!pupil) { res.status(404).json({ error: "This pupil is not in the class." }); return; }
  if (mark === null && !absent) {
    await db.delete(journalMarksTable).where(and(eq(journalMarksTable.classId, classId), eq(journalMarksTable.studentId, studentId), eq(journalMarksTable.subject, subject), eq(journalMarksTable.date, date)));
  } else {
    await db.insert(journalMarksTable).values({ classId, studentId, subject, date, mark: absent ? null : mark, absent, markedBy: viewer.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [journalMarksTable.classId, journalMarksTable.studentId, journalMarksTable.subject, journalMarksTable.date], set: { mark: absent ? null : mark, absent, markedBy: viewer.id, updatedAt: new Date() } });
  }
  // The pupil and the parents hear about a new mark or an absence.
  if (mark !== null || absent) {
    const SUBJECT_NAME: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };
    const day = date.split("-").reverse().join(".");
    const text = absent
      ? `⚠️ Jurnalda «nb» / В журнале «нб»: ${escapeHtml(SUBJECT_NAME[subject] ?? subject)}, ${day}`
      : `📘 Jurnalga baho / Оценка в журнал: <b>${mark}</b> · ${escapeHtml(SUBJECT_NAME[subject] ?? subject)}, ${day}`;
    void notifyFamily(studentId, text, true);
    void pushNotice(await withParents([studentId]), "grades", absent ? `«нб» в журнале: ${SUBJECT_NAME[subject] ?? subject}` : `Оценка в журнал: ${mark}`, `${SUBJECT_NAME[subject] ?? subject}, ${day}`, "/grades");
  }
  res.json({ ok: true });
});

/** A pupil's (or a parent's child's) own journal marks, newest first. */
router.get("/me/marks", requireAuthenticatedRole("student"), async (_req, res) => {
  const viewer = viewerOf(res);
  const rows = await db.select({ subject: journalMarksTable.subject, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent })
    .from(journalMarksTable).where(eq(journalMarksTable.studentId, viewer.id));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ marks: rows.slice(0, 200) });
});

export default router;

