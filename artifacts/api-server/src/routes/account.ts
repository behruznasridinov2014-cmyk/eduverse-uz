/**
 * Account centre: personal information, devices and login history,
 * notification settings and the bell, teaching statistics, and the in-app
 * support chat (curator / school administration).
 */
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  classMembersTable,
  classesTable,
  db,
  lessonRoomsTable,
  schoolMembersTable,
  schoolsTable,
  sessionsTable,
  supportMessagesTable,
  userNotificationsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { isValidUuid } from "../lib/school-access";
import { NOTIFY_KINDS, mergePrefs, pushNotice } from "../lib/inbox";

const router: IRouter = Router();

type RequestUser = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as RequestUser;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const perSession = (req: { cookies?: Record<string, unknown>; ip?: string }) => {
  const token = req.cookies?.["eduverse.sid"];
  return typeof token === "string" && token ? `sid:${token.slice(0, 64)}` : `ip:${req.ip ?? "unknown"}`;
};
const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const changeLimiter = createRateLimiter(60, 10 * 60 * 1000, "Too many changes. Try again later.", "account-change", perSession);

/* -------------------------------------------------------------------------- */
/* 1. Personal information                                                      */
/* -------------------------------------------------------------------------- */

router.get("/me/account", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const sessionId = res.locals.sessionId as string | undefined;
  const [me] = await db.select({ email: usersTable.email, subjects: usersTable.subjects, phone: usersTable.phone, twoFactorEnabled: usersTable.twoFactorEnabled }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  const schools = await db.select({ id: schoolsTable.id, name: schoolsTable.name, region: schoolsTable.region, role: schoolMembersTable.role }).from(schoolMembersTable).innerJoin(schoolsTable, eq(schoolMembersTable.schoolId, schoolsTable.id)).where(eq(schoolMembersTable.userId, viewer.id));
  const classes = await db.select({ id: classesTable.id, name: classesTable.name, grade: classesTable.grade, role: classMembersTable.role }).from(classMembersTable).innerJoin(classesTable, eq(classMembersTable.classId, classesTable.id)).where(eq(classMembersTable.userId, viewer.id));
  const [previous] = await db.select({ at: sessionsTable.createdAt }).from(sessionsTable)
    .where(and(eq(sessionsTable.userId, viewer.id), sessionId ? ne(sessionsTable.id, sessionId) : sql`true`))
    .orderBy(desc(sessionsTable.createdAt)).limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    email: me?.email ?? null,
    subjects: Array.isArray(me?.subjects) ? me.subjects : [],
    phone: me?.phone ?? null,
    twoFactorEnabled: Boolean(me?.twoFactorEnabled),
    schools: schools.map((school) => ({ ...school, number: school.name.match(/\d+/)?.[0] ?? null })),
    classes,
    previousLoginAt: previous?.at ?? null,
  });
});

router.put("/me/account", requireAuthenticatedRole(...everyRole), changeLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const body = isRecord(req.body) ? req.body : {};
  const changes: { email?: string | null; subjects?: string[]; updatedAt: Date } = { updatedAt: new Date() };
  if ("email" in body) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) { res.status(400).json({ error: "Invalid email." }); return; }
    changes.email = email || null;
  }
  if ("subjects" in body) {
    if (!Array.isArray(body.subjects) || body.subjects.length > 8) { res.status(400).json({ error: "Up to 8 subjects." }); return; }
    changes.subjects = [...new Set(body.subjects.filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, 40)).filter(Boolean))];
  }
  await db.update(usersTable).set(changes).where(eq(usersTable.id, viewer.id));
  res.json({ saved: true, email: changes.email, subjects: changes.subjects });
});

/* -------------------------------------------------------------------------- */
/* 2. Devices and login history                                                 */
/* -------------------------------------------------------------------------- */

router.get("/me/sessions", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const current = res.locals.sessionId as string | undefined;
  const rows = await db.select({ id: sessionsTable.id, device: sessionsTable.device, ip: sessionsTable.ipMasked, createdAt: sessionsTable.createdAt, lastSeenAt: sessionsTable.lastSeenAt, expiresAt: sessionsTable.expiresAt, revokedAt: sessionsTable.revokedAt })
    .from(sessionsTable).where(eq(sessionsTable.userId, viewer.id)).orderBy(desc(sessionsTable.createdAt)).limit(30);
  const now = Date.now();
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    sessions: rows.map((row) => ({
      id: row.id,
      device: row.device ?? "Неизвестное устройство",
      ip: row.ip,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt ?? row.createdAt,
      active: !row.revokedAt && row.expiresAt.getTime() > now,
      current: row.id === current,
    })),
  });
});

router.delete("/me/sessions/:id", requireAuthenticatedRole(...everyRole), changeLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const id = String(req.params.id ?? "");
  if (!isValidUuid(id)) { res.status(400).json({ error: "Invalid session." }); return; }
  await db.update(sessionsTable).set({ revokedAt: new Date() }).where(and(eq(sessionsTable.id, id), eq(sessionsTable.userId, viewer.id), isNull(sessionsTable.revokedAt)));
  res.json({ revoked: true, current: id === res.locals.sessionId });
});

router.post("/me/sessions/revoke-others", requireAuthenticatedRole(...everyRole), changeLimiter, async (_req, res) => {
  const viewer = viewerOf(res);
  const current = res.locals.sessionId as string;
  const revoked = await db.update(sessionsTable).set({ revokedAt: new Date() })
    .where(and(eq(sessionsTable.userId, viewer.id), ne(sessionsTable.id, current), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, new Date())))
    .returning({ id: sessionsTable.id });
  res.json({ revoked: revoked.length });
});

/* -------------------------------------------------------------------------- */
/* 3. Notification centre                                                       */
/* -------------------------------------------------------------------------- */

router.get("/me/notification-settings", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const [row] = await db.select({ prefs: usersTable.notifyPrefs }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ prefs: mergePrefs(row?.prefs) });
});

router.put("/me/notification-settings", requireAuthenticatedRole(...everyRole), changeLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const [row] = await db.select({ prefs: usersTable.notifyPrefs }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  const prefs = mergePrefs(row?.prefs);
  const input = isRecord(req.body) && isRecord(req.body.prefs) ? req.body.prefs : {};
  for (const key of NOTIFY_KINDS) if (typeof input[key] === "boolean") prefs[key] = input[key] as boolean;
  await db.update(usersTable).set({ notifyPrefs: prefs }).where(eq(usersTable.id, viewer.id));
  res.json({ prefs });
});

router.get("/me/notifications", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const items = await db.select().from(userNotificationsTable).where(eq(userNotificationsTable.userId, viewer.id)).orderBy(desc(userNotificationsTable.createdAt)).limit(30);
  const [count] = await db.select({ n: sql<number>`count(*)` }).from(userNotificationsTable).where(and(eq(userNotificationsTable.userId, viewer.id), isNull(userNotificationsTable.readAt)));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ items: items.map(({ userId: _owner, ...item }) => item), unread: Number(count?.n ?? 0) });
});

router.post("/me/notifications/read-all", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  await db.update(userNotificationsTable).set({ readAt: new Date() }).where(and(eq(userNotificationsTable.userId, viewer.id), isNull(userNotificationsTable.readAt)));
  res.json({ read: true });
});

/* -------------------------------------------------------------------------- */
/* 4. Teaching statistics                                                       */
/* -------------------------------------------------------------------------- */

router.get("/me/teaching-stats", requireAuthenticatedRole("teacher", "school_director", "school_admin"), async (_req, res) => {
  const viewer = viewerOf(res);
  const [lessons] = await db.select({ n: sql<number>`count(*)`, last: sql<Date | null>`max(${lessonRoomsTable.createdAt})` }).from(lessonRoomsTable).where(eq(lessonRoomsTable.hostId, viewer.id));
  const myClasses = await db.select({ classId: classMembersTable.classId }).from(classMembersTable).where(and(eq(classMembersTable.userId, viewer.id), eq(classMembersTable.role, "teacher")));
  const classIds = myClasses.map((row) => row.classId);
  const [students] = classIds.length
    ? await db.select({ n: sql<number>`count(distinct ${classMembersTable.userId})` }).from(classMembersTable).where(and(inArray(classMembersTable.classId, classIds), eq(classMembersTable.role, "student")))
    : [{ n: 0 }];
  const [checked] = await db.select({ n: sql<number>`count(*)`, avg: sql<number | null>`avg(${assignmentSubmissionsTable.score})`, last: sql<Date | null>`max(${assignmentSubmissionsTable.updatedAt})` })
    .from(assignmentSubmissionsTable).innerJoin(assignmentsTable, eq(assignmentSubmissionsTable.assignmentId, assignmentsTable.id))
    .where(and(eq(assignmentsTable.createdBy, viewer.id), eq(assignmentSubmissionsTable.status, "checked")));
  const [assigned] = await db.select({ n: sql<number>`count(*)`, last: sql<Date | null>`max(${assignmentsTable.createdAt})` }).from(assignmentsTable).where(eq(assignmentsTable.createdBy, viewer.id));
  const perClass = classIds.length
    ? await db.select({ classId: assignmentsTable.classId, name: classesTable.name, avg: sql<number | null>`avg(${assignmentSubmissionsTable.score})` })
      .from(assignmentSubmissionsTable).innerJoin(assignmentsTable, eq(assignmentSubmissionsTable.assignmentId, assignmentsTable.id)).innerJoin(classesTable, eq(assignmentsTable.classId, classesTable.id))
      .where(and(inArray(assignmentsTable.classId, classIds), sql`${assignmentSubmissionsTable.score} is not null`))
      .groupBy(assignmentsTable.classId, classesTable.name)
    : [];
  const dates = [lessons?.last, checked?.last, assigned?.last].filter(Boolean).map((d) => new Date(d as Date).getTime());
  const toGrade = (score: number | null | undefined) => (score === null || score === undefined ? null : Math.round(Number(score)) / 10);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    lessons: Number(lessons?.n ?? 0),
    students: Number(students?.n ?? 0),
    assignments: Number(assigned?.n ?? 0),
    checked: Number(checked?.n ?? 0),
    averageGrade: toGrade(checked?.avg),
    classes: perClass.map((row) => ({ id: row.classId, name: row.name, averageGrade: toGrade(row.avg) })),
    lastActivityAt: dates.length ? new Date(Math.max(...dates)) : null,
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Support chat: curator (EDUVERSE) and school administration               */
/* -------------------------------------------------------------------------- */

type Channel = "curator" | "school";
const channelOf = (value: unknown): Channel | null => (value === "curator" || value === "school" ? value : null);
const supportLimiter = createRateLimiter(40, 10 * 60 * 1000, "Too many messages. Try again later.", "support", perSession);
const cleanBody = (value: unknown) => (typeof value === "string" ? value.replace(/\s+$/g, "").trim().slice(0, 1500) : "");

async function schoolOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ schoolId: schoolMembersTable.schoolId }).from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row?.schoolId ?? null;
}
/** Who answers a channel: curators = platform staff; school = director/admin of that school. */
async function staffOf(channel: Channel, schoolId: string | null): Promise<string[]> {
  if (channel === "curator") {
    const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "platform_superadmin"));
    return rows.map((row) => row.id);
  }
  if (!schoolId) return [];
  const rows = await db.select({ id: schoolMembersTable.userId }).from(schoolMembersTable).where(and(eq(schoolMembersTable.schoolId, schoolId), inArray(schoolMembersTable.role, ["school_director", "school_admin"])));
  return rows.map((row) => row.id);
}
async function canStaff(viewer: RequestUser, channel: Channel, threadUserId: string): Promise<boolean> {
  if (channel === "curator") return viewer.role === "platform_superadmin";
  const schoolId = await schoolOf(threadUserId);
  return Boolean(schoolId) && (await staffOf("school", schoolId)).includes(viewer.id);
}
const messageView = (row: typeof supportMessagesTable.$inferSelect) => ({ id: row.id, body: row.body, fromStaff: row.fromStaff, createdAt: row.createdAt });

// the user's own thread
router.get("/support/thread", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const viewer = viewerOf(res);
  const channel = channelOf(req.query.channel) ?? "curator";
  const rows = await db.select().from(supportMessagesTable).where(and(eq(supportMessagesTable.threadUserId, viewer.id), eq(supportMessagesTable.channel, channel))).orderBy(supportMessagesTable.createdAt).limit(200);
  await db.update(supportMessagesTable).set({ readByOwner: true }).where(and(eq(supportMessagesTable.threadUserId, viewer.id), eq(supportMessagesTable.channel, channel), eq(supportMessagesTable.readByOwner, false)));
  const schoolId = channel === "school" ? await schoolOf(viewer.id) : null;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ messages: rows.map(messageView), available: channel === "curator" || Boolean(schoolId) });
});

router.post("/support/thread", requireAuthenticatedRole(...everyRole), supportLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const channel = channelOf(isRecord(req.body) ? req.body.channel : null) ?? "curator";
  const body = cleanBody(isRecord(req.body) ? req.body.body : "");
  if (!body) { res.status(400).json({ error: "Write a message." }); return; }
  const schoolId = await schoolOf(viewer.id);
  if (channel === "school" && !schoolId) { res.status(400).json({ error: "You are not linked to a school yet." }); return; }
  const [created] = await db.insert(supportMessagesTable).values({ threadUserId: viewer.id, channel, schoolId, authorId: viewer.id, fromStaff: false, body, readByOwner: true }).returning();
  const [me] = await db.select({ name: usersTable.username }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  await pushNotice(await staffOf(channel, schoolId), "messages", `Новое сообщение: ${me?.name ?? ""}`, body.slice(0, 140), channel === "curator" ? "/admin" : "/school");
  res.status(201).json({ message: messageView(created!) });
});

// staff inbox
router.get("/support/inbox", requireAuthenticatedRole("platform_superadmin", "school_director", "school_admin"), async (req, res) => {
  const viewer = viewerOf(res);
  const channel: Channel = viewer.role === "platform_superadmin" ? (channelOf(req.query.channel) ?? "curator") : "school";
  let scope = sql`true`;
  if (channel === "school") {
    const schoolId = await schoolOf(viewer.id);
    if (!schoolId) { res.json({ threads: [] }); return; }
    scope = eq(supportMessagesTable.schoolId, schoolId);
  }
  const threads = await db
    .select({
      userId: supportMessagesTable.threadUserId,
      name: usersTable.username,
      role: usersTable.role,
      last: sql<Date>`max(${supportMessagesTable.createdAt})`,
      unread: sql<number>`count(*) filter (where not ${supportMessagesTable.readByStaff} and not ${supportMessagesTable.fromStaff})`,
      preview: sql<string>`(array_agg(${supportMessagesTable.body} order by ${supportMessagesTable.createdAt} desc))[1]`,
    })
    .from(supportMessagesTable)
    .innerJoin(usersTable, eq(supportMessagesTable.threadUserId, usersTable.id))
    .where(and(eq(supportMessagesTable.channel, channel), scope))
    .groupBy(supportMessagesTable.threadUserId, usersTable.username, usersTable.role)
    .orderBy(sql`max(${supportMessagesTable.createdAt}) desc`)
    .limit(100);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ channel, threads: threads.map((row) => ({ ...row, unread: Number(row.unread), preview: (row.preview ?? "").slice(0, 120) })) });
});

router.get("/support/inbox/:userId", requireAuthenticatedRole("platform_superadmin", "school_director", "school_admin"), async (req, res) => {
  const viewer = viewerOf(res);
  const userId = String(req.params.userId ?? "");
  const channel: Channel = viewer.role === "platform_superadmin" ? (channelOf(req.query.channel) ?? "curator") : "school";
  if (!isValidUuid(userId) || !(await canStaff(viewer, channel, userId))) { res.status(403).json({ error: "Not your inbox." }); return; }
  const rows = await db.select().from(supportMessagesTable).where(and(eq(supportMessagesTable.threadUserId, userId), eq(supportMessagesTable.channel, channel))).orderBy(supportMessagesTable.createdAt).limit(200);
  await db.update(supportMessagesTable).set({ readByStaff: true }).where(and(eq(supportMessagesTable.threadUserId, userId), eq(supportMessagesTable.channel, channel), eq(supportMessagesTable.readByStaff, false)));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ messages: rows.map(messageView) });
});

router.post("/support/inbox/:userId", requireAuthenticatedRole("platform_superadmin", "school_director", "school_admin"), supportLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const userId = String(req.params.userId ?? "");
  const channel: Channel = viewer.role === "platform_superadmin" ? (channelOf(isRecord(req.body) ? req.body.channel : null) ?? "curator") : "school";
  const body = cleanBody(isRecord(req.body) ? req.body.body : "");
  if (!body) { res.status(400).json({ error: "Write a message." }); return; }
  if (!isValidUuid(userId) || !(await canStaff(viewer, channel, userId))) { res.status(403).json({ error: "Not your inbox." }); return; }
  const [created] = await db.insert(supportMessagesTable).values({ threadUserId: userId, channel, schoolId: await schoolOf(userId), authorId: viewer.id, fromStaff: true, body, readByStaff: true }).returning();
  await db.update(supportMessagesTable).set({ readByStaff: true }).where(and(eq(supportMessagesTable.threadUserId, userId), eq(supportMessagesTable.channel, channel), eq(supportMessagesTable.readByStaff, false)));
  await pushNotice([userId], "messages", channel === "curator" ? "Ответ куратора EDUVERSE" : "Ответ администрации школы", body.slice(0, 140), "/support");
  res.status(201).json({ message: messageView(created!) });
});

export default router;
