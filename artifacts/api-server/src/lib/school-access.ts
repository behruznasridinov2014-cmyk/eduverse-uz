import type { AccountRole } from "@workspace/db";

/**
 * Pure authorization and validation helpers for the school domain.
 *
 * Keeping these rules free of database access makes the permission model
 * inexpensive to unit test and hard to accidentally duplicate differently in
 * individual routes.
 */

export const GLOBAL_ADMIN_ROLES = [
  "education_admin",
  "ministry_admin",
  "platform_superadmin",
] as const;

export const SCHOOL_MANAGEMENT_ROLES = [
  "school_director",
  "school_admin",
  ...GLOBAL_ADMIN_ROLES,
] as const;

export const SCHOOL_MEMBER_ROLES = [
  "student",
  "teacher",
  "parent",
  "school_director",
  "school_admin",
] as const;

export const CLASS_MEMBER_ROLES = ["student", "teacher"] as const;

export const MEMBER_ROLES_A_SCHOOL_MANAGER_CAN_ADD = [
  "student",
  "teacher",
  "parent",
] as const;

export const ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "under_review",
  "needs_revision",
  "checked",
] as const;

export const REVIEWABLE_SUBMISSION_STATUSES = [
  "in_progress",
  "submitted",
  "under_review",
  "needs_revision",
  "checked",
] as const;

export type GlobalAdminRole = (typeof GLOBAL_ADMIN_ROLES)[number];
export type SchoolMemberRole = (typeof SCHOOL_MEMBER_ROLES)[number];
export type ClassMemberRole = (typeof CLASS_MEMBER_ROLES)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type ReviewableSubmissionStatus =
  (typeof REVIEWABLE_SUBMISSION_STATUSES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isGlobalAdminRole(value: string): value is GlobalAdminRole {
  return isOneOf(GLOBAL_ADMIN_ROLES, value);
}

export function isSchoolManagementRole(value: string): boolean {
  return isOneOf(SCHOOL_MANAGEMENT_ROLES, value);
}

export function isSchoolMemberRole(value: unknown): value is SchoolMemberRole {
  return isOneOf(SCHOOL_MEMBER_ROLES, value);
}

export function isClassMemberRole(value: unknown): value is ClassMemberRole {
  return isOneOf(CLASS_MEMBER_ROLES, value);
}

export function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return isOneOf(ASSIGNMENT_STATUSES, value);
}

export function isReviewableSubmissionStatus(
  value: unknown,
): value is ReviewableSubmissionStatus {
  return isOneOf(REVIEWABLE_SUBMISSION_STATUSES, value);
}

export function canAccessSchool(
  accountRole: AccountRole | string,
  membershipRole?: string | null,
): boolean {
  return isGlobalAdminRole(accountRole) || Boolean(membershipRole);
}

export function canManageSchool(
  accountRole: AccountRole | string,
  membershipRole?: string | null,
): boolean {
  return (
    isGlobalAdminRole(accountRole) ||
    (Boolean(membershipRole) && isSchoolManagementRole(membershipRole!))
  );
}

/**
 * A class can be managed by a global administrator, a manager of the parent
 * school, or a teacher who is a member of that specific class.
 */
export function canManageClass(
  accountRole: AccountRole | string,
  schoolMembershipRole: string | null | undefined,
  classMembershipRole: string | null | undefined,
): boolean {
  if (canManageSchool(accountRole, schoolMembershipRole)) return true;
  return classMembershipRole === "teacher";
}

/**
 * Assignments can be reviewed by managers of the parent school and by the
 * teacher who created them. A regular subject teacher in the class can also
 * review work, but students and parents cannot.
 */
export function canReviewAssignments(
  accountRole: AccountRole | string,
  schoolMembershipRole: string | null | undefined,
  classMembershipRole: string | null | undefined,
): boolean {
  if (canManageSchool(accountRole, schoolMembershipRole)) return true;
  return classMembershipRole === "teacher";
}

export function canSubmitAssignment(
  accountRole: AccountRole | string,
  classMembershipRole: string | null | undefined,
): boolean {
  return accountRole === "student" && classMembershipRole === "student";
}

export function cleanText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

export function parseBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

export function parseOptionalScore(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return parseBoundedInteger(value, 0, 100);
}

export type DueAtParseResult =
  | { ok: true; value: Date | null }
  | { ok: false };

export function parseDueAt(value: unknown): DueAtParseResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false };
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? { ok: false }
    : { ok: true, value: parsed };
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueConstraintViolation(error.cause);
}
