import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  bookAnnotationsTable,
  classMembersTable,
  classesTable,
  coursePaceTable,
  courseProgressTable,
  db,
  schoolCalendarTable,
  trainerResultsTable,
  usersTable,
  schoolMembersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { canManageClass, isGlobalAdminRole, isValidUuid } from "../lib/school-access";

const router: IRouter = Router();

type RequestUser = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as RequestUser;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const perSession = (req: { cookies?: Record<string, unknown>; ip?: string }) => {
  const token = req.cookies?.["eduverse.sid"];
  return typeof token === "string" && token ? `sid:${token.slice(0, 64)}` : `ip:${req.ip ?? "unknown"}`;
};
const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;

const BOOK_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9.\-]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* -------------------------------------------------------------------------- */
/* 1. Drawings on top of textbook pages (private to each user)                 */
/* -------------------------------------------------------------------------- */

type Stroke = { c: string; w: number; m: "pen" | "marker"; p: number[] };
const MAX_STROKES = 400;
const MAX_POINTS = 1600; // numbers per stroke (x,y pairs)
const MAX_JSON = 300 * 1024;

function cleanStrokes(value: unknown): Stroke[] | null {
  if (!Array.isArray(value) || value.length > MAX_STROKES) return null;
  const out: Stroke[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const c = typeof item.c === "string" && /^#[0-9a-fA-F]{6}$/.test(item.c) ? item.c : null;
    const w = typeof item.w === "number" && Number.isFinite(item.w) ? Math.min(0.06, Math.max(0.0005, item.w)) : null;
    const m = item.m === "marker" ? "marker" : item.m === "pen" ? "pen" : null;
    if (!c || w === null || !m || !Array.isArray(item.p) || item.p.length < 2 || item.p.length > MAX_POINTS || item.p.length % 2) return null;
    const p: number[] = [];
    for (const n of item.p) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      p.push(Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000);
    }
    out.push({ c, w: Math.round(w * 100000) / 100000, m, p });
  }
  return out;
}

const annotationLimiter = createRateLimiter(240, 10 * 60 * 1000, "Too many saves. Try again in a minute.", "annotations", perSession);

router.get("/me/annotations/:book", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const book = String(req.params.book ?? "");
  if (!BOOK_RE.test(book)) { res.status(400).json({ error: "Invalid book." }); return; }
  const viewer = viewerOf(res);
  const rows = await db
    .select({ page: bookAnnotationsTable.page, count: sql<number>`jsonb_array_length(${bookAnnotationsTable.strokes})` })
    .from(bookAnnotationsTable)
    .where(and(eq(bookAnnotationsTable.userId, viewer.id), eq(bookAnnotationsTable.book, book)))
    .orderBy(asc(bookAnnotationsTable.page));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ pages: rows.filter((row) => Number(row.count) > 0).map((row) => ({ page: row.page, strokes: Number(row.count) })) });
});

router.get("/me/annotations/:book/:page", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const book = String(req.params.book ?? "");
  const page = Number(req.params.page);
  if (!BOOK_RE.test(book) || !Number.isInteger(page) || page < 1 || page > 2000) { res.status(400).json({ error: "Invalid page." }); return; }
  const viewer = viewerOf(res);
  const [row] = await db
    .select({ strokes: bookAnnotationsTable.strokes, updatedAt: bookAnnotationsTable.updatedAt })
    .from(bookAnnotationsTable)
    .where(and(eq(bookAnnotationsTable.userId, viewer.id), eq(bookAnnotationsTable.book, book), eq(bookAnnotationsTable.page, page)))
    .limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ strokes: Array.isArray(row?.strokes) ? row.strokes : [], updatedAt: row?.updatedAt ?? null });
});

router.put("/me/annotations/:book/:page", requireAuthenticatedRole(...everyRole), annotationLimiter, async (req, res) => {
  const book = String(req.params.book ?? "");
  const page = Number(req.params.page);
  if (!BOOK_RE.test(book) || !Number.isInteger(page) || page < 1 || page > 2000) { res.status(400).json({ error: "Invalid page." }); return; }
  const strokes = cleanStrokes(isRecord(req.body) ? req.body.strokes : null);
  if (!strokes || JSON.stringify(strokes).length > MAX_JSON) { res.status(400).json({ error: "The drawing is too large or invalid." }); return; }
  const viewer = viewerOf(res);
  const now = new Date();
  await db
    .insert(bookAnnotationsTable)
    .values({ userId: viewer.id, book, page, strokes, updatedAt: now })
    .onConflictDoUpdate({ target: [bookAnnotationsTable.userId, bookAnnotationsTable.book, bookAnnotationsTable.page], set: { strokes, updatedAt: now } });
  res.json({ saved: true, strokes: strokes.length, updatedAt: now });
});

/* -------------------------------------------------------------------------- */
/* 2. Where the class stopped in each textbook (+ lessons per week)             */
/* -------------------------------------------------------------------------- */

async function classAccess(viewer: RequestUser, classId: string): Promise<{ read: boolean; edit: boolean }> {
  const [klass] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!klass) return { read: false, edit: false };
  if (isGlobalAdminRole(viewer.role)) return { read: true, edit: true };
  const [schoolRow] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, klass.schoolId), eq(schoolMembersTable.userId, viewer.id)))
    .limit(1);
  const [classRow] = await db
    .select({ role: classMembersTable.role })
    .from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, viewer.id)))
    .limit(1);
  const edit = canManageClass(viewer.role, schoolRow?.role ?? null, classRow?.role ?? null);
  return { read: edit || Boolean(classRow), edit };
}

const progressLimiter = createRateLimiter(200, 10 * 60 * 1000, "Too many changes. Try again later.", "course-progress", perSession);

router.get("/classes/:classId/course", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const classId = String(req.params.classId ?? "");
  if (!isValidUuid(classId)) { res.status(400).json({ error: "Invalid class." }); return; }
  const access = await classAccess(viewerOf(res), classId);
  if (!access.read) { res.status(403).json({ error: "You are not in this class." }); return; }
  const [klass] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  const [progress, pace, calendar] = await Promise.all([
    db.select({ topicKey: courseProgressTable.topicKey, doneOn: courseProgressTable.doneOn }).from(courseProgressTable).where(eq(courseProgressTable.classId, classId)).orderBy(asc(courseProgressTable.doneOn)),
    db.select({ book: coursePaceTable.book, lessonsPerWeek: coursePaceTable.lessonsPerWeek }).from(coursePaceTable).where(eq(coursePaceTable.classId, classId)),
    klass ? loadCalendar(klass.schoolId) : Promise.resolve(null),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ progress, pace, calendar, canEdit: access.edit });
});

router.put("/classes/:classId/course/:topicKey", requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), progressLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const topicKey = String(req.params.topicKey ?? "");
  const doneOn = isRecord(req.body) && typeof req.body.doneOn === "string" ? req.body.doneOn : "";
  if (!isValidUuid(classId) || !TOPIC_RE.test(topicKey) || !DATE_RE.test(doneOn) || Number.isNaN(Date.parse(doneOn))) {
    res.status(400).json({ error: "Invalid topic or date." });
    return;
  }
  const viewer = viewerOf(res);
  const access = await classAccess(viewer, classId);
  if (!access.edit) { res.status(403).json({ error: "Only the class teacher can mark topics." }); return; }
  await db
    .insert(courseProgressTable)
    .values({ classId, topicKey, doneOn, markedBy: viewer.id })
    .onConflictDoUpdate({ target: [courseProgressTable.classId, courseProgressTable.topicKey], set: { doneOn, markedBy: viewer.id } });
  res.json({ topicKey, doneOn });
});

router.delete("/classes/:classId/course/:topicKey", requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), progressLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const topicKey = String(req.params.topicKey ?? "");
  if (!isValidUuid(classId) || !TOPIC_RE.test(topicKey)) { res.status(400).json({ error: "Invalid topic." }); return; }
  const access = await classAccess(viewerOf(res), classId);
  if (!access.edit) { res.status(403).json({ error: "Only the class teacher can mark topics." }); return; }
  await db.delete(courseProgressTable).where(and(eq(courseProgressTable.classId, classId), eq(courseProgressTable.topicKey, topicKey)));
  res.json({ removed: true });
});

router.put("/classes/:classId/course-pace/:book", requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), progressLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const book = String(req.params.book ?? "");
  const lessonsPerWeek = isRecord(req.body) ? Number(req.body.lessonsPerWeek) : NaN;
  if (!isValidUuid(classId) || !BOOK_RE.test(book) || !Number.isInteger(lessonsPerWeek) || lessonsPerWeek < 1 || lessonsPerWeek > 10) {
    res.status(400).json({ error: "Lessons per week must be 1 to 10." });
    return;
  }
  const access = await classAccess(viewerOf(res), classId);
  if (!access.edit) { res.status(403).json({ error: "Only the class teacher can change this." }); return; }
  const now = new Date();
  await db
    .insert(coursePaceTable)
    .values({ classId, book, lessonsPerWeek, updatedAt: now })
    .onConflictDoUpdate({ target: [coursePaceTable.classId, coursePaceTable.book], set: { lessonsPerWeek, updatedAt: now } });
  res.json({ book, lessonsPerWeek });
});

/* -------------------------------------------------------------------------- */
/* 3. The school's calendar: quarters and days off                             */
/* -------------------------------------------------------------------------- */

type Quarter = { start: string; end: string };
type Holiday = { from: string; to: string; name: string };

const validDate = (value: unknown): value is string => typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));

async function loadCalendar(schoolId: string): Promise<{ quarters: Quarter[]; holidays: Holiday[] } | null> {
  const [row] = await db.select({ quarters: schoolCalendarTable.quarters, holidays: schoolCalendarTable.holidays }).from(schoolCalendarTable).where(eq(schoolCalendarTable.schoolId, schoolId)).limit(1);
  return row ? { quarters: row.quarters as Quarter[], holidays: row.holidays as Holiday[] } : null;
}

async function schoolAccess(viewer: RequestUser, schoolId: string): Promise<{ read: boolean; edit: boolean }> {
  if (isGlobalAdminRole(viewer.role)) return { read: true, edit: true };
  const [member] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, viewer.id)))
    .limit(1);
  if (!member) return { read: false, edit: false };
  return { read: true, edit: member.role === "school_director" || member.role === "school_admin" };
}

function readCalendar(body: unknown): { quarters: Quarter[]; holidays: Holiday[] } | null {
  if (!isRecord(body) || !Array.isArray(body.quarters) || body.quarters.length !== 4) return null;
  const quarters: Quarter[] = [];
  for (const item of body.quarters) {
    if (!isRecord(item) || !validDate(item.start) || !validDate(item.end) || item.start > item.end) return null;
    if (quarters.length && quarters[quarters.length - 1].end >= item.start) return null;
    quarters.push({ start: item.start, end: item.end });
  }
  const rawHolidays = Array.isArray(body.holidays) ? body.holidays : [];
  if (rawHolidays.length > 40) return null;
  const holidays: Holiday[] = [];
  for (const item of rawHolidays) {
    if (!isRecord(item) || !validDate(item.from) || !validDate(item.to) || item.from > item.to) return null;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 60) : "";
    holidays.push({ from: item.from, to: item.to, name });
  }
  holidays.sort((a, b) => a.from.localeCompare(b.from));
  return { quarters, holidays };
}

router.get("/schools/:schoolId/calendar", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const access = await schoolAccess(viewerOf(res), schoolId);
  if (!access.read) { res.status(403).json({ error: "You are not in this school." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ calendar: await loadCalendar(schoolId), canEdit: access.edit });
});

router.put("/schools/:schoolId/calendar", requireAuthenticatedRole("school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), progressLimiter, async (req, res) => {
  const schoolId = String(req.params.schoolId ?? "");
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const viewer = viewerOf(res);
  const access = await schoolAccess(viewer, schoolId);
  if (!access.edit) { res.status(403).json({ error: "Only the director can change the calendar." }); return; }
  const calendar = readCalendar(req.body);
  if (!calendar) { res.status(400).json({ error: "Four quarters in order, each with a start and end date." }); return; }
  const now = new Date();
  await db
    .insert(schoolCalendarTable)
    .values({ schoolId, quarters: calendar.quarters, holidays: calendar.holidays, updatedBy: viewer.id, updatedAt: now })
    .onConflictDoUpdate({ target: schoolCalendarTable.schoolId, set: { quarters: calendar.quarters, holidays: calendar.holidays, updatedBy: viewer.id, updatedAt: now } });
  res.json({ calendar });
});

/* -------------------------------------------------------------------------- */
/* 4. Daily trainer and the class rating                                        */
/* -------------------------------------------------------------------------- */

const trainerLimiter = createRateLimiter(30, 60 * 60 * 1000, "Too many attempts.", "trainer", perSession);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

async function pupilClass(userId: string): Promise<string | null> {
  const [row] = await db.select({ classId: classMembersTable.classId }).from(classMembersTable)
    .where(and(eq(classMembersTable.userId, userId), eq(classMembersTable.role, "student"))).limit(1);
  return row?.classId ?? null;
}

router.post("/trainer/results", requireAuthenticatedRole("student"), trainerLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const body = isRecord(req.body) ? req.body : {};
  const total = Number(body.total);
  const score = Number(body.score);
  if (!Number.isInteger(total) || total < 1 || total > 20 || !Number.isInteger(score) || score < 0 || score > total) {
    res.status(400).json({ error: "Invalid result." });
    return;
  }
  const day = isoDay(new Date());
  const classId = await pupilClass(viewer.id);
  // One counted attempt a day: the first result stays.
  const [row] = await db.insert(trainerResultsTable).values({ userId: viewer.id, classId, day, score, total }).onConflictDoNothing().returning({ id: trainerResultsTable.id });
  res.status(row ? 201 : 200).json({ counted: Boolean(row), day });
});

router.get("/trainer/rating", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const viewer = viewerOf(res);
  let classId = typeof req.query.classId === "string" && isValidUuid(req.query.classId) ? req.query.classId : null;
  if (viewer.role === "student") classId = await pupilClass(viewer.id);
  if (!classId) { res.json({ rating: [], doneToday: false }); return; }
  if (viewer.role !== "student") {
    const access = await classAccess(viewer, classId);
    if (!access.read) { res.status(403).json({ error: "Not your class." }); return; }
  }
  const since = isoDay(new Date(Date.now() - 6 * 86400000));
  const rows = await db
    .select({ userId: trainerResultsTable.userId, name: usersTable.username, points: sql<number>`sum(${trainerResultsTable.score})::int`, days: sql<number>`count(*)::int` })
    .from(trainerResultsTable)
    .innerJoin(usersTable, eq(usersTable.id, trainerResultsTable.userId))
    .where(and(eq(trainerResultsTable.classId, classId), gte(trainerResultsTable.day, since)))
    .groupBy(trainerResultsTable.userId, usersTable.username)
    .orderBy(desc(sql`sum(${trainerResultsTable.score})`))
    .limit(30);
  const [today] = await db.select({ id: trainerResultsTable.id }).from(trainerResultsTable)
    .where(and(eq(trainerResultsTable.userId, viewer.id), eq(trainerResultsTable.day, isoDay(new Date())))).limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ rating: rows.map((row) => ({ ...row, me: row.userId === viewer.id })), doneToday: Boolean(today) });
});

export default router;
