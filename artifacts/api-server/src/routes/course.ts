import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  bookAnnotationsTable,
  classMembersTable,
  classesTable,
  coursePaceTable,
  courseProgressTable,
  db,
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
  const [progress, pace] = await Promise.all([
    db.select({ topicKey: courseProgressTable.topicKey, doneOn: courseProgressTable.doneOn }).from(courseProgressTable).where(eq(courseProgressTable.classId, classId)).orderBy(asc(courseProgressTable.doneOn)),
    db.select({ book: coursePaceTable.book, lessonsPerWeek: coursePaceTable.lessonsPerWeek }).from(coursePaceTable).where(eq(coursePaceTable.classId, classId)),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ progress, pace, canEdit: access.edit });
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

export default router;
