import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  classMembersTable,
  classesTable,
  db,
  parentLinksTable,
  schoolBellsTable,
  schoolMembersTable,
  timetableSlotsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { writeAudit } from "../lib/audit";
import { remindTrainer } from "./course";

/**
 * Weekly timetable and "today's lessons".
 *  - The director / deputy (or EDUVERSE) keeps the timetable: weekday, period, class, subject, teacher.
 *  - Everyone gets their own lessons for today: a teacher the lessons they teach, a pupil the lessons
 *    of their class, a parent the lessons of their children, the director the whole school.
 * Today and the lesson times are counted in Tashkent time (UTC+5, no daylight saving).
 */
const router: IRouter = Router();

type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const MANAGERS = ["school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;

export const TASHKENT_OFFSET_MIN = 5 * 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SUBJECT_RE = /^[\p{L}\p{N} .,'’()\-/]{1,40}$/u;
const MAX_PERIODS = 10;

export const DEFAULT_BELLS = [
  { start: "08:30", end: "09:15" },
  { start: "09:25", end: "10:10" },
  { start: "10:20", end: "11:05" },
  { start: "11:20", end: "12:05" },
  { start: "12:15", end: "13:00" },
  { start: "13:10", end: "13:55" },
  { start: "14:05", end: "14:50" },
];

type Bell = { start: string; end: string };

/** Today in Tashkent: the date (YYYY-MM-DD), weekday (1 = Monday … 7 = Sunday) and minutes since midnight. */
export function tashkentNow(now = new Date()) {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MIN * 60 * 1000);
  const date = local.toISOString().slice(0, 10);
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  return { date, weekday, minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** "2026-11-19" + "08:30" in Tashkent → an exact moment (ISO, UTC). */
function atTashkent(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:00`).toISOString();
}

function cleanBells(value: unknown): Bell[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PERIODS) return null;
  const out: Bell[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.start !== "string" || typeof item.end !== "string") return null;
    if (!TIME_RE.test(item.start) || !TIME_RE.test(item.end) || item.start >= item.end) return null;
    if (out.length && out[out.length - 1]!.end > item.start) return null;
    out.push({ start: item.start, end: item.end });
  }
  return out;
}

async function bellsOf(schoolId: string): Promise<Bell[]> {
  const [row] = await db.select({ periods: schoolBellsTable.periods }).from(schoolBellsTable).where(eq(schoolBellsTable.schoolId, schoolId)).limit(1);
  return cleanBells(row?.periods) ?? DEFAULT_BELLS;
}

async function schoolRoleOf(userId: string, schoolId: string): Promise<string | null> {
  const [row] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId))).limit(1);
  return row?.role ?? null;
}
async function canRead(viewer: Viewer, schoolId: string) {
  return isGlobalAdminRole(viewer.role) || Boolean(await schoolRoleOf(viewer.id, schoolId));
}
async function canEdit(viewer: Viewer, schoolId: string) {
  if (isGlobalAdminRole(viewer.role)) return true;
  const role = await schoolRoleOf(viewer.id, schoolId);
  return role === "school_director" || role === "school_admin";
}

const editLimiter = createRateLimiter(120, 10 * 60 * 1000, "Too many changes. Try again later.", "timetable");

async function loadTimetable(schoolId: string) {
  const [slots, classes, teachers, bells] = await Promise.all([
    db.select({ id: timetableSlotsTable.id, classId: timetableSlotsTable.classId, weekday: timetableSlotsTable.weekday, period: timetableSlotsTable.period, subject: timetableSlotsTable.subject, teacherId: timetableSlotsTable.teacherId, room: timetableSlotsTable.room })
      .from(timetableSlotsTable).where(eq(timetableSlotsTable.schoolId, schoolId))
      .orderBy(asc(timetableSlotsTable.weekday), asc(timetableSlotsTable.period)),
    db.select({ id: classesTable.id, name: classesTable.name, grade: classesTable.grade }).from(classesTable).where(eq(classesTable.schoolId, schoolId)).orderBy(asc(classesTable.name)),
    db.select({ id: usersTable.id, name: usersTable.username, subjects: usersTable.subjects })
      .from(schoolMembersTable).innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
      .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "teacher")))
      .orderBy(asc(usersTable.username)),
    bellsOf(schoolId),
  ]);
  return { slots, classes, teachers, bells };
}

router.get("/schools/:schoolId/timetable", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  if (!(await canRead(viewer, schoolId))) { res.status(403).json({ error: "Not your school." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ...(await loadTimetable(schoolId)), canEdit: await canEdit(viewer, schoolId) });
});

/** Replaces the whole timetable (and the bell times) of a school. */
router.put("/schools/:schoolId/timetable", requireAuthenticatedRole(...MANAGERS), editLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  if (!(await canEdit(viewer, schoolId))) { res.status(403).json({ error: "Only the director or deputy changes the timetable." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const bells = body.bells === undefined ? await bellsOf(schoolId) : cleanBells(body.bells);
  if (!bells) { res.status(400).json({ error: "Check the bell times." }); return; }
  if (!Array.isArray(body.slots) || body.slots.length > 2000) { res.status(400).json({ error: "Invalid timetable." }); return; }
  const { classes, teachers } = await loadTimetable(schoolId);
  const classIds = new Set(classes.map((item) => item.id));
  const teacherIds = new Set(teachers.map((item) => item.id));
  const seen = new Set<string>();
  const rows: Array<typeof timetableSlotsTable.$inferInsert> = [];
  for (const item of body.slots) {
    if (!isRecord(item)) { res.status(400).json({ error: "Invalid lesson." }); return; }
    const classId = String(item.classId ?? "");
    const weekday = Number(item.weekday);
    const period = Number(item.period);
    const subject = typeof item.subject === "string" ? item.subject.trim() : "";
    const teacherId = typeof item.teacherId === "string" && item.teacherId ? item.teacherId : null;
    const room = typeof item.room === "string" ? item.room.trim().slice(0, 20) || null : null;
    if (!classIds.has(classId) || !Number.isInteger(weekday) || weekday < 1 || weekday > 6 || !Number.isInteger(period) || period < 1 || period > bells.length || !SUBJECT_RE.test(subject)) {
      res.status(400).json({ error: "A lesson has a wrong class, day, period or subject." });
      return;
    }
    if (teacherId && !teacherIds.has(teacherId)) { res.status(400).json({ error: "A lesson has a teacher from another school." }); return; }
    const key = `${classId}:${weekday}:${period}`;
    if (seen.has(key)) { res.status(400).json({ error: "Two lessons in one class at the same time." }); return; }
    seen.add(key);
    rows.push({ schoolId, classId, weekday, period, subject, teacherId, room });
  }
  // A teacher cannot be in two classes at the same time.
  const busy = new Map<string, string>();
  for (const row of rows) {
    if (!row.teacherId) continue;
    const key = `${row.teacherId}:${row.weekday}:${row.period}`;
    if (busy.has(key)) { res.status(400).json({ error: "One teacher has two lessons at the same time." }); return; }
    busy.set(key, row.classId);
  }
  await db.transaction(async (tx) => {
    await tx.delete(timetableSlotsTable).where(eq(timetableSlotsTable.schoolId, schoolId));
    if (rows.length) await tx.insert(timetableSlotsTable).values(rows);
    await tx.insert(schoolBellsTable).values({ schoolId, periods: bells, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schoolBellsTable.schoolId, set: { periods: bells, updatedAt: new Date() } });
  });
  await writeAudit(schoolId, viewer.id, "timetable", null, { lessons: rows.length });
  res.json({ ...(await loadTimetable(schoolId)), canEdit: true });
});

/**
 * Fills an example timetable for every class (Monday to Saturday), for showing the school.
 * Each teacher gets their own subjects (from the profile, else shared out in turn) and teaches
 * them in every class; classes are shifted so one teacher is never in two places at once.
 */
export async function fillDemoTimetable(schoolId: string): Promise<number> {
  const classes = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(eq(classesTable.schoolId, schoolId)).orderBy(asc(classesTable.name));
  if (!classes.length) return 0;
  const teachers = await db
    .select({ id: usersTable.id, subjects: usersTable.subjects })
    .from(schoolMembersTable).innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "teacher")))
    .orderBy(asc(usersTable.username));
  const SUBJECTS = ["math", "physics", "chemistry", "biology"] as const;
  const SUBJECT_RU: Record<string, string> = { math: "матем", physics: "физик", chemistry: "хими", biology: "биолог" };
  const teaches = (teacher: { subjects: unknown }, subject: string) =>
    Array.isArray(teacher.subjects) && teacher.subjects.some((item) => typeof item === "string" && item.toLowerCase().includes(SUBJECT_RU[subject]!));
  // Who teaches what: the profile first, else subjects shared out between the teachers.
  const ownerOf = new Map<string, string[]>();
  SUBJECTS.forEach((subject, index) => {
    const own = teachers.filter((teacher) => teaches(teacher, subject)).map((teacher) => teacher.id);
    const fallback = teachers.length ? [teachers[index % teachers.length]!.id] : [];
    ownerOf.set(subject, own.length ? own : fallback);
  });
  // A week of 5 lessons a day (4 on Saturday): maths most often, the sciences in turn.
  const WEEK: string[][] = [
    ["math", "physics", "chemistry", "math", "biology"],
    ["chemistry", "math", "biology", "physics", "math"],
    ["math", "biology", "physics", "math", "chemistry"],
    ["physics", "math", "chemistry", "biology", "math"],
    ["biology", "chemistry", "math", "physics", "math"],
    ["math", "physics", "biology", "chemistry"],
  ];
  const rows: Array<typeof timetableSlotsTable.$inferInsert> = [];
  const busy = new Set<string>();
  classes.forEach((klass, classIndex) => {
    WEEK.forEach((day, dayIndex) => {
      const weekday = dayIndex + 1;
      day.forEach((_, period0) => {
        const period = period0 + 1;
        // Shift each next class by one lesson so the same teacher is free.
        let subject = day[(period0 + classIndex) % day.length]!;
        let teacherId: string | null = null;
        for (let attempt = 0; attempt < day.length && !teacherId; attempt += 1) {
          subject = day[(period0 + classIndex + attempt) % day.length]!;
          teacherId = (ownerOf.get(subject) ?? []).find((id) => !busy.has(`${id}:${weekday}:${period}`)) ?? null;
        }
        if (teacherId) busy.add(`${teacherId}:${weekday}:${period}`);
        rows.push({ schoolId, classId: klass.id, weekday, period, subject, teacherId, room: String(201 + classIndex) });
      });
    });
  });
  await db.transaction(async (tx) => {
    await tx.delete(timetableSlotsTable).where(eq(timetableSlotsTable.schoolId, schoolId));
    if (rows.length) await tx.insert(timetableSlotsTable).values(rows);
    await tx.insert(schoolBellsTable).values({ schoolId, periods: DEFAULT_BELLS }).onConflictDoNothing();
  });
  return rows.length;
}

router.post("/schools/:schoolId/timetable/demo", requireAuthenticatedRole(...MANAGERS), editLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  if (!(await canEdit(viewer, schoolId))) { res.status(403).json({ error: "Only the director or deputy changes the timetable." }); return; }
  const count = await fillDemoTimetable(schoolId);
  await writeAudit(schoolId, viewer.id, "timetable", null, { lessons: count, demo: true });
  res.json({ ...(await loadTimetable(schoolId)), canEdit: true });
});

/** The viewer's lessons for today (Tashkent), in time order. */
router.get("/me/today", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const now = tashkentNow();
  res.setHeader("Cache-Control", "private, no-store");
  const base = { date: now.date, weekday: now.weekday, now: new Date().toISOString(), week: [] as Array<{ classId: string; subject: string }> };

  // Which slots this person should see.
  let where: SQL | undefined;
  if (viewer.role === "teacher") {
    where = eq(timetableSlotsTable.teacherId, viewer.id);
  } else if (viewer.role === "student" || viewer.role === "parent") {
    const studentIds = viewer.role === "student"
      ? [viewer.id]
      : (await db.select({ id: parentLinksTable.studentId }).from(parentLinksTable).where(eq(parentLinksTable.parentId, viewer.id))).map((row) => row.id);
    if (!studentIds.length) { res.json({ ...base, lessons: [], next: [] }); return; }
    const classIds = (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
      .where(and(inArray(classMembersTable.userId, studentIds), eq(classMembersTable.role, "student")))).map((row) => row.id);
    if (!classIds.length) { res.json({ ...base, lessons: [], next: [] }); return; }
    where = inArray(timetableSlotsTable.classId, [...new Set(classIds)]);
  } else {
    const schoolIds = (await db.select({ id: schoolMembersTable.schoolId }).from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.userId, viewer.id), inArray(schoolMembersTable.role, ["school_director", "school_admin"])))).map((row) => row.id);
    if (!schoolIds.length) { res.json({ ...base, lessons: [], next: [] }); return; }
    where = inArray(timetableSlotsTable.schoolId, schoolIds);
  }

  // Class and subject pairs of the whole week (the trainer asks only these).
  const weekRows = await db.selectDistinct({ classId: timetableSlotsTable.classId, subject: timetableSlotsTable.subject }).from(timetableSlotsTable).where(where);
  base.week = weekRows;
  const teacherNames = new Map<string, string>();
  const bellCache = new Map<string, Bell[]>();
  async function lessonsOn(date: string, weekday: number) {
    if (weekday === 7) return [];
    const slots = await db
      .select({
        id: timetableSlotsTable.id, schoolId: timetableSlotsTable.schoolId, classId: timetableSlotsTable.classId,
        period: timetableSlotsTable.period, subject: timetableSlotsTable.subject, room: timetableSlotsTable.room,
        teacherId: timetableSlotsTable.teacherId, className: classesTable.name, grade: classesTable.grade,
      })
      .from(timetableSlotsTable)
      .innerJoin(classesTable, eq(classesTable.id, timetableSlotsTable.classId))
      .where(and(where, eq(timetableSlotsTable.weekday, weekday)))
      .orderBy(asc(timetableSlotsTable.period), asc(classesTable.name));
    const missing = [...new Set(slots.map((slot) => slot.teacherId).filter((id): id is string => Boolean(id) && !teacherNames.has(id!)))];
    if (missing.length) for (const row of await db.select({ id: usersTable.id, name: usersTable.username }).from(usersTable).where(inArray(usersTable.id, missing))) teacherNames.set(row.id, row.name);
    const out = [];
    for (const slot of slots) {
      if (!bellCache.has(slot.schoolId)) bellCache.set(slot.schoolId, await bellsOf(slot.schoolId));
      const bell = bellCache.get(slot.schoolId)![slot.period - 1];
      if (!bell) continue;
      out.push({
        id: slot.id, classId: slot.classId, className: slot.className, grade: slot.grade, period: slot.period,
        subject: slot.subject, room: slot.room, teacherName: slot.teacherId ? teacherNames.get(slot.teacherId) ?? "" : "",
        start: bell.start, end: bell.end, startsAt: atTashkent(date, bell.start), endsAt: atTashkent(date, bell.end),
      });
    }
    out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className));
    return out;
  }
  const lessons = await lessonsOn(now.date, now.weekday);
  // The next two school days (Sunday skipped): for "tomorrow" and the online lesson topics.
  const next: Array<{ date: string; weekday: number; lessons: Awaited<ReturnType<typeof lessonsOn>> }> = [];
  for (let offset = 1; next.length < 2 && offset <= 4; offset += 1) {
    const day = tashkentNow(new Date(Date.now() + offset * 86400000));
    if (day.weekday === 7) continue;
    next.push({ date: day.date, weekday: day.weekday, lessons: await lessonsOn(day.date, day.weekday) });
  }
  // The school day before (for the trainer: a test can be done within 24 hours of the lesson).
  let prev: { date: string; weekday: number; lessons: Awaited<ReturnType<typeof lessonsOn>> } | null = null;
  for (let offset = 1; !prev && offset <= 3; offset += 1) {
    const day = tashkentNow(new Date(Date.now() - offset * 86400000));
    if (day.weekday === 7) continue;
    prev = { date: day.date, weekday: day.weekday, lessons: await lessonsOn(day.date, day.weekday) };
  }
  if (viewer.role === "teacher") void remindTrainer(viewer.id, now.date, lessons);
  res.json({ ...base, lessons, next, prev });
  return;
});

export default router;
