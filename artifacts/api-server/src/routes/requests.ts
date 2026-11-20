import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  auditLogTable,
  classMembersTable,
  classesTable,
  db,
  schoolMembersTable,
  schoolRequestsTable,
  schoolsTable,
  sessionsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";
import { importPeople, readRows, readSubjects, type ImportRow } from "./school-tools";
import { cleanText, isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { writeAudit } from "../lib/audit";
import { pushNotice } from "../lib/inbox";
import { escapeHtml, notifyUsers } from "../lib/notify";
import { userPlan } from "../lib/plans";

/**
 * People of a school:
 *  - the director or deputy makes the change at once (enrol pupils, expel / transfer /
 *    graduate one, restore one, correct details). It is recorded as a done request and in
 *    the journal, and the owner gets a quiet note in the bell (no Telegram);
 *  - the owner can still change a person directly; old pending requests can still be decided.
 * Nothing is deleted: an expelled pupil keeps grades and attendance, only the status changes.
 */
const router: IRouter = Router();

type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const OWNER_ROLES = ["education_admin", "ministry_admin", "platform_superadmin"] as const;
const SCHOOL_STAFF = ["school_director", "school_admin", ...OWNER_ROLES] as const;

export const KINDS = ["enroll", "expel", "transfer", "graduate", "restore", "edit"] as const;
type Kind = (typeof KINDS)[number];
/** Status after each kind. Staff who leave are "disabled", pupils are "expelled". */
const STATUS_OF: Partial<Record<Kind, string>> = { transfer: "transferred", graduate: "graduated", restore: "active" };
/** These statuses cannot sign in any more (graduates keep reading access). */
export const BLOCKED_STATUSES = ["expelled", "transferred", "disabled"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function schoolRoleOf(userId: string, schoolId: string): Promise<string | null> {
  const [row] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId))).limit(1);
  return row?.role ?? null;
}
async function isSchoolStaff(viewer: Viewer, schoolId: string): Promise<boolean> {
  if (isGlobalAdminRole(viewer.role)) return true;
  const role = await schoolRoleOf(viewer.id, schoolId);
  return role === "school_director" || role === "school_admin";
}
async function ownerIds(): Promise<string[]> {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "platform_superadmin"));
  return rows.map((row) => row.id);
}
async function schoolName(schoolId: string): Promise<string> {
  const [row] = await db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  return row?.name ?? "";
}

/** A class of this school by name; created if missing. */
async function classIdIn(schoolId: string, className: string): Promise<string> {
  const [existing] = await db.select({ id: classesTable.id }).from(classesTable)
    .where(and(eq(classesTable.schoolId, schoolId), eq(classesTable.name, className))).limit(1);
  if (existing) return existing.id;
  const now = new Date();
  const year = String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
  const grade = Math.max(0, Math.min(11, Number.parseInt(className, 10) || 1));
  const [created] = await db.insert(classesTable).values({ schoolId, name: className, grade, academicYear: year }).onConflictDoNothing().returning({ id: classesTable.id });
  if (created) return created.id;
  const [again] = await db.select({ id: classesTable.id }).from(classesTable).where(and(eq(classesTable.schoolId, schoolId), eq(classesTable.name, className))).limit(1);
  return again!.id;
}

/** Reads and checks what a request asks for. */
function readChange(kind: Kind, body: Record<string, unknown>): { payload: Record<string, unknown>; error?: string } {
  if (kind === "enroll") {
    const rows = readRows(body);
    if (rows.length === 0) return { payload: {}, error: "No valid rows." };
    return { payload: { rows } };
  }
  if (kind === "edit") {
    const payload: Record<string, unknown> = {};
    const name = cleanText(body.name, 80);
    const phone = cleanText(body.phone, 30);
    const className = cleanText(body.className, 40);
    if (name) payload.name = name;
    if (phone !== null && phone !== undefined) payload.phone = phone;
    if (className) payload.className = className;
    const subjects = readSubjects(body.subjects);
    if (subjects) payload.subjects = subjects;
    if (Object.keys(payload).length === 0) return { payload, error: "Nothing to change." };
    return { payload };
  }
  if (kind === "transfer") {
    const toSchool = cleanText(body.toSchool, 120);
    return { payload: toSchool ? { toSchool } : {} };
  }
  return { payload: {} };
}

/** Applies a change. Used by the owner's approval and by the owner's direct edits. */
async function applyChange(schoolId: string, kind: Kind, targetUserId: string | null, payload: Record<string, unknown>, reason: string, actorId: string): Promise<Record<string, unknown>> {
  if (kind === "enroll") {
    const rows = (Array.isArray(payload.rows) ? payload.rows : []) as ImportRow[];
    const result = await importPeople(schoolId, rows, actorId);
    await writeAudit(schoolId, actorId, "enroll", null, { created: result.created.map(({ role, name, login, className }) => ({ role, name, login, className })), skipped: result.skipped });
    return { created: result.created.map(({ userId: _id, ...rest }) => rest), skipped: result.skipped };
  }
  if (!targetUserId) throw new Error("No person.");
  const [person] = await db.select({ id: usersTable.id, role: usersTable.role, name: usersTable.username }).from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
  if (!person) throw new Error("Person not found.");
  const now = new Date();
  if (kind === "edit") {
    const set: Record<string, unknown> = { updatedAt: now };
    if (typeof payload.name === "string") { set.username = payload.name; set.usernameNormalized = payload.name.toLowerCase(); }
    if (typeof payload.phone === "string") set.phone = payload.phone || null;
    if (Array.isArray(payload.subjects) && person.role === "teacher") set.subjects = payload.subjects;
    await db.update(usersTable).set(set).where(eq(usersTable.id, person.id));
    if (typeof payload.className === "string" && (person.role === "student" || person.role === "teacher")) {
      const schoolClassIds = (await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.schoolId, schoolId))).map((row) => row.id);
      // A pupil sits in one class; a teacher is added to one more class.
      if (person.role === "student" && schoolClassIds.length) {
        await db.delete(classMembersTable).where(and(eq(classMembersTable.userId, person.id), inArray(classMembersTable.classId, schoolClassIds)));
      }
      const classId = await classIdIn(schoolId, payload.className);
      await db.insert(classMembersTable).values({ classId, userId: person.id, role: person.role }).onConflictDoNothing();
    }
    await writeAudit(schoolId, actorId, "edit", person.id, { from: person.name, ...payload });
    return { edited: person.name };
  }
  const staff = person.role !== "student" && person.role !== "parent";
  const status = kind === "expel" ? (staff ? "disabled" : "expelled") : STATUS_OF[kind] ?? "active";
  await db.update(usersTable).set({ status, statusReason: reason.slice(0, 300), statusChangedAt: now, updatedAt: now }).where(eq(usersTable.id, person.id));
  if (BLOCKED_STATUSES.includes(status)) await db.delete(sessionsTable).where(eq(sessionsTable.userId, person.id));
  await writeAudit(schoolId, actorId, kind, person.id, { name: person.name, status, reason, ...payload });
  return { name: person.name, status };
}

/* ------------------------------------------------------------------ */
/* School side: send a request and see your requests                   */
/* ------------------------------------------------------------------ */

router.post("/schools/:schoolId/requests", requireAuthenticatedRole(...SCHOOL_STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  const viewer = viewerOf(res);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  if (!(await isSchoolStaff(viewer, schoolId))) { res.status(403).json({ error: "Only the director or deputy sends requests." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) { res.status(400).json({ error: "Unknown request." }); return; }
  const reason = cleanText(body.reason, 300) ?? "";
  if ((kind === "expel" || kind === "transfer") && reason.length < 3) { res.status(400).json({ error: "Write the reason (for example: the order number)." }); return; }
  let targetUserId: string | null = null;
  if (kind !== "enroll") {
    targetUserId = typeof body.userId === "string" && isValidUuid(body.userId) ? body.userId : null;
    if (!targetUserId || !(await schoolRoleOf(targetUserId, schoolId))) { res.status(400).json({ error: "This person is not in your school." }); return; }
    const targetRole = await schoolRoleOf(targetUserId, schoolId);
    if (targetRole === "school_director" && !isGlobalAdminRole(viewer.role)) { res.status(403).json({ error: "Changes about the director are made by EDUVERSE." }); return; }
    // A deputy does not change another deputy; the director does.
    if (targetRole === "school_admin" && targetUserId !== viewer.id && !isGlobalAdminRole(viewer.role) && (await schoolRoleOf(viewer.id, schoolId)) !== "school_director") {
      res.status(403).json({ error: "Only the director changes a deputy." });
      return;
    }
  }
  const change = readChange(kind, body);
  if (change.error) { res.status(400).json({ error: change.error }); return; }
  if (kind === "enroll" && (change.payload.rows as ImportRow[]).some((row) => row.role === "school_director")) {
    res.status(403).json({ error: "Only EDUVERSE adds a director." });
    return;
  }
  if (kind === "enroll" && !isGlobalAdminRole(viewer.role) && (await schoolRoleOf(viewer.id, schoolId)) !== "school_director"
    && (change.payload.rows as ImportRow[]).some((row) => row.role === "school_admin")) {
    res.status(403).json({ error: "Only the director adds a deputy." });
    return;
  }
  // The school makes the change itself: no waiting for EDUVERSE.
  let result: Record<string, unknown>;
  try {
    result = await applyChange(schoolId, kind, targetUserId, change.payload, reason, viewer.id);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not make the change." });
    return;
  }
  // Store logins only — passwords are shown to the school once and never kept.
  const stored = Array.isArray(result.created) ? { ...result, created: (result.created as Array<Record<string, unknown>>).map(({ password: _pw, ...rest }) => rest) } : result;
  const [row] = await db.insert(schoolRequestsTable).values({
    schoolId, authorId: viewer.id, kind, targetUserId, payload: change.payload, reason,
    status: "approved", decidedBy: viewer.id, decidedAt: new Date(), result: stored,
  }).returning({ id: schoolRequestsTable.id });
  // A quiet note for the owner in the bell only (no Telegram), so nobody is disturbed.
  const owners = await ownerIds();
  const name = await schoolName(schoolId);
  const what: Record<Kind, string> = { enroll: "приняли учеников", expel: "отчислили / отключили", transfer: "перевели в другую школу", graduate: "выпуск", restore: "восстановили", edit: "исправили данные" };
  await pushNotice(owners, "messages", `Школа: ${what[kind]}`, `${name}${reason ? ` · ${reason}` : ""}`, "/admin");
  res.status(201).json({ id: row!.id, status: "approved", result });
});

async function listRequests(where: ReturnType<typeof eq> | undefined, limit = 200) {
  const rows = await db
    .select({
      id: schoolRequestsTable.id,
      schoolId: schoolRequestsTable.schoolId,
      schoolName: schoolsTable.name,
      kind: schoolRequestsTable.kind,
      targetUserId: schoolRequestsTable.targetUserId,
      payload: schoolRequestsTable.payload,
      reason: schoolRequestsTable.reason,
      status: schoolRequestsTable.status,
      decisionNote: schoolRequestsTable.decisionNote,
      result: schoolRequestsTable.result,
      createdAt: schoolRequestsTable.createdAt,
      decidedAt: schoolRequestsTable.decidedAt,
      authorId: schoolRequestsTable.authorId,
    })
    .from(schoolRequestsTable)
    .innerJoin(schoolsTable, eq(schoolsTable.id, schoolRequestsTable.schoolId))
    .where(where)
    .orderBy(desc(schoolRequestsTable.createdAt))
    .limit(limit);
  const ids = [...new Set(rows.flatMap((row) => [row.targetUserId, row.authorId]).filter((id): id is string => Boolean(id)))];
  const names = ids.length ? await db.select({ id: usersTable.id, name: usersTable.username, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, ids)) : [];
  const nameOf = new Map(names.map((row) => [row.id, row]));
  return rows.map((row) => ({
    ...row,
    target: row.targetUserId ? nameOf.get(row.targetUserId) ?? null : null,
    author: row.authorId ? nameOf.get(row.authorId)?.name ?? "" : "",
  }));
}

router.get("/schools/:schoolId/requests", requireAuthenticatedRole(...SCHOOL_STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  if (!(await isSchoolStaff(viewerOf(res), schoolId))) { res.status(403).json({ error: "Not your school." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ requests: await listRequests(eq(schoolRequestsTable.schoolId, schoolId), 100) });
});

/** People of a school with their study status (staff of that school, or the owner). */
router.get("/schools/:schoolId/people", requireAuthenticatedRole(...SCHOOL_STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  if (!(await isSchoolStaff(viewerOf(res), schoolId))) { res.status(403).json({ error: "Not your school." }); return; }
  const people = await db
    .select({ id: usersTable.id, name: usersTable.username, login: usersTable.login, role: schoolMembersTable.role, phone: usersTable.phone, subjects: usersTable.subjects, status: usersTable.status, statusReason: usersTable.statusReason, statusChangedAt: usersTable.statusChangedAt })
    .from(schoolMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
    .where(eq(schoolMembersTable.schoolId, schoolId))
    .orderBy(usersTable.username);
  const classIds = (await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(eq(classesTable.schoolId, schoolId)));
  const memberships = classIds.length
    ? await db.select({ userId: classMembersTable.userId, classId: classMembersTable.classId }).from(classMembersTable).where(inArray(classMembersTable.classId, classIds.map((row) => row.id)))
    : [];
  const className = new Map(classIds.map((row) => [row.id, row.name]));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    people: people.map((person) => ({ ...person, classes: memberships.filter((m) => m.userId === person.id).map((m) => className.get(m.classId) ?? "").filter(Boolean) })),
    classes: classIds.map((row) => row.name).sort(),
  });
});

/* ------------------------------------------------------------------ */
/* Owner side: the queue, approve / reject, direct changes, journal     */
/* ------------------------------------------------------------------ */

router.get("/admin/requests", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const status = typeof req.query.status === "string" && ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : null;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ requests: await listRequests(status ? eq(schoolRequestsTable.status, status) : undefined) });
});

router.post("/admin/requests/:id/:decision", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const id = String(req.params.id);
  const decision = String(req.params.decision);
  if (!isValidUuid(id) || (decision !== "approve" && decision !== "reject")) { res.status(400).json({ error: "Invalid request." }); return; }
  const viewer = viewerOf(res);
  const note = cleanText(isRecord(req.body) ? req.body.note : "", 300) ?? "";
  // Take the request exactly once (two clicks or two owners must not apply it twice).
  const [request] = await db.update(schoolRequestsTable)
    .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: viewer.id, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(schoolRequestsTable.id, id), eq(schoolRequestsTable.status, "pending")))
    .returning();
  if (!request) { res.status(409).json({ error: "This request was already decided." }); return; }
  let result: Record<string, unknown> = {};
  if (decision === "approve") {
    try {
      result = await applyChange(request.schoolId, request.kind as Kind, request.targetUserId, request.payload as Record<string, unknown>, request.reason, viewer.id);
    } catch (error) {
      await db.update(schoolRequestsTable).set({ status: "pending", decidedBy: null, decidedAt: null }).where(eq(schoolRequestsTable.id, id));
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not apply the request." });
      return;
    }
    // Store logins only — passwords are shown to the owner once and never kept.
    const stored = Array.isArray(result.created) ? { ...result, created: (result.created as Array<Record<string, unknown>>).map(({ password: _pw, ...rest }) => rest) } : result;
    await db.update(schoolRequestsTable).set({ result: stored }).where(eq(schoolRequestsTable.id, id));
  } else {
    await writeAudit(request.schoolId, viewer.id, `reject:${request.kind}`, request.targetUserId, { requestId: id, note });
  }
  if (request.authorId) {
    const verdict = decision === "approve" ? "подтверждена" : "отклонена";
    await pushNotice([request.authorId], "messages", `Заявка ${verdict}`, note, "/school");
    await notifyUsers([request.authorId], `EDUVERSE: ваша заявка ${verdict}${note ? `\n${escapeHtml(note)}` : ""}`);
  }
  res.json({ status: request.status, result });
});

/** The owner changes a person directly (no request): status, name, phone or class. */
router.patch("/admin/schools/:schoolId/people/:userId", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  const userId = String(req.params.userId);
  if (!isValidUuid(schoolId) || !isValidUuid(userId)) { res.status(400).json({ error: "Invalid identifier." }); return; }
  if (!(await schoolRoleOf(userId, schoolId))) { res.status(404).json({ error: "This person is not in the school." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const kind = body.kind as Kind;
  if (!KINDS.includes(kind) || kind === "enroll") { res.status(400).json({ error: "Unknown change." }); return; }
  const change = readChange(kind, body);
  if (change.error) { res.status(400).json({ error: change.error }); return; }
  const result = await applyChange(schoolId, kind, userId, change.payload, cleanText(body.reason, 300) ?? "", viewerOf(res).id);
  res.json({ result });
});

router.get("/admin/audit", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = typeof req.query.schoolId === "string" && isValidUuid(req.query.schoolId) ? req.query.schoolId : null;
  const rows = await db
    .select({ id: auditLogTable.id, action: auditLogTable.action, details: auditLogTable.details, createdAt: auditLogTable.createdAt, actor: usersTable.username, schoolId: auditLogTable.schoolId })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorId))
    .where(schoolId ? eq(auditLogTable.schoolId, schoolId) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(200);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ entries: rows });
});

/* ------------------------------------------------------------------ */
/* Plans: the journal is free; 3D, online lessons and the trainer are paid */
/* ------------------------------------------------------------------ */

router.get("/me/plan", requireAuthenticatedRole("student", "teacher", "parent", ...SCHOOL_STAFF), async (_req, res) => {
  const viewer = viewerOf(res);
  const plan = await userPlan(viewer.id, viewer.role);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(plan);
});

/** The owner sets a school's plan: free, a pilot until a date, or pro. */
router.put("/admin/schools/:schoolId/plan", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const plan = body.plan === "pro" || body.plan === "pilot" || body.plan === "free" ? body.plan : null;
  const untilText = typeof body.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.until) ? body.until : null;
  if (!plan) { res.status(400).json({ error: "Plan must be free, pilot or pro." }); return; }
  if (plan === "pilot" && !untilText) { res.status(400).json({ error: "A pilot needs an end date." }); return; }
  const until = untilText ? new Date(`${untilText}T23:59:59`) : null;
  const [row] = await db.update(schoolsTable).set({ plan, planUntil: until, updatedAt: new Date() }).where(eq(schoolsTable.id, schoolId)).returning({ id: schoolsTable.id });
  if (!row) { res.status(404).json({ error: "School not found." }); return; }
  await writeAudit(schoolId, viewerOf(res).id, "plan", null, { plan, until: untilText });
  res.json({ plan, until });
});

export default router;
