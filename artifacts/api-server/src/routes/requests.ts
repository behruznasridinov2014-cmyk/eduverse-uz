import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  auditLogTable,
  classMembersTable,
  classesTable,
  db,
  parentLinksTable,
  personDocumentsTable,
  schoolMembersTable,
  schoolBillingPaymentsTable,
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
import { escapeHtml, notifyUsers, tl } from "../lib/notify";
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
    // The id lets the school attach a document photo right after adding the person.
    return { created: result.created, skipped: result.skipped };
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
    res.status(400).json({ error: error instanceof Error && !/failed query|duplicate key|violates|syntax error/i.test(error.message) ? error.message : "Could not make the change." });
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
  const ids = people.map((person) => person.id);
  const documents = ids.length ? await db.select({ userId: personDocumentsTable.userId }).from(personDocumentsTable).where(and(eq(personDocumentsTable.schoolId, schoolId), inArray(personDocumentsTable.userId, ids))) : [];
  const withDocument = new Set(documents.map((row) => row.userId));
  const links = ids.length ? await db.select({ parentId: parentLinksTable.parentId, studentId: parentLinksTable.studentId }).from(parentLinksTable).where(inArray(parentLinksTable.parentId, ids)) : [];
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    people: people.map((person) => ({
      ...person,
      classes: memberships.filter((m) => m.userId === person.id).map((m) => className.get(m.classId) ?? "").filter(Boolean),
      hasDocument: withDocument.has(person.id),
      children: links.filter((link) => link.parentId === person.id).map((link) => nameOf.get(link.studentId) ?? "").filter(Boolean),
    })),
    classes: classIds.map((row) => row.name).sort(),
  });
});

/* A document photo (birth certificate, passport): the school management only. */
const DOC_LIMIT = 900_000;
async function canSeeDocuments(viewer: { id: string; role: string }, schoolId: string, userId: string): Promise<boolean> {
  if (!(await isSchoolStaff(viewer as Viewer, schoolId))) return false;
  return Boolean(await schoolRoleOf(userId, schoolId));
}
router.put("/schools/:schoolId/people/:userId/document", requireAuthenticatedRole(...SCHOOL_STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  const userId = String(req.params.userId);
  const viewer = viewerOf(res);
  if (!isValidUuid(schoolId) || !isValidUuid(userId)) { res.status(400).json({ error: "Invalid request." }); return; }
  if (!(await canSeeDocuments(viewer, schoolId, userId))) { res.status(403).json({ error: "Not your school." }); return; }
  const data = isRecord(req.body) && typeof req.body.data === "string" ? req.body.data : "";
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > DOC_LIMIT) { res.status(400).json({ error: "Send a photo (up to about 600 KB)." }); return; }
  await db.delete(personDocumentsTable).where(and(eq(personDocumentsTable.schoolId, schoolId), eq(personDocumentsTable.userId, userId)));
  await db.insert(personDocumentsTable).values({ schoolId, userId, data, createdBy: viewer.id });
  await writeAudit(schoolId, viewer.id, "document", userId, {});
  res.json({ ok: true });
});
router.get("/schools/:schoolId/people/:userId/document", requireAuthenticatedRole(...SCHOOL_STAFF), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  const userId = String(req.params.userId);
  const viewer = viewerOf(res);
  if (!isValidUuid(schoolId) || !isValidUuid(userId)) { res.status(400).json({ error: "Invalid request." }); return; }
  if (!(await canSeeDocuments(viewer, schoolId, userId))) { res.status(403).json({ error: "Not your school." }); return; }
  const [row] = await db.select({ data: personDocumentsTable.data, createdAt: personDocumentsTable.createdAt }).from(personDocumentsTable)
    .where(and(eq(personDocumentsTable.schoolId, schoolId), eq(personDocumentsTable.userId, userId))).orderBy(desc(personDocumentsTable.createdAt)).limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  if (!row) { res.status(404).json({ error: "No document." }); return; }
  res.json(row);
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
      res.status(400).json({ error: error instanceof Error && !/failed query|duplicate key|violates|syntax error/i.test(error.message) ? error.message : "Could not apply the request." });
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
    await notifyUsers([request.authorId], (lang) => `${decision === "approve" ? "✅" : "❌"} <b>${decision === "approve" ? tl(lang, "Ariza tasdiqlandi", "Заявка подтверждена", "Request approved") : tl(lang, "Ariza rad etildi", "Заявка отклонена", "Request rejected")}</b>${note ? `\n${escapeHtml(note)}` : ""}`);
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
  const until = untilText ? new Date(`${untilText}T23:59:59+05:00`) : null;
  const [row] = await db.update(schoolsTable).set({ plan, planUntil: until, updatedAt: new Date() }).where(eq(schoolsTable.id, schoolId)).returning({ id: schoolsTable.id });
  if (!row) { res.status(404).json({ error: "School not found." }); return; }
  await writeAudit(schoolId, viewerOf(res).id, "plan", null, { plan, until: untilText });
  res.json({ plan, until });
});

/** The owner turns test mode on or off: today's lessons of the school open at any time. */
router.put("/admin/schools/:schoolId/lessons-any-time", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const on = isRecord(req.body) && req.body.on === true;
  const [row] = await db.update(schoolsTable).set({ lessonsAnyTime: on, updatedAt: new Date() }).where(eq(schoolsTable.id, schoolId)).returning({ id: schoolsTable.id });
  if (!row) { res.status(404).json({ error: "School not found." }); return; }
  await writeAudit(schoolId, viewerOf(res).id, "lessons-any-time", null, { on });
  res.json({ on });
});

/** The owner's overview of plans: which schools end their trial / paid period soon, who is on free. */
router.get("/admin/plans", requireAuthenticatedRole(...OWNER_ROLES), async (_req, res) => {
  const schools = await db.select({ id: schoolsTable.id, name: schoolsTable.name, region: schoolsTable.region, plan: schoolsTable.plan, planUntil: schoolsTable.planUntil, isDemo: schoolsTable.isDemo, lessonsAnyTime: schoolsTable.lessonsAnyTime, monthlyFee: schoolsTable.monthlyFee, billingStart: schoolsTable.billingStart, billingCurrency: schoolsTable.billingCurrency, billingDay: schoolsTable.billingDay, billingContact: schoolsTable.billingContact, billingPhone: schoolsTable.billingPhone }).from(schoolsTable);
  const paid = schools.length
    ? await db.select({ schoolId: schoolBillingPaymentsTable.schoolId, amount: schoolBillingPaymentsTable.amount, month: schoolBillingPaymentsTable.month }).from(schoolBillingPaymentsTable).where(inArray(schoolBillingPaymentsTable.schoolId, schools.map((school) => school.id)))
    : [];
  const ids = schools.map((school) => school.id);
  const counts = ids.length
    ? await db.select({ schoolId: schoolMembersTable.schoolId, role: schoolMembersTable.role }).from(schoolMembersTable).where(inArray(schoolMembersTable.schoolId, ids))
    : [];
  // Who to call about money when no contact is written: the director.
  const directors = ids.length
    ? await db.select({ schoolId: schoolMembersTable.schoolId, name: usersTable.username, phone: usersTable.phone }).from(schoolMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
      .where(and(inArray(schoolMembersTable.schoolId, ids), eq(schoolMembersTable.role, "school_director")))
    : [];
  const now = Date.now();
  const rows = schools.map((school) => {
    const until = school.planUntil ? school.planUntil.getTime() : null;
    const daysLeft = until === null ? null : Math.ceil((until - now) / 86400000);
    return {
      ...school,
      planUntil: school.planUntil ? school.planUntil.toISOString() : null,
      daysLeft,
      students: counts.filter((row) => row.schoolId === school.id && row.role === "student").length,
      teachers: counts.filter((row) => row.schoolId === school.id && row.role === "teacher").length,
      ...(() => { const sum = billingSummary(school.monthlyFee, school.billingStart, paid.filter((row) => row.schoolId === school.id), school.billingDay); return { debt: sum.debt, monthsOwed: sum.monthsOwed }; })(),
      ...nextDue(school.billingDay),
      contact: school.billingContact || directors.find((row) => row.schoolId === school.id)?.name || null,
      phone: school.billingPhone || directors.find((row) => row.schoolId === school.id)?.phone || null,
    };
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ schools: rows });
});

/* ------------------------------------------------------------------ */
/* Billing: the school pays the owner in cash, a fixed sum per month    */
/* ------------------------------------------------------------------ */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** This month in Tashkent, "YYYY-MM". */
function currentMonth(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
}
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
/** Today in Tashkent: "YYYY-MM-DD". */
const tashkentToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
/** The month before "YYYY-MM". */
function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
/** The next payment day and how many days are left (0 = today). */
export function nextDue(billingDay: number, today = tashkentToday()) {
  const day = Math.min(28, Math.max(1, Math.round(billingDay) || 1));
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const due = d <= day ? new Date(Date.UTC(y, m - 1, day)) : new Date(Date.UTC(y, m, day));
  const dueDate = due.toISOString().slice(0, 10);
  return { nextDue: dueDate, daysToDue: Math.round((due.getTime() - Date.UTC(y, m - 1, d)) / 86400000) };
}
/** Months charged so far (a month counts from its payment day), what was paid for each, and the debt. */
export function billingSummary(monthlyFee: number, billingStart: string | null, payments: Array<{ amount: number; month: string }>, billingDay = 1, today = tashkentToday()) {
  const lastMonth = Number(today.slice(8, 10)) >= Math.min(28, Math.max(1, billingDay)) ? today.slice(0, 7) : previousMonth(today.slice(0, 7));
  const months = monthlyFee > 0 && billingStart && MONTH_RE.test(billingStart) && billingStart <= lastMonth ? monthsBetween(billingStart, lastMonth) : [];
  const paidBy = new Map<string, number>();
  for (const payment of payments) paidBy.set(payment.month, (paidBy.get(payment.month) ?? 0) + payment.amount);
  const rows = months.map((month) => ({ month, due: monthlyFee, paid: paidBy.get(month) ?? 0 }));
  const charged = months.length * monthlyFee;
  const paid = payments.reduce((total, payment) => total + payment.amount, 0);
  const debt = Math.max(0, charged - paid);
  return { months: rows, charged, paid, debt, monthsOwed: monthlyFee > 0 ? Math.ceil(debt / monthlyFee) : 0 };
}

async function loadBilling(schoolId: string) {
  const [school] = await db.select({ monthlyFee: schoolsTable.monthlyFee, billingStart: schoolsTable.billingStart, currency: schoolsTable.billingCurrency, billingDay: schoolsTable.billingDay, contact: schoolsTable.billingContact, phone: schoolsTable.billingPhone }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  if (!school) return null;
  const payments = await db.select({ id: schoolBillingPaymentsTable.id, amount: schoolBillingPaymentsTable.amount, month: schoolBillingPaymentsTable.month, paidOn: schoolBillingPaymentsTable.paidOn, note: schoolBillingPaymentsTable.note })
    .from(schoolBillingPaymentsTable).where(eq(schoolBillingPaymentsTable.schoolId, schoolId)).orderBy(desc(schoolBillingPaymentsTable.paidOn), desc(schoolBillingPaymentsTable.createdAt));
  return { monthlyFee: school.monthlyFee, billingStart: school.billingStart, currency: school.currency, billingDay: school.billingDay, contact: school.contact, phone: school.phone, ...nextDue(school.billingDay), payments, ...billingSummary(school.monthlyFee, school.billingStart, payments, school.billingDay) };
}

router.get("/admin/schools/:schoolId/billing", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const billing = await loadBilling(schoolId);
  if (!billing) { res.status(404).json({ error: "School not found." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(billing);
});

router.put("/admin/schools/:schoolId/billing", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const fee = Number(body.monthlyFee);
  if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000_000) { res.status(400).json({ error: "Monthly sum must be a whole number." }); return; }
  const start = typeof body.billingStart === "string" && MONTH_RE.test(body.billingStart) ? body.billingStart : null;
  if (fee > 0 && !start) { res.status(400).json({ error: "Choose the first month." }); return; }
  // Fields left out of the request keep their saved value.
  const update: Partial<typeof schoolsTable.$inferInsert> = { monthlyFee: fee, billingStart: start, updatedAt: new Date() };
  if ("currency" in body) update.billingCurrency = body.currency === "USD" ? "USD" : "UZS";
  if ("billingDay" in body) { const day = Number(body.billingDay); update.billingDay = Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1; }
  if ("contact" in body) update.billingContact = cleanText(body.contact, 80) || null;
  if ("phone" in body) update.billingPhone = typeof body.phone === "string" ? body.phone.replace(/[^\d+ ()-]/g, "").trim().slice(0, 24) || null : null;
  const [row] = await db.update(schoolsTable).set(update).where(eq(schoolsTable.id, schoolId)).returning({ id: schoolsTable.id });
  if (!row) { res.status(404).json({ error: "School not found." }); return; }
  await writeAudit(schoolId, viewerOf(res).id, "billing", null, { monthlyFee: fee, billingStart: start, currency: update.billingCurrency, billingDay: update.billingDay });
  res.json(await loadBilling(schoolId));
});

router.post("/admin/schools/:schoolId/billing/payments", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const body = isRecord(req.body) ? req.body : {};
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) { res.status(400).json({ error: "Enter the sum." }); return; }
  const month = typeof body.month === "string" && MONTH_RE.test(body.month) ? body.month : currentMonth();
  const paidOn = typeof body.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) ? body.paidOn : new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const note = cleanText(body.note, 200) || null;
  const [school] = await db.select({ id: schoolsTable.id }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  if (!school) { res.status(404).json({ error: "School not found." }); return; }
  await db.insert(schoolBillingPaymentsTable).values({ schoolId, amount, month, paidOn, note, createdBy: viewerOf(res).id });
  await writeAudit(schoolId, viewerOf(res).id, "billing_payment", null, { amount, month, paidOn });
  res.status(201).json(await loadBilling(schoolId));
});

router.delete("/admin/schools/:schoolId/billing/payments/:paymentId", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  const paymentId = String(req.params.paymentId);
  if (!isValidUuid(schoolId) || !isValidUuid(paymentId)) { res.status(400).json({ error: "Invalid payment." }); return; }
  const [row] = await db.delete(schoolBillingPaymentsTable).where(and(eq(schoolBillingPaymentsTable.id, paymentId), eq(schoolBillingPaymentsTable.schoolId, schoolId))).returning({ amount: schoolBillingPaymentsTable.amount, month: schoolBillingPaymentsTable.month });
  if (!row) { res.status(404).json({ error: "Payment not found." }); return; }
  await writeAudit(schoolId, viewerOf(res).id, "billing_payment_removed", null, row);
  res.json(await loadBilling(schoolId));
});

export default router;
