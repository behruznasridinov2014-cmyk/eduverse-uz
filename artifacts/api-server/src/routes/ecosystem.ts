import { and, asc, desc, eq, gte, inArray, isNull, lte, max, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  attendanceTable,
  classMembersTable,
  classesTable,
  db,
  familyMessagesTable,
  journalMarksTable,
  parentLinksTable,
  schoolMembersTable,
  schoolsTable,
  timetableChangesTable,
  timetableSlotsTable,
  tuitionPaymentsTable,
  tuitionPlansTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { pushNotice } from "../lib/inbox";
import { writeAudit } from "../lib/audit";
import { gradeOf } from "../lib/grade";
import { tashkentNow } from "./timetable";

/*
 * EDUVERSE as one school system:
 *  1. school analytics for the director (a week, a month, a quarter);
 *  2. the teacher's day: what to check, which journals are empty, which pupils need attention;
 *  3. parent ↔ teacher messages and the parent's weekly report;
 *  4. tuition of a private school: the monthly fee, payments with receipts, debts;
 *  5. timetable changes: a substitute teacher, a cancelled lesson, another room.
 */
/** Journal marks for homework are stored as "homework:<subject>": count them under the subject. */
const baseSubject = (subject: string) => subject.replace(/^(homework|behavior):/, "");

const router: IRouter = Router();
type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const MANAGERS = ["school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const STAFF = ["teacher", ...MANAGERS] as const;
const DAY = 86400000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const writeLimiter = createRateLimiter(240, 10 * 60 * 1000, "Too many changes. Wait a minute.", "ecosystem-write");
const messageLimiter = createRateLimiter(60, 10 * 60 * 1000, "Too many messages. Wait a few minutes.", "family-messages");

const dayText = (ms: number) => tashkentNow(new Date(ms)).date;
const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
const percentPresent = (rows: Array<{ status: string }>) => (rows.length ? Math.round((rows.filter((row) => row.status !== "absent").length / rows.length) * 100) : null);

async function schoolRole(userId: string, schoolId: string): Promise<string | null> {
  const [row] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId))).limit(1);
  return row?.role ?? null;
}
async function isManager(viewer: Viewer, schoolId: string): Promise<boolean> {
  if (isGlobalAdminRole(viewer.role)) return true;
  const role = await schoolRole(viewer.id, schoolId);
  return role === "school_director" || role === "school_admin";
}

/* -------------------------------------------------------------------------- */
/* Shared: which timetable lessons have no attendance or marks in the journal  */
/* -------------------------------------------------------------------------- */

type EmptyJournal = { date: string; classId: string; className: string; subject: string; teacherId: string | null; period: number };

/** Past lessons (up to `days` back, today's finished ones excluded) where nothing was marked. */
async function emptyJournals(slotFilter: { schoolId?: string; teacherId?: string }, days: number): Promise<EmptyJournal[]> {
  const where = slotFilter.teacherId ? eq(timetableSlotsTable.teacherId, slotFilter.teacherId) : eq(timetableSlotsTable.schoolId, slotFilter.schoolId!);
  const slots = await db.select({
    classId: timetableSlotsTable.classId, weekday: timetableSlotsTable.weekday, period: timetableSlotsTable.period,
    subject: timetableSlotsTable.subject, teacherId: timetableSlotsTable.teacherId, className: classesTable.name, createdAt: timetableSlotsTable.createdAt,
  }).from(timetableSlotsTable).innerJoin(classesTable, eq(classesTable.id, timetableSlotsTable.classId)).where(where);
  if (!slots.length) return [];
  const today = tashkentNow();
  const dates: Array<{ date: string; weekday: number }> = [];
  for (let offset = 1; offset <= days; offset += 1) {
    const day = tashkentNow(new Date(Date.now() - offset * DAY));
    if (day.weekday !== 7) dates.push({ date: day.date, weekday: day.weekday });
  }
  if (!dates.length) return [];
  const classIds = [...new Set(slots.map((slot) => slot.classId))];
  const from = dates[dates.length - 1]!.date;
  const [attendance, marks, cancelled] = await Promise.all([
    db.selectDistinct({ classId: attendanceTable.classId, date: attendanceTable.attendanceDate, subject: attendanceTable.subject }).from(attendanceTable)
      .where(and(inArray(attendanceTable.classId, classIds), gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, today.date))),
    db.selectDistinct({ classId: journalMarksTable.classId, date: journalMarksTable.date, subject: journalMarksTable.subject }).from(journalMarksTable)
      .where(and(inArray(journalMarksTable.classId, classIds), gte(journalMarksTable.date, from), lte(journalMarksTable.date, today.date))),
    db.select({ classId: timetableChangesTable.classId, date: timetableChangesTable.date, period: timetableChangesTable.period }).from(timetableChangesTable)
      .where(and(inArray(timetableChangesTable.classId, classIds), gte(timetableChangesTable.date, from), eq(timetableChangesTable.kind, "cancelled"))),
  ]);
  for (const row of marks) row.subject = baseSubject(row.subject);
  const filled = new Set([...attendance, ...marks].map((row) => `${row.classId}|${row.date}|${row.subject.toLowerCase()}`));
  const wholeDay = new Set(attendance.filter((row) => row.subject === "").map((row) => `${row.classId}|${row.date}`));
  const off = new Set(cancelled.map((row) => `${row.classId}|${row.date}|${row.period}`));
  const out: EmptyJournal[] = [];
  for (const { date, weekday } of dates) {
    for (const slot of slots) {
      if (slot.weekday !== weekday || dayText(slot.createdAt.getTime()) > date) continue;
      if (off.has(`${slot.classId}|${date}|${slot.period}`)) continue;
      if (filled.has(`${slot.classId}|${date}|${slot.subject.toLowerCase()}`) || wholeDay.has(`${slot.classId}|${date}`)) continue;
      out.push({ date, classId: slot.classId, className: slot.className, subject: slot.subject, teacherId: slot.teacherId, period: slot.period });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.period - b.period);
}

/* -------------------------------------------------------------------------- */
/* Shared: pupils who need attention                                           */
/* -------------------------------------------------------------------------- */

type Attention = { id: string; name: string; className: string; classId: string; reasons: Array<{ kind: "absent" | "low" | "falling" | "homework"; value: string }> };

async function pupilsNeedingAttention(classIds: string[], days: number, subjects?: string[]): Promise<Attention[]> {
  if (!classIds.length) return [];
  const now = Date.now();
  const from = dayText(now - days * DAY);
  const prevFrom = dayText(now - 2 * days * DAY);
  const pupils = await db.select({ id: usersTable.id, name: usersTable.username, classId: classMembersTable.classId, className: classesTable.name })
    .from(classMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .innerJoin(classesTable, eq(classesTable.id, classMembersTable.classId))
    .where(and(inArray(classMembersTable.classId, classIds), eq(classMembersTable.role, "student"), eq(usersTable.status, "active")));
  if (!pupils.length) return [];
  const ids = [...new Set(pupils.map((pupil) => pupil.id))];
  const subjectFilter = <T extends { subject: string }>(rows: T[]): T[] => (subjects?.length ? rows.filter((row) => subjects.some((item) => item.toLowerCase() === row.subject.toLowerCase())) : rows);
  const [absences, marks, assignments] = await Promise.all([
    db.select({ studentId: attendanceTable.studentId, subject: attendanceTable.subject }).from(attendanceTable)
      .where(and(inArray(attendanceTable.studentId, ids), inArray(attendanceTable.classId, classIds), gte(attendanceTable.attendanceDate, from), eq(attendanceTable.status, "absent"))),
    db.select({ studentId: journalMarksTable.studentId, mark: journalMarksTable.mark, date: journalMarksTable.date, subject: journalMarksTable.subject }).from(journalMarksTable)
      .where(and(inArray(journalMarksTable.studentId, ids), inArray(journalMarksTable.classId, classIds), gte(journalMarksTable.date, prevFrom))),
    db.select({ id: assignmentsTable.id, classId: assignmentsTable.classId, subject: assignmentsTable.subject }).from(assignmentsTable)
      .where(and(inArray(assignmentsTable.classId, classIds), lte(assignmentsTable.dueAt, new Date(now)), gte(assignmentsTable.dueAt, new Date(now - days * DAY)))),
  ]);
  for (const row of marks) row.subject = baseSubject(row.subject);
  const dueAssignments = subjectFilter(assignments);
  const submitted = dueAssignments.length
    ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, studentId: assignmentSubmissionsTable.studentId }).from(assignmentSubmissionsTable)
      .where(inArray(assignmentSubmissionsTable.assignmentId, dueAssignments.map((item) => item.id)))
    : [];
  const done = new Set(submitted.map((row) => `${row.assignmentId}|${row.studentId}`));
  const ownMarks = subjectFilter(marks);
  const out: Attention[] = [];
  for (const pupil of pupils) {
    const reasons: Attention["reasons"] = [];
    const absent = subjectFilter(absences).filter((row) => row.studentId === pupil.id).length;
    if (absent >= 3) reasons.push({ kind: "absent", value: String(absent) });
    const mine = ownMarks.filter((row) => row.studentId === pupil.id && row.mark !== null);
    const nowMarks = mine.filter((row) => row.date >= from).map((row) => row.mark!);
    const prevMarks = mine.filter((row) => row.date < from).map((row) => row.mark!);
    const nowAvg = avg(nowMarks);
    const prevAvg = avg(prevMarks);
    if (nowAvg !== null && nowAvg < 5 && nowMarks.length >= 2) reasons.push({ kind: "low", value: nowAvg.toFixed(1) });
    else if (nowAvg !== null && prevAvg !== null && prevAvg - nowAvg >= 1.5 && nowMarks.length >= 2) reasons.push({ kind: "falling", value: `${prevAvg.toFixed(1)} → ${nowAvg.toFixed(1)}` });
    const missing = dueAssignments.filter((item) => item.classId === pupil.classId && !done.has(`${item.id}|${pupil.id}`)).length;
    if (missing >= 2) reasons.push({ kind: "homework", value: String(missing) });
    if (reasons.length) out.push({ id: pupil.id, name: pupil.name, className: pupil.className, classId: pupil.classId, reasons });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* 1. School analytics                                                          */
/* -------------------------------------------------------------------------- */

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90 };

router.get("/schools/:schoolId/analytics", requireAuthenticatedRole(...MANAGERS), async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration sees this." }); return; }
  const period = PERIOD_DAYS[String(req.query.period ?? "month")] ? String(req.query.period ?? "month") : "month";
  const days = PERIOD_DAYS[period]!;
  const now = Date.now();
  const from = dayText(now - days * DAY);
  const prevFrom = dayText(now - 2 * days * DAY);
  const today = tashkentNow().date;

  const classes = await db.select({ id: classesTable.id, name: classesTable.name, grade: classesTable.grade }).from(classesTable)
    .where(eq(classesTable.schoolId, schoolId)).orderBy(asc(classesTable.grade), asc(classesTable.name));
  const classIds = classes.map((item) => item.id);
  const members = await db.select({ role: schoolMembersTable.role, userId: schoolMembersTable.userId, name: usersTable.username, status: usersTable.status })
    .from(schoolMembersTable).innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId)).where(eq(schoolMembersTable.schoolId, schoolId));
  const teachers = members.filter((row) => row.role === "teacher");
  // An empty list would be an invalid IN (); a uuid nobody has gives an empty answer.
  const scopeIds = classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"];
  const [attendance, marks, assignments, teacherClasses] = await Promise.all([
    db.select({ classId: attendanceTable.classId, status: attendanceTable.status, date: attendanceTable.attendanceDate, subject: attendanceTable.subject }).from(attendanceTable)
      .where(and(inArray(attendanceTable.classId, scopeIds), gte(attendanceTable.attendanceDate, prevFrom))),
    db.select({ classId: journalMarksTable.classId, subject: journalMarksTable.subject, mark: journalMarksTable.mark, date: journalMarksTable.date }).from(journalMarksTable)
      .where(and(inArray(journalMarksTable.classId, scopeIds), gte(journalMarksTable.date, prevFrom))),
    db.select({ id: assignmentsTable.id, classId: assignmentsTable.classId, createdBy: assignmentsTable.createdBy, subject: assignmentsTable.subject, createdAt: assignmentsTable.createdAt }).from(assignmentsTable)
      .where(inArray(assignmentsTable.classId, scopeIds)),
    db.select({ classId: classMembersTable.classId, userId: classMembersTable.userId }).from(classMembersTable)
      .where(and(inArray(classMembersTable.classId, scopeIds), eq(classMembersTable.role, "teacher"))),
  ]);
  for (const row of marks) row.subject = baseSubject(row.subject);
  const submissions = assignments.length
    ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, score: assignmentSubmissionsTable.score, submittedAt: assignmentSubmissionsTable.submittedAt, updatedAt: assignmentSubmissionsTable.updatedAt })
      .from(assignmentSubmissionsTable).where(inArray(assignmentSubmissionsTable.assignmentId, assignments.map((item) => item.id)))
    : [];
  const current = attendance.filter((row) => row.date >= from);
  const previous = attendance.filter((row) => row.date < from);
  const marksNow = marks.filter((row) => row.date >= from && row.mark !== null);
  const marksPrev = marks.filter((row) => row.date < from && row.mark !== null);
  const assignmentOf = new Map(assignments.map((item) => [item.id, item]));
  const unchecked = submissions.filter((row) => row.score === null);

  const perClass = classes.map((klass) => {
    const att = current.filter((row) => row.classId === klass.id);
    const nowMarks = marksNow.filter((row) => row.classId === klass.id).map((row) => row.mark!);
    const prevMarks = marksPrev.filter((row) => row.classId === klass.id).map((row) => row.mark!);
    return {
      id: klass.id, name: klass.name, grade: klass.grade,
      students: 0,
      attendancePercent: percentPresent(att),
      attendancePrev: percentPresent(previous.filter((row) => row.classId === klass.id)),
      absences: att.filter((row) => row.status === "absent").length,
      average: avg(nowMarks), averagePrev: avg(prevMarks), marks: nowMarks.length,
      unchecked: unchecked.filter((row) => assignmentOf.get(row.assignmentId)?.classId === klass.id).length,
    };
  });
  const pupilCounts = await db.select({ classId: classMembersTable.classId, count: sql<number>`count(*)::int` }).from(classMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(inArray(classMembersTable.classId, scopeIds), eq(classMembersTable.role, "student"), eq(usersTable.status, "active")))
    .groupBy(classMembersTable.classId);
  for (const row of pupilCounts) { const item = perClass.find((klass) => klass.id === row.classId); if (item) item.students = row.count; }

  const subjectNames = [...new Set([...marksNow, ...marksPrev].map((row) => row.subject))].sort();
  const perSubject = subjectNames.map((subject) => {
    const nowValues = marksNow.filter((row) => row.subject === subject).map((row) => row.mark!);
    const prevValues = marksPrev.filter((row) => row.subject === subject).map((row) => row.mark!);
    const absent = current.filter((row) => row.subject.toLowerCase() === subject.toLowerCase());
    return { subject, average: avg(nowValues), averagePrev: avg(prevValues), marks: nowValues.length, attendancePercent: percentPresent(absent) };
  }).filter((item) => item.marks > 0 || item.averagePrev !== null);

  const empty = await emptyJournals({ schoolId }, Math.min(days, 14));
  const teacherRows = teachers.map((teacher) => {
    const mine = unchecked.filter((row) => assignmentOf.get(row.assignmentId)?.createdBy === teacher.userId);
    const oldest = mine.reduce((min, row) => Math.min(min, row.submittedAt.getTime()), Number.POSITIVE_INFINITY);
    return {
      id: teacher.userId, name: teacher.name,
      classes: teacherClasses.filter((row) => row.userId === teacher.userId).length,
      unchecked: mine.length,
      oldestDays: Number.isFinite(oldest) ? Math.floor((now - oldest) / DAY) : null,
      emptyJournals: empty.filter((row) => row.teacherId === teacher.userId).length,
      homeworkGiven: assignments.filter((row) => row.createdBy === teacher.userId && row.createdAt.getTime() >= now - days * DAY).length,
      marksGiven: 0,
    };
  }).sort((a, b) => (b.unchecked + b.emptyJournals) - (a.unchecked + a.emptyJournals) || a.name.localeCompare(b.name));

  const attention = await pupilsNeedingAttention(classIds, days);
  const attentionClasses = perClass.filter((item) => (item.attendancePercent !== null && item.attendancePercent < 85) || (item.average !== null && item.average < 6) || (item.average !== null && item.averagePrev !== null && item.averagePrev - item.average >= 1));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    period, from, to: today, days,
    totals: {
      students: members.filter((row) => row.role === "student" && row.status === "active").length,
      teachers: teachers.length,
      parents: members.filter((row) => row.role === "parent").length,
      classes: classes.length,
      attendancePercent: percentPresent(current),
      attendancePrev: percentPresent(previous),
      absentToday: attendance.filter((row) => row.date === today && row.status === "absent").length,
      average: avg(marksNow.map((row) => row.mark!)),
      averagePrev: avg(marksPrev.map((row) => row.mark!)),
      unchecked: unchecked.length,
      emptyJournals: empty.length,
      needAttention: attention.length + attentionClasses.length,
      homeworkAverage: avg(submissions.filter((row) => row.score !== null && row.updatedAt.getTime() >= now - days * DAY).map((row) => gradeOf(row.score!))),
    },
    perClass,
    perSubject,
    teachers: teacherRows,
    emptyJournals: empty.slice(0, 60),
    attention: attention.slice(0, 40),
    attentionClasses: attentionClasses.map((item) => item.id),
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The teacher's day                                                         */
/* -------------------------------------------------------------------------- */

router.get("/me/workspace", requireAuthenticatedRole("teacher", "school_director", "school_admin"), async (_req, res) => {
  const viewer = viewerOf(res);
  const myClasses = await db.select({ id: classMembersTable.classId, name: classesTable.name }).from(classMembersTable)
    .innerJoin(classesTable, eq(classesTable.id, classMembersTable.classId))
    .where(and(eq(classMembersTable.userId, viewer.id), eq(classMembersTable.role, "teacher")));
  const classIds = myClasses.map((item) => item.id);
  const [me] = await db.select({ subjects: usersTable.subjects }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  const subjects = Array.isArray(me?.subjects) ? (me!.subjects as unknown[]).filter((item): item is string => typeof item === "string") : [];
  const mine = await db.select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject, classId: assignmentsTable.classId, dueAt: assignmentsTable.dueAt })
    .from(assignmentsTable).where(eq(assignmentsTable.createdBy, viewer.id)).orderBy(desc(assignmentsTable.createdAt)).limit(200);
  const pending = mine.length
    ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, submittedAt: assignmentSubmissionsTable.submittedAt }).from(assignmentSubmissionsTable)
      .where(and(inArray(assignmentSubmissionsTable.assignmentId, mine.map((item) => item.id)), isNull(assignmentSubmissionsTable.score)))
    : [];
  const className = new Map(myClasses.map((item) => [item.id, item.name]));
  const toReview = mine.map((item) => {
    const rows = pending.filter((row) => row.assignmentId === item.id);
    return { id: item.id, title: item.title, subject: item.subject, classId: item.classId, className: className.get(item.classId) ?? "", count: rows.length, oldest: rows.length ? new Date(Math.min(...rows.map((row) => row.submittedAt.getTime()))).toISOString() : null };
  }).filter((item) => item.count > 0);
  const empty = await emptyJournals({ teacherId: viewer.id }, 14);
  const attention = await pupilsNeedingAttention(classIds, 30, subjects.length ? subjects : undefined);
  const today = tashkentNow().date;
  const changes = await db.select({ id: timetableChangesTable.id, classId: timetableChangesTable.classId, className: classesTable.name, date: timetableChangesTable.date, period: timetableChangesTable.period, kind: timetableChangesTable.kind, room: timetableChangesTable.room, note: timetableChangesTable.note, teacherId: timetableChangesTable.teacherId })
    .from(timetableChangesTable).innerJoin(classesTable, eq(classesTable.id, timetableChangesTable.classId))
    .where(and(gte(timetableChangesTable.date, today), lte(timetableChangesTable.date, dayText(Date.now() + 7 * DAY))));
  const mySlots = await db.select({ classId: timetableSlotsTable.classId, weekday: timetableSlotsTable.weekday, period: timetableSlotsTable.period }).from(timetableSlotsTable)
    .where(eq(timetableSlotsTable.teacherId, viewer.id));
  const weekdayOf = (date: string) => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; };
  const myChanges = changes.filter((item) => item.teacherId === viewer.id || mySlots.some((slot) => slot.classId === item.classId && slot.period === item.period && slot.weekday === weekdayOf(item.date)));
  const unread = await db.select({ count: sql<number>`count(*)::int` }).from(familyMessagesTable)
    .where(and(eq(familyMessagesTable.teacherId, viewer.id), isNull(familyMessagesTable.readAt), sql`${familyMessagesTable.fromId} <> ${viewer.id}`));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    classes: myClasses,
    toReview,
    emptyJournals: empty.slice(0, 30),
    attention: attention.slice(0, 20),
    changes: myChanges.map((item) => ({ ...item, mine: item.teacherId === viewer.id })),
    unreadMessages: unread[0]?.count ?? 0,
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Parents and teachers                                                      */
/* -------------------------------------------------------------------------- */

/** Classes of a pupil and their teachers. */
async function teachersOf(studentId: string) {
  const classes = await db.select({ classId: classMembersTable.classId, schoolId: classesTable.schoolId, className: classesTable.name }).from(classMembersTable)
    .innerJoin(classesTable, eq(classesTable.id, classMembersTable.classId))
    .where(and(eq(classMembersTable.userId, studentId), eq(classMembersTable.role, "student")));
  if (!classes.length) return [];
  const rows = await db.select({ classId: classMembersTable.classId, id: usersTable.id, name: usersTable.username, subjects: usersTable.subjects }).from(classMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(inArray(classMembersTable.classId, classes.map((item) => item.classId)), eq(classMembersTable.role, "teacher")));
  return rows.map((row) => {
    const klass = classes.find((item) => item.classId === row.classId)!;
    return { id: row.id, name: row.name, subjects: Array.isArray(row.subjects) ? (row.subjects as string[]).slice(0, 4) : [], classId: row.classId, className: klass.className, schoolId: klass.schoolId };
  });
}

/** May these three talk: the parent is linked to the pupil and the teacher teaches the pupil's class. */
async function threadAllowed(parentId: string, teacherId: string, studentId: string): Promise<{ schoolId: string } | null> {
  const [link] = await db.select({ id: parentLinksTable.id }).from(parentLinksTable)
    .where(and(eq(parentLinksTable.parentId, parentId), eq(parentLinksTable.studentId, studentId))).limit(1);
  if (!link) return null;
  const teacher = (await teachersOf(studentId)).find((item) => item.id === teacherId);
  return teacher ? { schoolId: teacher.schoolId } : null;
}

router.get("/me/family-threads", requireAuthenticatedRole("parent", "teacher"), async (_req, res) => {
  const viewer = viewerOf(res);
  res.setHeader("Cache-Control", "private, no-store");
  const messages = await db.select().from(familyMessagesTable)
    .where(viewer.role === "parent" ? eq(familyMessagesTable.parentId, viewer.id) : eq(familyMessagesTable.teacherId, viewer.id))
    .orderBy(desc(familyMessagesTable.createdAt)).limit(1000);
  const summary = (parentId: string, teacherId: string, studentId: string) => {
    const rows = messages.filter((row) => row.parentId === parentId && row.teacherId === teacherId && row.studentId === studentId);
    return { last: rows[0] ? { body: rows[0].body.slice(0, 140), at: rows[0].createdAt, mine: rows[0].fromId === viewer.id } : null, unread: rows.filter((row) => row.fromId !== viewer.id && !row.readAt).length };
  };
  if (viewer.role === "parent") {
    const children = await db.select({ id: usersTable.id, name: usersTable.username }).from(parentLinksTable)
      .innerJoin(usersTable, eq(usersTable.id, parentLinksTable.studentId)).where(eq(parentLinksTable.parentId, viewer.id));
    const threads = [];
    for (const child of children) {
      const seen = new Set<string>();
      for (const teacher of await teachersOf(child.id)) {
        if (seen.has(teacher.id)) continue;
        seen.add(teacher.id);
        threads.push({ studentId: child.id, studentName: child.name, otherId: teacher.id, otherName: teacher.name, subtitle: [teacher.className, ...teacher.subjects].filter(Boolean).join(" · "), ...summary(viewer.id, teacher.id, child.id) });
      }
    }
    threads.sort((a, b) => (b.last ? new Date(b.last.at).getTime() : 0) - (a.last ? new Date(a.last.at).getTime() : 0));
    res.json({ threads });
    return;
  }
  // A teacher: parents of the pupils of the teacher's classes.
  const pupils = await db.select({ studentId: classMembersTable.userId, className: classesTable.name }).from(classMembersTable)
    .innerJoin(classesTable, eq(classesTable.id, classMembersTable.classId))
    .where(and(eq(classMembersTable.role, "student"), inArray(classMembersTable.classId,
      db.select({ id: classMembersTable.classId }).from(classMembersTable).where(and(eq(classMembersTable.userId, viewer.id), eq(classMembersTable.role, "teacher"))))));
  const studentIds = [...new Set(pupils.map((row) => row.studentId))];
  const links = studentIds.length
    ? await db.select({ parentId: parentLinksTable.parentId, studentId: parentLinksTable.studentId, parentName: usersTable.username }).from(parentLinksTable)
      .innerJoin(usersTable, eq(usersTable.id, parentLinksTable.parentId)).where(inArray(parentLinksTable.studentId, studentIds))
    : [];
  const names = studentIds.length ? await db.select({ id: usersTable.id, name: usersTable.username }).from(usersTable).where(inArray(usersTable.id, studentIds)) : [];
  const threads = links.map((link) => ({
    studentId: link.studentId,
    studentName: names.find((row) => row.id === link.studentId)?.name ?? "",
    otherId: link.parentId,
    otherName: link.parentName,
    subtitle: pupils.find((row) => row.studentId === link.studentId)?.className ?? "",
    ...summary(link.parentId, viewer.id, link.studentId),
  }));
  threads.sort((a, b) => (b.last ? new Date(b.last.at).getTime() : 0) - (a.last ? new Date(a.last.at).getTime() : 0) || a.studentName.localeCompare(b.studentName));
  res.json({ threads });
});

function threadParties(viewer: Viewer, otherId: string) {
  return viewer.role === "parent" ? { parentId: viewer.id, teacherId: otherId } : { parentId: otherId, teacherId: viewer.id };
}

router.get("/family-threads/:studentId/:otherId", requireAuthenticatedRole("parent", "teacher"), async (req, res) => {
  const viewer = viewerOf(res);
  const studentId = String(req.params.studentId ?? "");
  const otherId = String(req.params.otherId ?? "");
  if (!isValidUuid(studentId) || !isValidUuid(otherId)) { res.status(400).json({ error: "Invalid conversation." }); return; }
  const { parentId, teacherId } = threadParties(viewer, otherId);
  if (!(await threadAllowed(parentId, teacherId, studentId))) { res.status(403).json({ error: "This conversation is not available." }); return; }
  const where = and(eq(familyMessagesTable.parentId, parentId), eq(familyMessagesTable.teacherId, teacherId), eq(familyMessagesTable.studentId, studentId));
  const rows = await db.select({ id: familyMessagesTable.id, body: familyMessagesTable.body, fromId: familyMessagesTable.fromId, createdAt: familyMessagesTable.createdAt, readAt: familyMessagesTable.readAt })
    .from(familyMessagesTable).where(where).orderBy(desc(familyMessagesTable.createdAt)).limit(200);
  await db.update(familyMessagesTable).set({ readAt: new Date() }).where(and(where, isNull(familyMessagesTable.readAt), sql`${familyMessagesTable.fromId} <> ${viewer.id}`));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ messages: rows.reverse().map((row) => ({ ...row, mine: row.fromId === viewer.id })) });
});

router.post("/family-threads/:studentId/:otherId", requireAuthenticatedRole("parent", "teacher"), messageLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const studentId = String(req.params.studentId ?? "");
  const otherId = String(req.params.otherId ?? "");
  const body = str(isRecord(req.body) ? req.body.body : "", 2000);
  if (!isValidUuid(studentId) || !isValidUuid(otherId) || body.length < 1) { res.status(400).json({ error: "Write a message." }); return; }
  const { parentId, teacherId } = threadParties(viewer, otherId);
  const allowed = await threadAllowed(parentId, teacherId, studentId);
  if (!allowed) { res.status(403).json({ error: "This conversation is not available." }); return; }
  const [row] = await db.insert(familyMessagesTable).values({ schoolId: allowed.schoolId, studentId, parentId, teacherId, fromId: viewer.id, body }).returning();
  const [me] = await db.select({ name: usersTable.username }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  await pushNotice([otherId], "messages", `Сообщение · ${me?.name ?? ""}`, body.slice(0, 200), "/messages");
  res.status(201).json({ message: { id: row!.id, body: row!.body, fromId: row!.fromId, createdAt: row!.createdAt, mine: true } });
});

/** The parent's weekly report about one child. */
router.get("/me/children/:studentId/report", requireAuthenticatedRole("parent"), async (req, res) => {
  const viewer = viewerOf(res);
  const studentId = String(req.params.studentId ?? "");
  if (!isValidUuid(studentId)) { res.status(400).json({ error: "Invalid pupil." }); return; }
  const [link] = await db.select({ id: parentLinksTable.id }).from(parentLinksTable).where(and(eq(parentLinksTable.parentId, viewer.id), eq(parentLinksTable.studentId, studentId))).limit(1);
  if (!link) { res.status(403).json({ error: "This is not your child." }); return; }
  const now = Date.now();
  const from = dayText(now - 7 * DAY);
  const prevFrom = dayText(now - 14 * DAY);
  const [marks, attendance, classes] = await Promise.all([
    db.select({ subject: journalMarksTable.subject, mark: journalMarksTable.mark, date: journalMarksTable.date, absent: journalMarksTable.absent }).from(journalMarksTable)
      .where(and(eq(journalMarksTable.studentId, studentId), gte(journalMarksTable.date, prevFrom))).orderBy(desc(journalMarksTable.date)),
    db.select({ date: attendanceTable.attendanceDate, subject: attendanceTable.subject, status: attendanceTable.status }).from(attendanceTable)
      .where(and(eq(attendanceTable.studentId, studentId), gte(attendanceTable.attendanceDate, from))),
    db.select({ id: classMembersTable.classId }).from(classMembersTable).where(and(eq(classMembersTable.userId, studentId), eq(classMembersTable.role, "student"))),
  ]);
  for (const row of marks) row.subject = baseSubject(row.subject);
  const homework = classes.length
    ? await db.select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject, dueAt: assignmentsTable.dueAt, createdAt: assignmentsTable.createdAt }).from(assignmentsTable)
      .where(and(inArray(assignmentsTable.classId, classes.map((item) => item.id)), gte(assignmentsTable.createdAt, new Date(now - 7 * DAY))))
    : [];
  const subs = homework.length
    ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, score: assignmentSubmissionsTable.score }).from(assignmentSubmissionsTable)
      .where(and(eq(assignmentSubmissionsTable.studentId, studentId), inArray(assignmentSubmissionsTable.assignmentId, homework.map((item) => item.id))))
    : [];
  const week = marks.filter((row) => row.date >= from && row.mark !== null);
  const before = marks.filter((row) => row.date < from && row.mark !== null);
  const subjects = [...new Set(week.map((row) => row.subject))].map((subject) => ({ subject, marks: week.filter((row) => row.subject === subject).map((row) => row.mark!), average: avg(week.filter((row) => row.subject === subject).map((row) => row.mark!)) }));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    from, to: tashkentNow().date,
    average: avg(week.map((row) => row.mark!)),
    averagePrev: avg(before.map((row) => row.mark!)),
    subjects,
    absences: attendance.filter((row) => row.status === "absent").map((row) => ({ date: row.date, subject: row.subject })),
    late: attendance.filter((row) => row.status === "late").length,
    lessonsMarked: attendance.length,
    homework: homework.map((item) => {
      const sub = subs.find((row) => row.assignmentId === item.id);
      return { id: item.id, title: item.title, subject: item.subject, dueAt: item.dueAt, state: !sub ? "missing" : sub.score === null ? "review" : "graded", grade: sub?.score !== null && sub?.score !== undefined ? gradeOf(sub.score) : null };
    }),
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Tuition (a private school)                                                */
/* -------------------------------------------------------------------------- */

const monthsBetween = (start: string, end: string) => {
  if (!MONTH_RE.test(start) || !MONTH_RE.test(end) || start > end) return [] as string[];
  const out: string[] = [];
  let [year, month] = start.split("-").map(Number) as [number, number];
  while (out.length < 240) {
    const text = `${year}-${String(month).padStart(2, "0")}`;
    out.push(text);
    if (text === end) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
};
const dueOf = (plan: { monthlyFee: number; discountPercent: number }) => Math.round((plan.monthlyFee * (100 - plan.discountPercent)) / 100);

async function financeRows(schoolId: string, month: string) {
  const pupils = await db.select({ id: usersTable.id, name: usersTable.username, status: usersTable.status }).from(schoolMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "student")))
    .orderBy(asc(usersTable.username));
  const classRows = await db.select({ studentId: classMembersTable.userId, name: classesTable.name }).from(classMembersTable)
    .innerJoin(classesTable, eq(classesTable.id, classMembersTable.classId))
    .where(and(eq(classesTable.schoolId, schoolId), eq(classMembersTable.role, "student")));
  const plans = await db.select().from(tuitionPlansTable).where(eq(tuitionPlansTable.schoolId, schoolId));
  const payments = await db.select({ studentId: tuitionPaymentsTable.studentId, amount: tuitionPaymentsTable.amount, month: tuitionPaymentsTable.month })
    .from(tuitionPaymentsTable).where(and(eq(tuitionPaymentsTable.schoolId, schoolId), isNull(tuitionPaymentsTable.cancelledAt)));
  return pupils.map((pupil) => {
    const plan = plans.find((item) => item.studentId === pupil.id) ?? null;
    const mine = payments.filter((item) => item.studentId === pupil.id);
    const due = plan ? dueOf(plan) : 0;
    const months = plan ? monthsBetween(plan.startMonth, month) : [];
    const totalDue = months.length * due;
    const paidUpTo = mine.filter((item) => item.month <= month).reduce((sum, item) => sum + item.amount, 0);
    const paidThisMonth = mine.filter((item) => item.month === month).reduce((sum, item) => sum + item.amount, 0);
    return {
      id: pupil.id, name: pupil.name, status: pupil.status,
      className: classRows.filter((row) => row.studentId === pupil.id).map((row) => row.name).join(", "),
      plan: plan ? { monthlyFee: plan.monthlyFee, discountPercent: plan.discountPercent, startMonth: plan.startMonth, note: plan.note } : null,
      due, paidThisMonth,
      debt: Math.max(0, totalDue - paidUpTo),
      advance: Math.max(0, paidUpTo - totalDue),
    };
  });
}

router.get("/schools/:schoolId/finance", requireAuthenticatedRole(...MANAGERS), async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const month = MONTH_RE.test(String(req.query.month ?? "")) ? String(req.query.month) : tashkentNow().date.slice(0, 7);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  if (!(await isManager(viewerOf(res), schoolId))) { res.status(403).json({ error: "Only the school administration sees payments." }); return; }
  const rows = await financeRows(schoolId, month);
  const recent = await db.select({ id: tuitionPaymentsTable.id, studentId: tuitionPaymentsTable.studentId, name: usersTable.username, amount: tuitionPaymentsTable.amount, month: tuitionPaymentsTable.month, method: tuitionPaymentsTable.method, paidOn: tuitionPaymentsTable.paidOn, receiptNo: tuitionPaymentsTable.receiptNo, note: tuitionPaymentsTable.note, cancelledAt: tuitionPaymentsTable.cancelledAt, cancelReason: tuitionPaymentsTable.cancelReason })
    .from(tuitionPaymentsTable).innerJoin(usersTable, eq(usersTable.id, tuitionPaymentsTable.studentId))
    .where(and(eq(tuitionPaymentsTable.schoolId, schoolId), eq(tuitionPaymentsTable.month, month)))
    .orderBy(desc(tuitionPaymentsTable.receiptNo));
  const [school] = await db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  const billed = rows.filter((row) => row.plan && row.plan.startMonth <= month);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    month, school: school?.name ?? "",
    totals: {
      expected: billed.reduce((sum, row) => sum + row.due, 0),
      collected: recent.filter((row) => !row.cancelledAt).reduce((sum, row) => sum + row.amount, 0),
      debt: rows.reduce((sum, row) => sum + row.debt, 0),
      debtors: rows.filter((row) => row.debt > 0).length,
      withoutPlan: rows.filter((row) => !row.plan && row.status === "active").length,
    },
    students: rows,
    payments: recent,
  });
});

router.put("/schools/:schoolId/finance/plans/:studentId", requireAuthenticatedRole(...MANAGERS), writeLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const studentId = String(req.params.studentId ?? "");
  const body = isRecord(req.body) ? req.body : {};
  const monthlyFee = Math.round(Number(body.monthlyFee));
  const discountPercent = Math.round(Number(body.discountPercent ?? 0));
  const startMonth = str(body.startMonth, 7);
  if (!isValidUuid(schoolId) || !isValidUuid(studentId) || !Number.isFinite(monthlyFee) || monthlyFee < 0 || monthlyFee > 100_000_000
    || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || !MONTH_RE.test(startMonth)) {
    res.status(400).json({ error: "Check the fee, the discount (0–100%) and the first month." });
    return;
  }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration sets fees." }); return; }
  if ((await schoolRole(studentId, schoolId)) !== "student") { res.status(404).json({ error: "No such pupil in the school." }); return; }
  const values = { monthlyFee, discountPercent, startMonth, note: str(body.note, 300), updatedBy: viewer.id, updatedAt: new Date() };
  await db.insert(tuitionPlansTable).values({ schoolId, studentId, ...values })
    .onConflictDoUpdate({ target: [tuitionPlansTable.schoolId, tuitionPlansTable.studentId], set: values });
  await writeAudit(schoolId, viewer.id, "tuition.plan", studentId, { monthlyFee, discountPercent, startMonth });
  res.json({ ok: true });
});

router.post("/schools/:schoolId/finance/payments", requireAuthenticatedRole(...MANAGERS), writeLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const body = isRecord(req.body) ? req.body : {};
  const studentId = str(body.studentId, 40);
  const amount = Math.round(Number(body.amount));
  const month = str(body.month, 7);
  const method = ["cash", "card", "transfer"].includes(String(body.method)) ? String(body.method) : "cash";
  const paidOn = DATE_RE.test(str(body.paidOn, 10)) ? str(body.paidOn, 10) : tashkentNow().date;
  if (!isValidUuid(schoolId) || !isValidUuid(studentId) || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || !MONTH_RE.test(month)) {
    res.status(400).json({ error: "Check the pupil, the sum and the month." });
    return;
  }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration records payments." }); return; }
  if ((await schoolRole(studentId, schoolId)) !== "student") { res.status(404).json({ error: "No such pupil in the school." }); return; }
  // Receipt numbers go one by one in a school; a rare clash (two at once) just retries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [last] = await db.select({ value: max(tuitionPaymentsTable.receiptNo) }).from(tuitionPaymentsTable).where(eq(tuitionPaymentsTable.schoolId, schoolId));
    const receiptNo = (last?.value ?? 0) + 1;
    try {
      const [row] = await db.insert(tuitionPaymentsTable).values({ schoolId, studentId, amount, month, method, paidOn, receiptNo, note: str(body.note, 300), createdBy: viewer.id }).returning();
      await writeAudit(schoolId, viewer.id, "tuition.payment", studentId, { amount, month, receiptNo });
      const parents = await db.select({ id: parentLinksTable.parentId }).from(parentLinksTable).where(eq(parentLinksTable.studentId, studentId));
      await pushNotice(parents.map((item) => item.id), "announcements", `Оплата получена · № ${receiptNo}`, `${amount.toLocaleString("ru-RU")} сум за ${month}`, "/parent");
      res.status(201).json({ payment: row });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
});

router.post("/schools/:schoolId/finance/payments/:paymentId/cancel", requireAuthenticatedRole(...MANAGERS), writeLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const paymentId = String(req.params.paymentId ?? "");
  const reason = str(isRecord(req.body) ? req.body.reason : "", 300);
  if (!isValidUuid(schoolId) || !isValidUuid(paymentId) || reason.length < 3) { res.status(400).json({ error: "Write why the payment is cancelled." }); return; }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration cancels payments." }); return; }
  const [row] = await db.update(tuitionPaymentsTable).set({ cancelledAt: new Date(), cancelledBy: viewer.id, cancelReason: reason })
    .where(and(eq(tuitionPaymentsTable.id, paymentId), eq(tuitionPaymentsTable.schoolId, schoolId), isNull(tuitionPaymentsTable.cancelledAt))).returning();
  if (!row) { res.status(404).json({ error: "The payment is not found or already cancelled." }); return; }
  await writeAudit(schoolId, viewer.id, "tuition.cancel", row.studentId, { receiptNo: row.receiptNo, amount: row.amount, reason });
  res.json({ ok: true });
});

/** One pupil's payment history: for the administration and for the pupil's parents. */
router.get("/students/:studentId/payments", requireAuthenticatedRole("parent", ...MANAGERS), async (req, res) => {
  const studentId = String(req.params.studentId ?? "");
  if (!isValidUuid(studentId)) { res.status(400).json({ error: "Invalid pupil." }); return; }
  const viewer = viewerOf(res);
  const schools = await db.select({ schoolId: schoolMembersTable.schoolId }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.userId, studentId), eq(schoolMembersTable.role, "student")));
  let allowed: string[] = [];
  if (viewer.role === "parent") {
    const [link] = await db.select({ id: parentLinksTable.id }).from(parentLinksTable).where(and(eq(parentLinksTable.parentId, viewer.id), eq(parentLinksTable.studentId, studentId))).limit(1);
    if (link) allowed = schools.map((item) => item.schoolId);
  } else {
    for (const item of schools) if (await isManager(viewer, item.schoolId)) allowed.push(item.schoolId);
  }
  if (!allowed.length) { res.status(403).json({ error: "Not available." }); return; }
  const month = tashkentNow().date.slice(0, 7);
  const plans = await db.select().from(tuitionPlansTable).where(and(eq(tuitionPlansTable.studentId, studentId), inArray(tuitionPlansTable.schoolId, allowed)));
  const payments = await db.select({ id: tuitionPaymentsTable.id, amount: tuitionPaymentsTable.amount, month: tuitionPaymentsTable.month, method: tuitionPaymentsTable.method, paidOn: tuitionPaymentsTable.paidOn, receiptNo: tuitionPaymentsTable.receiptNo, cancelledAt: tuitionPaymentsTable.cancelledAt })
    .from(tuitionPaymentsTable).where(and(eq(tuitionPaymentsTable.studentId, studentId), inArray(tuitionPaymentsTable.schoolId, allowed)))
    .orderBy(desc(tuitionPaymentsTable.paidOn), desc(tuitionPaymentsTable.receiptNo)).limit(60);
  const plan = plans[0] ?? null;
  const valid = payments.filter((item) => !item.cancelledAt);
  const totalDue = plan ? monthsBetween(plan.startMonth, month).length * dueOf(plan) : 0;
  const paid = valid.filter((item) => item.month <= month).reduce((sum, item) => sum + item.amount, 0);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    plan: plan ? { monthlyFee: plan.monthlyFee, discountPercent: plan.discountPercent, due: dueOf(plan), startMonth: plan.startMonth } : null,
    debt: Math.max(0, totalDue - paid),
    payments: viewer.role === "parent" ? valid : payments,
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Timetable changes                                                         */
/* -------------------------------------------------------------------------- */

router.get("/schools/:schoolId/timetable-changes", requireAuthenticatedRole(...STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  if (!isGlobalAdminRole(viewer.role) && !(await schoolRole(viewer.id, schoolId))) { res.status(403).json({ error: "Not your school." }); return; }
  const from = DATE_RE.test(String(req.query.from ?? "")) ? String(req.query.from) : tashkentNow().date;
  const to = DATE_RE.test(String(req.query.to ?? "")) ? String(req.query.to) : dayText(Date.now() + 14 * DAY);
  const rows = await db.select({
    id: timetableChangesTable.id, classId: timetableChangesTable.classId, className: classesTable.name, date: timetableChangesTable.date, period: timetableChangesTable.period,
    kind: timetableChangesTable.kind, teacherId: timetableChangesTable.teacherId, room: timetableChangesTable.room, note: timetableChangesTable.note, teacherName: usersTable.username,
  }).from(timetableChangesTable)
    .innerJoin(classesTable, eq(classesTable.id, timetableChangesTable.classId))
    .leftJoin(usersTable, eq(usersTable.id, timetableChangesTable.teacherId))
    .where(and(eq(timetableChangesTable.schoolId, schoolId), gte(timetableChangesTable.date, from), lte(timetableChangesTable.date, to)))
    .orderBy(asc(timetableChangesTable.date), asc(timetableChangesTable.period));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ from, to, changes: rows });
});

router.put("/schools/:schoolId/timetable-changes", requireAuthenticatedRole(...MANAGERS), writeLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const body = isRecord(req.body) ? req.body : {};
  const classId = str(body.classId, 40);
  const date = str(body.date, 10);
  const period = Number(body.period);
  const kind = ["substitute", "cancelled", "room"].includes(String(body.kind)) ? String(body.kind) : "";
  const teacherId = str(body.teacherId, 40) || null;
  const room = str(body.room, 40) || null;
  if (!isValidUuid(schoolId) || !isValidUuid(classId) || !DATE_RE.test(date) || !Number.isInteger(period) || period < 1 || period > 10 || !kind
    || (kind === "substitute" && (!teacherId || !isValidUuid(teacherId))) || (kind === "room" && !room) || date < dayText(Date.now() - DAY)) {
    res.status(400).json({ error: "Choose the class, the day (today or later), the lesson and what changes." });
    return;
  }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration changes the timetable." }); return; }
  const [klass] = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(and(eq(classesTable.id, classId), eq(classesTable.schoolId, schoolId))).limit(1);
  if (!klass) { res.status(404).json({ error: "No such class." }); return; }
  if (kind === "substitute" && (await schoolRole(teacherId!, schoolId)) !== "teacher") { res.status(400).json({ error: "The substitute must be a teacher of the school." }); return; }
  const values = { schoolId, kind, teacherId: kind === "substitute" ? teacherId : null, room: kind === "room" ? room : null, note: str(body.note, 200), createdBy: viewer.id, createdAt: new Date() };
  const [row] = await db.insert(timetableChangesTable).values({ classId, date, period, ...values })
    .onConflictDoUpdate({ target: [timetableChangesTable.classId, timetableChangesTable.date, timetableChangesTable.period], set: values }).returning();
  await writeAudit(schoolId, viewer.id, "timetable.change", teacherId, { classId, date, period, kind });
  // Pupils, their parents and the teachers involved see it at once.
  const weekday = (() => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; })();
  const [slot] = await db.select({ teacherId: timetableSlotsTable.teacherId, subject: timetableSlotsTable.subject }).from(timetableSlotsTable)
    .where(and(eq(timetableSlotsTable.classId, classId), eq(timetableSlotsTable.weekday, weekday), eq(timetableSlotsTable.period, period))).limit(1);
  const pupils = await db.select({ id: classMembersTable.userId }).from(classMembersTable).where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")));
  const parents = pupils.length ? await db.select({ id: parentLinksTable.parentId }).from(parentLinksTable).where(inArray(parentLinksTable.studentId, pupils.map((item) => item.id))) : [];
  const text = kind === "cancelled" ? "урок отменён" : kind === "room" ? `урок в кабинете ${room}` : "замена учителя";
  await pushNotice([...pupils.map((item) => item.id), ...parents.map((item) => item.id), ...(slot?.teacherId ? [slot.teacherId] : []), ...(teacherId ? [teacherId] : [])],
    "lessons", `Изменение расписания · ${klass.name}`, `${date}, ${period}-й урок${slot?.subject ? ` (${slot.subject})` : ""}: ${text}${values.note ? `. ${values.note}` : ""}`, "/schedule");
  res.json({ change: row });
});

router.delete("/schools/:schoolId/timetable-changes/:changeId", requireAuthenticatedRole(...MANAGERS), writeLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  const changeId = String(req.params.changeId ?? "");
  if (!isValidUuid(schoolId) || !isValidUuid(changeId)) { res.status(400).json({ error: "Invalid change." }); return; }
  const viewer = viewerOf(res);
  if (!(await isManager(viewer, schoolId))) { res.status(403).json({ error: "Only the school administration changes the timetable." }); return; }
  const [row] = await db.delete(timetableChangesTable).where(and(eq(timetableChangesTable.id, changeId), eq(timetableChangesTable.schoolId, schoolId))).returning();
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  await writeAudit(schoolId, viewer.id, "timetable.change.removed", null, { classId: row.classId, date: row.date, period: row.period, kind: row.kind });
  res.json({ ok: true });
});

export default router;
