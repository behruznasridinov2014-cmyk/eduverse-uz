import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  ACCOUNT_ROLES,
  assignmentSubmissionsTable,
  assignmentsTable,
  classesTable,
  classMembersTable,
  db,
  schoolMembersTable,
  schoolsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";
import {
  ASSIGNMENT_STATUSES,
  GLOBAL_ADMIN_ROLES,
  MEMBER_ROLES_A_SCHOOL_MANAGER_CAN_ADD,
  SCHOOL_MANAGEMENT_ROLES,
  canManageClass,
  canManageSchool,
  canReviewAssignments,
  canSubmitAssignment,
  cleanText,
  isAssignmentStatus,
  isClassMemberRole,
  isGlobalAdminRole,
  isReviewableSubmissionStatus,
  isSchoolManagementRole,
  isSchoolMemberRole,
  isUniqueConstraintViolation,
  isValidUuid,
  parseBoundedInteger,
  parseDueAt,
  parseOptionalScore,
  type AssignmentStatus,
  type ClassMemberRole,
  type SchoolMemberRole,
} from "../lib/school-access";

const router: IRouter = Router();

type AuthenticatedRequestUser = { id: string; role: AccountRole };

type ClassContext = {
  id: string;
  schoolId: string;
  name: string;
  grade: number;
  academicYear: string;
  schoolName: string;
  region: string;
};

type ClassAuthorization = {
  schoolClass: ClassContext;
  schoolRole: string | null;
  classRole: ClassMemberRole | null;
  canAccess: boolean;
  canManage: boolean;
  canReview: boolean;
  canSubmit: boolean;
};

function currentUser(res: Response): AuthenticatedRequestUser {
  return res.locals.authenticatedUser as AuthenticatedRequestUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(body: unknown, key: string, maxLength = 200) {
  if (!isRecord(body)) return undefined;
  return cleanText(body[key], maxLength);
}

function hasField(body: unknown, key: string): boolean {
  return isRecord(body) && Object.prototype.hasOwnProperty.call(body, key);
}

function invalidParam(names: string[]): string | undefined {
  return names.find((name) => !isValidUuid(name));
}

async function schoolMembershipRole(
  userId: string,
  schoolId: string,
): Promise<string | null> {
  const [membership] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(
      and(
        eq(schoolMembersTable.schoolId, schoolId),
        eq(schoolMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return membership?.role ?? null;
}

async function classMembershipRole(
  userId: string,
  classId: string,
): Promise<ClassMemberRole | null> {
  const [membership] = await db
    .select({ role: classMembersTable.role })
    .from(classMembersTable)
    .where(
      and(
        eq(classMembersTable.classId, classId),
        eq(classMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return membership?.role ?? null;
}

async function loadClassContext(classId: string): Promise<ClassContext | null> {
  const [schoolClass] = await db
    .select({
      id: classesTable.id,
      schoolId: classesTable.schoolId,
      name: classesTable.name,
      grade: classesTable.grade,
      academicYear: classesTable.academicYear,
      schoolName: schoolsTable.name,
      region: schoolsTable.region,
    })
    .from(classesTable)
    .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
    .where(eq(classesTable.id, classId))
    .limit(1);
  return schoolClass ?? null;
}

async function authorizeClass(
  user: AuthenticatedRequestUser,
  classId: string,
): Promise<ClassAuthorization | null> {
  const schoolClass = await loadClassContext(classId);
  if (!schoolClass) return null;

  const [schoolRole, classRole] = await Promise.all([
    schoolMembershipRole(user.id, schoolClass.schoolId),
    classMembershipRole(user.id, classId),
  ]);

  return {
    schoolClass,
    schoolRole,
    classRole,
    canAccess:
      isGlobalAdminRole(user.role) ||
      canManageSchool(user.role, schoolRole) ||
      Boolean(classRole),
    canManage: canManageClass(user.role, schoolRole, classRole),
    canReview: canReviewAssignments(user.role, schoolRole, classRole),
    canSubmit: canSubmitAssignment(user.role, classRole),
  };
}

function requireUuidParams(res: Response, ...names: string[]): boolean {
  if (invalidParam(names)) {
    res.status(400).json({ error: "A valid resource identifier is required." });
    return false;
  }
  return true;
}

function forbidden(res: Response, message = "School access denied.") {
  res.status(403).json({ error: message });
}

/* -------------------------------------------------------------------------- */
/* Schools                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  "/schools/me",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (_req, res) => {
    const user = currentUser(res);

    const memberships = await db
      .select({
        schoolId: schoolMembersTable.schoolId,
        schoolName: schoolsTable.name,
        region: schoolsTable.region,
        district: schoolsTable.district,
        role: schoolMembersTable.role,
      })
      .from(schoolMembersTable)
      .innerJoin(schoolsTable, eq(schoolMembersTable.schoolId, schoolsTable.id))
      .where(eq(schoolMembersTable.userId, user.id))
      .orderBy(schoolsTable.name);

    const managedSchoolIds = memberships
      .filter((membership) => isSchoolManagementRole(membership.role))
      .map((membership) => membership.schoolId);

    const classRows = await db
      .select({ classId: classMembersTable.classId })
      .from(classMembersTable)
      .where(eq(classMembersTable.userId, user.id));
    const memberClassIds = classRows.map((row) => row.classId);

    const classConditions = [];
    if (managedSchoolIds.length > 0) {
      classConditions.push(inArray(classesTable.schoolId, managedSchoolIds));
    }
    if (memberClassIds.length > 0) {
      classConditions.push(inArray(classesTable.id, memberClassIds));
    }

    const schoolClasses =
      classConditions.length === 0
        ? []
        : await db
            .select({
              id: classesTable.id,
              schoolId: classesTable.schoolId,
              schoolName: schoolsTable.name,
              name: classesTable.name,
              grade: classesTable.grade,
              academicYear: classesTable.academicYear,
              studentCount: sql<number>`(select count(*)::int from ${classMembersTable} where ${classMembersTable.classId} = ${classesTable.id} and ${classMembersTable.role} = 'student')`,
              teacherCount: sql<number>`(select count(*)::int from ${classMembersTable} where ${classMembersTable.classId} = ${classesTable.id} and ${classMembersTable.role} = 'teacher')`,
            })
            .from(classesTable)
            .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
            .where(or(...classConditions))
            .orderBy(schoolsTable.name, classesTable.grade, classesTable.name);

    const [submissionCounts] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(assignmentSubmissionsTable)
      .where(eq(assignmentSubmissionsTable.studentId, user.id));

    res.json({
      memberships,
      classes: schoolClasses,
      mySubmissionCount: submissionCounts?.total ?? 0,
    });
  },
);

router.get(
  "/schools",
  requireAuthenticatedRole(...GLOBAL_ADMIN_ROLES),
  async (_req, res) => {
    const schools = await db
      .select({
        id: schoolsTable.id,
        name: schoolsTable.name,
        region: schoolsTable.region,
        district: schoolsTable.district,
        address: schoolsTable.address,
        createdAt: schoolsTable.createdAt,
        memberCount: sql<number>`(select count(*)::int from ${schoolMembersTable} where ${schoolMembersTable.schoolId} = ${schoolsTable.id})`,
        classCount: sql<number>`(select count(*)::int from ${classesTable} where ${classesTable.schoolId} = ${schoolsTable.id})`,
      })
      .from(schoolsTable)
      .orderBy(schoolsTable.name);
    res.json({ schools });
  },
);

router.post(
  "/schools",
  requireAuthenticatedRole(...GLOBAL_ADMIN_ROLES),
  async (req, res) => {
    const name = readString(req.body, "name", 160);
    const region = readString(req.body, "region", 120);
    const district = readString(req.body, "district", 120);
    const address = readString(req.body, "address", 240);

    if (!name || !region) {
      res.status(400).json({ error: "School name and region are required." });
      return;
    }

    try {
      const [school] = await db
        .insert(schoolsTable)
        .values({ name, region, district, address })
        .returning();
      res.status(201).json({ school });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: "This school already exists." });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/schools/:schoolId",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId")) return;
    const schoolId = String(req.params.schoolId);
    const user = currentUser(res);

    const [school] = await db
      .select({
        id: schoolsTable.id,
        name: schoolsTable.name,
        region: schoolsTable.region,
        district: schoolsTable.district,
        address: schoolsTable.address,
        createdAt: schoolsTable.createdAt,
        memberCount: sql<number>`(select count(*)::int from ${schoolMembersTable} where ${schoolMembersTable.schoolId} = ${schoolsTable.id})`,
        classCount: sql<number>`(select count(*)::int from ${classesTable} where ${classesTable.schoolId} = ${schoolsTable.id})`,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, schoolId))
      .limit(1);

    if (!school) {
      res.status(404).json({ error: "School not found." });
      return;
    }

    const schoolRole = await schoolMembershipRole(user.id, schoolId);
    if (!isGlobalAdminRole(user.role) && !schoolRole) {
      forbidden(res);
      return;
    }

    res.json({ school, role: schoolRole });
  },
);

/* -------------------------------------------------------------------------- */
/* School members                                                              */
/* -------------------------------------------------------------------------- */

router.get(
  "/schools/:schoolId/members",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId")) return;
    const schoolId = String(req.params.schoolId);
    const user = currentUser(res);
    const schoolRole = await schoolMembershipRole(user.id, schoolId);

    if (!canManageSchool(user.role, schoolRole)) {
      forbidden(res, "School management access denied.");
      return;
    }

    const members = await db
      .select({
        userId: schoolMembersTable.userId,
        username: usersTable.username,
        login: usersTable.login,
        accountRole: usersTable.role,
        role: schoolMembersTable.role,
        createdAt: schoolMembersTable.createdAt,
      })
      .from(schoolMembersTable)
      .innerJoin(usersTable, eq(schoolMembersTable.userId, usersTable.id))
      .where(eq(schoolMembersTable.schoolId, schoolId))
      .orderBy(schoolMembersTable.role, usersTable.username);

    res.json({ members });
  },
);

router.post(
  "/schools/:schoolId/members",
  requireAuthenticatedRole(...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId")) return;
    const schoolId = String(req.params.schoolId);
    const user = currentUser(res);
    const schoolRole = await schoolMembershipRole(user.id, schoolId);

    if (!canManageSchool(user.role, schoolRole)) {
      forbidden(res, "School management access denied.");
      return;
    }

    const userId = readString(req.body, "userId", 80);
    const role = readString(req.body, "role", 30);
    if (!isValidUuid(userId) || !isSchoolMemberRole(role)) {
      res.status(400).json({ error: "A valid user and school role are required." });
      return;
    }

    if (!isGlobalAdminRole(user.role)) {
      const managerAssignable = [
        ...MEMBER_ROLES_A_SCHOOL_MANAGER_CAN_ADD,
        ...(schoolRole === "school_director"
          ? (["school_admin", "school_director"] as const)
          : []),
      ] as readonly string[];
      if (!managerAssignable.includes(role)) {
        forbidden(
          res,
          schoolRole === "school_director"
            ? "School directors can add staff, students, and parents."
            : "School administrators can add students, teachers, and parents.",
        );
        return;
      }
    }

    const [targetUser] = await db
      .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!targetUser) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const [member] = await db
      .insert(schoolMembersTable)
      .values({ schoolId, userId, role })
      .onConflictDoUpdate({
        target: [schoolMembersTable.schoolId, schoolMembersTable.userId],
        set: { role },
      })
      .returning();

    res.status(201).json({ member: { ...member, username: targetUser.username } });
  },
);

router.delete(
  "/schools/:schoolId/members/:userId",
  requireAuthenticatedRole(...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId", "userId")) return;
    const schoolId = String(req.params.schoolId);
    const userId = String(req.params.userId);
    const user = currentUser(res);
    const schoolRole = await schoolMembershipRole(user.id, schoolId);

    if (!canManageSchool(user.role, schoolRole)) {
      forbidden(res, "School management access denied.");
      return;
    }
    if (userId === user.id && !isGlobalAdminRole(user.role)) {
      res.status(400).json({ error: "Managers cannot remove their own school membership." });
      return;
    }

    await db.transaction(async (transaction) => {
      const schoolClassIds = await transaction
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(eq(classesTable.schoolId, schoolId));

      if (schoolClassIds.length > 0) {
        await transaction.delete(classMembersTable).where(
          and(
            eq(classMembersTable.userId, userId),
            inArray(
              classMembersTable.classId,
              schoolClassIds.map((row) => row.id),
            ),
          ),
        );
      }

      await transaction.delete(schoolMembersTable).where(
        and(
          eq(schoolMembersTable.schoolId, schoolId),
          eq(schoolMembersTable.userId, userId),
        ),
      );
    });

    res.status(204).end();
  },
);

/* -------------------------------------------------------------------------- */
/* Classes                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  "/schools/:schoolId/classes",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId")) return;
    const schoolId = String(req.params.schoolId);
    const user = currentUser(res);
    const schoolRole = await schoolMembershipRole(user.id, schoolId);

    if (!isGlobalAdminRole(user.role) && !schoolRole) {
      forbidden(res);
      return;
    }

    const conditions = [eq(classesTable.schoolId, schoolId)];
    if (!isGlobalAdminRole(user.role) && !isSchoolManagementRole(schoolRole ?? "")) {
      const memberClasses = await db
        .select({ classId: classMembersTable.classId })
        .from(classMembersTable)
        .where(eq(classMembersTable.userId, user.id));
      if (memberClasses.length === 0) {
        res.json({ classes: [] });
        return;
      }
      conditions.push(
        inArray(
          classesTable.id,
          memberClasses.map((row) => row.classId),
        ),
      );
    }

    const schoolClasses = await db
      .select({
        id: classesTable.id,
        schoolId: classesTable.schoolId,
        schoolName: schoolsTable.name,
        name: classesTable.name,
        grade: classesTable.grade,
        academicYear: classesTable.academicYear,
        studentCount: sql<number>`(select count(*)::int from ${classMembersTable} where ${classMembersTable.classId} = ${classesTable.id} and ${classMembersTable.role} = 'student')`,
        teacherCount: sql<number>`(select count(*)::int from ${classMembersTable} where ${classMembersTable.classId} = ${classesTable.id} and ${classMembersTable.role} = 'teacher')`,
      })
      .from(classesTable)
      .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
      .where(and(...conditions))
      .orderBy(classesTable.grade, classesTable.name);

    res.json({ classes: schoolClasses });
  },
);

router.post(
  "/schools/:schoolId/classes",
  requireAuthenticatedRole(...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "schoolId")) return;
    const schoolId = String(req.params.schoolId);
    const user = currentUser(res);
    const schoolRole = await schoolMembershipRole(user.id, schoolId);

    if (!canManageSchool(user.role, schoolRole)) {
      forbidden(res, "School management access denied.");
      return;
    }

    const name = readString(req.body, "name", 80);
    const academicYear = readString(req.body, "academicYear", 20);
    const grade = isRecord(req.body)
      ? parseBoundedInteger(req.body.grade, 1, 11)
      : undefined;

    if (!name || !academicYear || grade === undefined) {
      res.status(400).json({
        error: "Class name, grade (1–11), and academic year are required.",
      });
      return;
    }

    try {
      const [schoolClass] = await db
        .insert(classesTable)
        .values({ schoolId, name, grade, academicYear })
        .returning();
      res.status(201).json({ class: schoolClass });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: "This class already exists for the academic year." });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/classes/:classId",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId")) return;
    const authorization = await authorizeClass(
      currentUser(res),
      String(req.params.classId),
    );
    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canAccess) {
      forbidden(res, "Class access denied.");
      return;
    }

    const { schoolClass, schoolRole, classRole } = authorization;
    res.json({
      class: {
        ...schoolClass,
        studentCount: await classMemberCount(schoolClass.id, "student"),
        teacherCount: await classMemberCount(schoolClass.id, "teacher"),
      },
      role: classRole,
      schoolRole,
    });
  },
);

async function classMemberCount(
  classId: string,
  role: ClassMemberRole,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(classMembersTable)
    .where(
      and(
        eq(classMembersTable.classId, classId),
        eq(classMembersTable.role, role),
      ),
    );
  return row?.total ?? 0;
}

router.get(
  "/classes/:classId/members",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId")) return;
    const authorization = await authorizeClass(
      currentUser(res),
      String(req.params.classId),
    );
    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canAccess) {
      forbidden(res, "Class access denied.");
      return;
    }

    const members = await db
      .select({
        userId: classMembersTable.userId,
        username: usersTable.username,
        login: usersTable.login,
        accountRole: usersTable.role,
        role: classMembersTable.role,
        createdAt: classMembersTable.createdAt,
      })
      .from(classMembersTable)
      .innerJoin(usersTable, eq(classMembersTable.userId, usersTable.id))
      .where(eq(classMembersTable.classId, String(req.params.classId)))
      .orderBy(classMembersTable.role, usersTable.username);

    // The login is the account identifier used to sign in. It is only handed
    // out to the people who may manage the class.
    const mayManage = authorization.canManage;
    res.json({
      members: members.map((member) => ({
        userId: member.userId,
        username: member.username,
        ...(mayManage ? { login: member.login, accountRole: member.accountRole } : {}),
        role: member.role,
        createdAt: member.createdAt,
      })),
    });
  },
);

router.post(
  "/classes/:classId/members",
  requireAuthenticatedRole(...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId")) return;
    const classId = String(req.params.classId);
    const user = currentUser(res);
    const authorization = await authorizeClass(user, classId);

    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canManage) {
      forbidden(res, "Class management access denied.");
      return;
    }

    const userId = readString(req.body, "userId", 80);
    const role = readString(req.body, "role", 20);
    if (!isValidUuid(userId) || !isClassMemberRole(role)) {
      res.status(400).json({
        error: "A valid user and class role (student or teacher) are required.",
      });
      return;
    }

    const [targetUser] = await db
      .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!targetUser) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const accountRole = targetUser.role;
    const canBeStudent = accountRole === "student" && role === "student";
    const canBeTeacher =
      role === "teacher" &&
      (accountRole === "teacher" ||
        accountRole === "school_director" ||
        accountRole === "school_admin");
    if (!canBeStudent && !canBeTeacher) {
      res.status(400).json({
        error: "The account role does not match the requested class role.",
      });
      return;
    }

    const member = await db.transaction(async (transaction) => {
      const schoolRole: SchoolMemberRole | null = isSchoolMemberRole(accountRole)
        ? accountRole
        : null;
      if (schoolRole) {
        await transaction
          .insert(schoolMembersTable)
          .values({
            schoolId: authorization.schoolClass.schoolId,
            userId,
            role: schoolRole,
          })
          .onConflictDoUpdate({
            target: [schoolMembersTable.schoolId, schoolMembersTable.userId],
            set: { role: schoolRole },
          });
      }

      const [created] = await transaction
        .insert(classMembersTable)
        .values({ classId, userId, role: role as ClassMemberRole })
        .onConflictDoUpdate({
          target: [classMembersTable.classId, classMembersTable.userId],
          set: { role: role as ClassMemberRole },
        })
        .returning();
      return created;
    });

    res.status(201).json({
      member: { ...member, username: targetUser.username },
    });
  },
);

router.delete(
  "/classes/:classId/members/:userId",
  requireAuthenticatedRole(...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId", "userId")) return;
    const classId = String(req.params.classId);
    const userId = String(req.params.userId);
    const authorization = await authorizeClass(currentUser(res), classId);

    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canManage) {
      forbidden(res, "Class management access denied.");
      return;
    }

    await db
      .delete(classMembersTable)
      .where(
        and(
          eq(classMembersTable.classId, classId),
          eq(classMembersTable.userId, userId),
        ),
      );
    res.status(204).end();
  },
);

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

const assignmentSelection = {
  id: assignmentsTable.id,
  classId: assignmentsTable.classId,
  className: classesTable.name,
  schoolId: classesTable.schoolId,
  schoolName: schoolsTable.name,
  title: assignmentsTable.title,
  subject: assignmentsTable.subject,
  description: assignmentsTable.description,
  dueAt: assignmentsTable.dueAt,
  status: assignmentsTable.status,
  createdAt: assignmentsTable.createdAt,
  updatedAt: assignmentsTable.updatedAt,
  createdBy: assignmentsTable.createdBy,
  createdByName: usersTable.username,
  submissionCount: sql<number>`(select count(*)::int from ${assignmentSubmissionsTable} where ${assignmentSubmissionsTable.assignmentId} = ${assignmentsTable.id})`,
  reviewCount: sql<number>`(select count(*)::int from ${assignmentSubmissionsTable} where ${assignmentSubmissionsTable.assignmentId} = ${assignmentsTable.id} and ${assignmentSubmissionsTable.status} in ('under_review', 'checked'))`,
};

router.get(
  "/classes/:classId/assignments",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId")) return;
    const classId = String(req.params.classId);
    const user = currentUser(res);
    const authorization = await authorizeClass(user, classId);

    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canAccess) {
      forbidden(res, "Class access denied.");
      return;
    }

    const assignments = await db
      .select(assignmentSelection)
      .from(assignmentsTable)
      .innerJoin(classesTable, eq(assignmentsTable.classId, classesTable.id))
      .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
      .innerJoin(usersTable, eq(assignmentsTable.createdBy, usersTable.id))
      .where(eq(assignmentsTable.classId, classId))
      .orderBy(desc(assignmentsTable.createdAt));

    const submissions =
      user.role === "student" && assignments.length > 0
        ? await db
            .select()
            .from(assignmentSubmissionsTable)
            .where(
              and(
                eq(assignmentSubmissionsTable.studentId, user.id),
                inArray(
                  assignmentSubmissionsTable.assignmentId,
                  assignments.map((assignment) => assignment.id),
                ),
              ),
            )
        : [];
    const submissionByAssignment = new Map(
      submissions.map((submission) => [submission.assignmentId, submission]),
    );

    const withSubmission = assignments.map((assignment) => ({
      ...assignment,
      mySubmission: submissionByAssignment.get(assignment.id) ?? null,
    }));

    res.json({ assignments: withSubmission });
  },
);

router.post(
  "/classes/:classId/assignments",
  requireAuthenticatedRole("teacher", ...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "classId")) return;
    const classId = String(req.params.classId);
    const user = currentUser(res);
    const authorization = await authorizeClass(user, classId);

    if (!authorization) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    if (!authorization.canManage) {
      forbidden(res, "Only the class teacher or a school manager can create assignments.");
      return;
    }

    const title = readString(req.body, "title", 180);
    const subject = readString(req.body, "subject", 80);
    const description = readString(req.body, "description", 4_000);
    if (!title || !subject || !description) {
      res.status(400).json({
        error: "Title, subject, and description are required.",
      });
      return;
    }

    const dueAtResult = isRecord(req.body)
      ? parseDueAt(req.body.dueAt)
      : { ok: true as const, value: null };
    if (!dueAtResult.ok) {
      res.status(400).json({ error: "dueAt must be a valid ISO date." });
      return;
    }

    const requestedStatus =
      isRecord(req.body) && req.body.status !== undefined
        ? req.body.status
        : "assigned";
    if (!isAssignmentStatus(requestedStatus)) {
      res.status(400).json({ error: "Invalid assignment status." });
      return;
    }

    const [assignment] = await db
      .insert(assignmentsTable)
      .values({
        classId,
        createdBy: user.id,
        title,
        subject,
        description,
        dueAt: dueAtResult.value,
        status: requestedStatus,
      })
      .returning();

    res.status(201).json({ assignment });
  },
);

async function authorizeAssignment(
  user: AuthenticatedRequestUser,
  assignmentId: string,
) {
  const [assignment] = await db
    .select({
      id: assignmentsTable.id,
      classId: assignmentsTable.classId,
      createdBy: assignmentsTable.createdBy,
    })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);
  if (!assignment) return null;

  const authorization = await authorizeClass(user, assignment.classId);
  if (!authorization) return null;

  return {
    assignment,
    authorization,
    canEdit:
      authorization.canManage ||
      (authorization.canReview && assignment.createdBy === user.id),
  };
}

router.patch(
  "/assignments/:assignmentId",
  requireAuthenticatedRole("teacher", ...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "assignmentId")) return;
    const assignmentId = String(req.params.assignmentId);
    const user = currentUser(res);
    const context = await authorizeAssignment(user, assignmentId);

    if (!context) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!context.canEdit) {
      forbidden(res, "Assignment edit access denied.");
      return;
    }

    const changes: {
      title?: string;
      subject?: string;
      description?: string;
      dueAt?: Date | null;
      status?: AssignmentStatus;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (hasField(req.body, "title")) {
      const title = readString(req.body, "title", 180);
      if (!title) {
        res.status(400).json({ error: "A valid title is required." });
        return;
      }
      changes.title = title;
    }
    if (hasField(req.body, "subject")) {
      const subject = readString(req.body, "subject", 80);
      if (!subject) {
        res.status(400).json({ error: "A valid subject is required." });
        return;
      }
      changes.subject = subject;
    }
    if (hasField(req.body, "description")) {
      const description = readString(req.body, "description", 4_000);
      if (!description) {
        res.status(400).json({ error: "A valid description is required." });
        return;
      }
      changes.description = description;
    }
    if (hasField(req.body, "dueAt")) {
      const dueAtResult = parseDueAt((req.body as Record<string, unknown>).dueAt);
      if (!dueAtResult.ok) {
        res.status(400).json({ error: "dueAt must be a valid ISO date or null." });
        return;
      }
      changes.dueAt = dueAtResult.value;
    }
    if (hasField(req.body, "status")) {
      const status = (req.body as Record<string, unknown>).status;
      if (!isAssignmentStatus(status)) {
        res.status(400).json({ error: "Invalid assignment status." });
        return;
      }
      changes.status = status;
    }

    if (Object.keys(changes).length === 1) {
      res.status(400).json({ error: "No assignment changes were provided." });
      return;
    }

    const [assignment] = await db
      .update(assignmentsTable)
      .set(changes)
      .where(eq(assignmentsTable.id, assignmentId))
      .returning();

    res.json({ assignment });
  },
);

router.delete(
  "/assignments/:assignmentId",
  requireAuthenticatedRole("teacher", ...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "assignmentId")) return;
    const assignmentId = String(req.params.assignmentId);
    const user = currentUser(res);
    const context = await authorizeAssignment(user, assignmentId);

    if (!context) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!context.canEdit) {
      forbidden(res, "Assignment delete access denied.");
      return;
    }

    await db.delete(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
    res.status(204).end();
  },
);

router.get(
  "/assignments/:assignmentId/submissions",
  requireAuthenticatedRole("teacher", ...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "assignmentId")) return;
    const assignmentId = String(req.params.assignmentId);
    const user = currentUser(res);
    const context = await authorizeAssignment(user, assignmentId);

    if (!context) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!context.authorization.canReview) {
      forbidden(res, "Submission review access denied.");
      return;
    }

    const submissions = await db
      .select({
        id: assignmentSubmissionsTable.id,
        assignmentId: assignmentSubmissionsTable.assignmentId,
        studentId: assignmentSubmissionsTable.studentId,
        studentName: usersTable.username,
        status: assignmentSubmissionsTable.status,
        content: assignmentSubmissionsTable.content,
        score: assignmentSubmissionsTable.score,
        feedback: assignmentSubmissionsTable.feedback,
        submittedAt: assignmentSubmissionsTable.submittedAt,
        updatedAt: assignmentSubmissionsTable.updatedAt,
      })
      .from(assignmentSubmissionsTable)
      .innerJoin(usersTable, eq(assignmentSubmissionsTable.studentId, usersTable.id))
      .where(eq(assignmentSubmissionsTable.assignmentId, assignmentId))
      .orderBy(desc(assignmentSubmissionsTable.submittedAt));

    res.json({ submissions });
  },
);

router.post(
  "/assignments/:assignmentId/submissions",
  requireAuthenticatedRole("student"),
  async (req, res) => {
    if (!requireUuidParams(res, "assignmentId")) return;
    const assignmentId = String(req.params.assignmentId);
    const user = currentUser(res);
    const context = await authorizeAssignment(user, assignmentId);

    if (!context) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!context.authorization.canSubmit) {
      forbidden(res, "Only a student in this class can submit this assignment.");
      return;
    }

    const content = readString(req.body, "content", 10_000);
    if (!content) {
      res.status(400).json({ error: "Submission content is required." });
      return;
    }

    const [submission] = await db
      .insert(assignmentSubmissionsTable)
      .values({
        assignmentId,
        studentId: user.id,
        content,
        status: "submitted",
      })
      .onConflictDoUpdate({
        target: [
          assignmentSubmissionsTable.assignmentId,
          assignmentSubmissionsTable.studentId,
        ],
        set: {
          content,
          status: "submitted",
          submittedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json({ submission });
  },
);

router.patch(
  "/assignments/:assignmentId/submissions/:studentId",
  requireAuthenticatedRole("teacher", ...SCHOOL_MANAGEMENT_ROLES),
  async (req, res) => {
    if (!requireUuidParams(res, "assignmentId", "studentId")) return;
    const assignmentId = String(req.params.assignmentId);
    const studentId = String(req.params.studentId);
    const user = currentUser(res);
    const context = await authorizeAssignment(user, assignmentId);

    if (!context) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!context.authorization.canReview) {
      forbidden(res, "Submission review access denied.");
      return;
    }
    if (!hasField(req.body, "status") && !hasField(req.body, "score") && !hasField(req.body, "feedback")) {
      res.status(400).json({ error: "No review changes were provided." });
      return;
    }

    const changes: {
      status?: (typeof ASSIGNMENT_STATUSES)[number];
      score?: number | null;
      feedback?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (hasField(req.body, "status")) {
      const status = (req.body as Record<string, unknown>).status;
      if (!isReviewableSubmissionStatus(status)) {
        res.status(400).json({ error: "Invalid submission status." });
        return;
      }
      changes.status = status;
    }
    if (hasField(req.body, "score")) {
      const score = parseOptionalScore((req.body as Record<string, unknown>).score);
      if (score === undefined) {
        res.status(400).json({ error: "Score must be an integer from 0 to 100." });
        return;
      }
      changes.score = score;
    }
    if (hasField(req.body, "feedback")) {
      const rawFeedback = (req.body as Record<string, unknown>).feedback;
      const feedback = rawFeedback === "" ? "" : readString(req.body, "feedback", 4_000);
      if (feedback === undefined) {
        res.status(400).json({ error: "Feedback must be 4000 characters or fewer." });
        return;
      }
      changes.feedback = feedback;
    }

    const [updated] = await db
      .update(assignmentSubmissionsTable)
      .set(changes)
      .where(
        and(
          eq(assignmentSubmissionsTable.assignmentId, assignmentId),
          eq(assignmentSubmissionsTable.studentId, studentId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Submission not found." });
      return;
    }

    res.json({ submission: updated });
  },
);

/* -------------------------------------------------------------------------- */
/* Aggregated assignment feed                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  "/me/assignments",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  async (_req, res) => {
    const user = currentUser(res);
    let classIds: string[] | null = null;

    if (user.role === "student" || user.role === "teacher") {
      const rows = await db
        .select({ classId: classMembersTable.classId })
        .from(classMembersTable)
        .where(
          and(
            eq(classMembersTable.userId, user.id),
            eq(classMembersTable.role, user.role),
          ),
        );
      classIds = rows.map((row) => row.classId);
    } else if (isSchoolManagementRole(user.role)) {
      const memberships = await db
        .select({ schoolId: schoolMembersTable.schoolId, role: schoolMembersTable.role })
        .from(schoolMembersTable)
        .where(eq(schoolMembersTable.userId, user.id));
      const schoolIds = memberships
        .filter((membership) => isSchoolManagementRole(membership.role))
        .map((membership) => membership.schoolId);
      if (schoolIds.length === 0) {
        classIds = [];
      } else {
        const rows = await db
          .select({ classId: classesTable.id })
          .from(classesTable)
          .where(inArray(classesTable.schoolId, schoolIds));
        classIds = rows.map((row) => row.classId);
      }
    } else if (!isGlobalAdminRole(user.role)) {
      res.json({ assignments: [] });
      return;
    }

    if (classIds !== null && classIds.length === 0) {
      res.json({ assignments: [] });
      return;
    }

    const assignments =
      classIds === null
        ? await db
            .select(assignmentSelection)
            .from(assignmentsTable)
            .innerJoin(classesTable, eq(assignmentsTable.classId, classesTable.id))
            .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
            .innerJoin(usersTable, eq(assignmentsTable.createdBy, usersTable.id))
            .orderBy(desc(assignmentsTable.createdAt))
            .limit(200)
        : await db
            .select(assignmentSelection)
            .from(assignmentsTable)
            .innerJoin(classesTable, eq(assignmentsTable.classId, classesTable.id))
            .innerJoin(schoolsTable, eq(classesTable.schoolId, schoolsTable.id))
            .innerJoin(usersTable, eq(assignmentsTable.createdBy, usersTable.id))
            .where(inArray(assignmentsTable.classId, classIds))
            .orderBy(desc(assignmentsTable.createdAt))
            .limit(200);

    const submissions =
      user.role === "student" && assignments.length > 0
        ? await db
            .select()
            .from(assignmentSubmissionsTable)
            .where(
              and(
                eq(assignmentSubmissionsTable.studentId, user.id),
                inArray(
                  assignmentSubmissionsTable.assignmentId,
                  assignments.map((assignment) => assignment.id),
                ),
              ),
            )
        : [];
    const byAssignment = new Map(
      submissions.map((submission) => [submission.assignmentId, submission]),
    );

    res.json({
      assignments: assignments.map((assignment) => ({
        ...assignment,
        mySubmission: byAssignment.get(assignment.id) ?? null,
      })),
    });
  },
);

export default router;
