import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  ACCOUNT_ROLES,
  assignmentsTable,
  classesTable,
  classMembersTable,
  db,
  schoolMembersTable,
  schoolsTable,
  usersTable,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";

const router: IRouter = Router();
const globalAdminRoles = ["education_admin", "ministry_admin", "platform_superadmin"] as const;
const managementRoles = ["school_director", "school_admin", ...globalAdminRoles] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthenticatedRequestUser = { id: string; role: string };
function currentUser(res: Response): AuthenticatedRequestUser {
  return res.locals.authenticatedUser as AuthenticatedRequestUser;
}
function isGlobalAdmin(role: string): boolean { return (globalAdminRoles as readonly string[]).includes(role); }
function isManagementRole(role: string): boolean { return (managementRoles as readonly string[]).includes(role); }
function validUuid(value: string): boolean { return uuidPattern.test(value); }
function stringField(value: unknown, key: string, max = 200): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;
  const result = candidate.trim();
  return result && result.length <= max ? result : undefined;
}
async function hasSchoolAccess(user: AuthenticatedRequestUser, schoolId: string, roles?: readonly string[]) {
  if (isGlobalAdmin(user.role)) return true;
  const [membership] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable).where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, user.id))).limit(1);
  return Boolean(membership && (!roles || roles.includes(membership.role)));
}
async function hasClassAccess(user: AuthenticatedRequestUser, classId: string) {
  if (isGlobalAdmin(user.role)) return true;
  const [membership] = await db.select({ schoolId: classesTable.schoolId }).from(classMembersTable).innerJoin(classesTable, eq(classMembersTable.classId, classesTable.id)).where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, user.id))).limit(1);
  if (membership) return true;
  const [schoolRole] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable).innerJoin(classesTable, eq(schoolMembersTable.schoolId, classesTable.schoolId)).where(and(eq(classesTable.id, classId), eq(schoolMembersTable.userId, user.id))).limit(1);
  return Boolean(schoolRole && isManagementRole(schoolRole.role));
}

router.get("/schools/me", requireAuthenticatedRole(...ACCOUNT_ROLES), async (_req, res) => {
  const user = currentUser(res);
  const memberships = await db.select({ schoolId: schoolMembersTable.schoolId, schoolName: schoolsTable.name, region: schoolsTable.region, role: schoolMembersTable.role }).from(schoolMembersTable).innerJoin(schoolsTable, eq(schoolMembersTable.schoolId, schoolsTable.id)).where(eq(schoolMembersTable.userId, user.id));
  const schoolIds = memberships.map((item) => item.schoolId);
  const classes = schoolIds.length === 0 ? [] : await db.select({ id: classesTable.id, schoolId: classesTable.schoolId, name: classesTable.name, grade: classesTable.grade, academicYear: classesTable.academicYear }).from(classesTable).where(inArray(classesTable.schoolId, schoolIds));
  res.json({ memberships, classes });
});

router.post("/schools", requireAuthenticatedRole(...globalAdminRoles), async (req, res) => {
  const name = stringField(req.body, "name", 160); const region = stringField(req.body, "region", 120); const district = stringField(req.body, "district", 120); const address = stringField(req.body, "address", 240);
  if (!name || !region) { res.status(400).json({ error: "School name and region are required." }); return; }
  const [school] = await db.insert(schoolsTable).values({ name, region, district, address }).returning();
  res.status(201).json({ school });
});

router.get("/schools/:schoolId/classes", requireAuthenticatedRole(...ACCOUNT_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId); const user = currentUser(res);
  if (!validUuid(schoolId) || !(await hasSchoolAccess(user, schoolId))) { res.status(403).json({ error: "School access denied." }); return; }
  const classes = await db.select({ id: classesTable.id, name: classesTable.name, grade: classesTable.grade, academicYear: classesTable.academicYear }).from(classesTable).where(eq(classesTable.schoolId, schoolId));
  res.json({ classes });
});

router.post("/schools/:schoolId/classes", requireAuthenticatedRole(...managementRoles), async (req, res) => {
  const schoolId = String(req.params.schoolId); const user = currentUser(res);
  if (!validUuid(schoolId) || !(await hasSchoolAccess(user, schoolId, managementRoles))) { res.status(403).json({ error: "School management access denied." }); return; }
  const name = stringField(req.body, "name", 80); const academicYear = stringField(req.body, "academicYear", 20); const rawGrade = typeof req.body?.grade === "number" ? req.body.grade : Number(req.body?.grade);
  if (!name || !academicYear || !Number.isInteger(rawGrade) || rawGrade < 1 || rawGrade > 11) { res.status(400).json({ error: "Class name, grade, and academic year are required." }); return; }
  const [schoolClass] = await db.insert(classesTable).values({ schoolId, name, grade: rawGrade, academicYear }).returning();
  res.status(201).json({ class: schoolClass });
});

router.post("/classes/:classId/members", requireAuthenticatedRole(...managementRoles), async (req, res) => {
  const classId = String(req.params.classId); const user = currentUser(res); const userId = stringField(req.body, "userId", 80); const role = stringField(req.body, "role", 20);
  if (!validUuid(classId) || !userId || !validUuid(userId) || !["student", "teacher"].includes(role ?? "")) { res.status(400).json({ error: "Valid class, user, and class role are required." }); return; }
  const [school] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!school || !(await hasSchoolAccess(user, school.schoolId, managementRoles))) { res.status(403).json({ error: "Class management access denied." }); return; }
  const [member] = await db.insert(classMembersTable).values({ classId, userId, role: role as "student" | "teacher" }).onConflictDoUpdate({ target: [classMembersTable.classId, classMembersTable.userId], set: { role: role as "student" | "teacher" } }).returning();
  res.status(201).json({ member });
});

router.get("/classes/:classId/assignments", requireAuthenticatedRole(...ACCOUNT_ROLES), async (req, res) => {
  const classId = String(req.params.classId); const user = currentUser(res);
  if (!validUuid(classId) || !(await hasClassAccess(user, classId))) { res.status(403).json({ error: "Class access denied." }); return; }
  const assignments = await db.select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject, description: assignmentsTable.description, dueAt: assignmentsTable.dueAt, status: assignmentsTable.status, createdAt: assignmentsTable.createdAt }).from(assignmentsTable).where(eq(assignmentsTable.classId, classId));
  res.json({ assignments });
});

router.post("/classes/:classId/assignments", requireAuthenticatedRole("teacher", ...managementRoles), async (req, res) => {
  const classId = String(req.params.classId); const user = currentUser(res);
  if (!validUuid(classId) || !(await hasClassAccess(user, classId))) { res.status(403).json({ error: "Class access denied." }); return; }
  const title = stringField(req.body, "title", 180); const subject = stringField(req.body, "subject", 80); const description = stringField(req.body, "description", 4_000);
  if (!title || !subject || !description) { res.status(400).json({ error: "Title, subject, and description are required." }); return; }
  const dueAt = typeof req.body?.dueAt === "string" ? new Date(req.body.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) { res.status(400).json({ error: "dueAt must be a valid ISO date." }); return; }
  const [assignment] = await db.insert(assignmentsTable).values({ classId, createdBy: user.id, title, subject, description, dueAt }).returning();
  res.status(201).json({ assignment });
});

export default router;


