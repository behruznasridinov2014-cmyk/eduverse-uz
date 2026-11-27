import {
  boolean,
  jsonb,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const schoolMemberRoleEnum = pgEnum("school_member_role", ["student", "teacher", "parent", "school_director", "school_admin"]);
export const classMemberRoleEnum = pgEnum("class_member_role", ["student", "teacher"]);
export const assignmentStatusEnum = pgEnum("assignment_status", ["assigned", "in_progress", "submitted", "under_review", "needs_revision", "checked"]);
export const lessonModeEnum = pgEnum("lesson_mode", ["offline", "online"]);

export const schoolsTable = pgTable("schools", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  district: text("district"),
  address: text("address"),
  /**
   * free  — journal, attendance, homework, grades (always free);
   * pilot — everything, free until plan_until (trial for one quarter);
   * pro   — everything, paid (3D topics, 3D library, online lessons, trainer).
   */
  plan: text("plan").notNull().default("free"),
  /** A demo school made by the owner for showing EDUVERSE; it can be deleted with everyone in it. */
  isDemo: boolean("is_demo").notNull().default(false),
  /** Test mode set by the owner: today's lessons are open at any time (for trying the lesson). */
  lessonsAnyTime: boolean("lessons_any_time").notNull().default(false),
  planUntil: timestamp("plan_until", { withTimezone: true }),
  /** What the school pays the owner each month (sum, cash). 0 = not set. */
  monthlyFee: integer("monthly_fee").notNull().default(0),
  /** First month that is charged, "YYYY-MM". */
  billingStart: text("billing_start"),
  /** The currency of the monthly sum: "UZS" (сум) or "USD". */
  billingCurrency: text("billing_currency").notNull().default("UZS"),
  /** Day of the month the payment is due (1–28). */
  billingDay: integer("billing_day").notNull().default(1),
  /** Who to call about the payment, and the phone. */
  billingContact: text("billing_contact"),
  billingPhone: text("billing_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("schools_region_idx").on(table.region)]);

/** Cash the school paid the owner for EDUVERSE, one row per payment. */
export const schoolBillingPaymentsTable = pgTable("school_billing_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  /** The month it pays for, "YYYY-MM". */
  month: text("month").notNull(),
  paidOn: text("paid_on").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("school_billing_payments_school_idx").on(table.schoolId)]);

export const schoolMembersTable = pgTable("school_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: schoolMemberRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("school_members_school_user_unique").on(table.schoolId, table.userId),
  index("school_members_user_idx").on(table.userId),
  index("school_members_school_role_idx").on(table.schoolId, table.role),
]);

export const classesTable = pgTable("school_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  grade: integer("grade").notNull(),
  academicYear: text("academic_year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("school_classes_school_name_year_unique").on(table.schoolId, table.name, table.academicYear),
  index("school_classes_school_idx").on(table.schoolId),
]);

export const classMembersTable = pgTable("class_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: classMemberRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("class_members_class_user_unique").on(table.classId, table.userId),
  index("class_members_user_idx").on(table.userId),
]);

export const assignmentsTable = pgTable("assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  topicId: text("topic_id"),
  topicTitle: text("topic_title"),
  /** Set on homework given automatically from the textbook after a lesson: "book:<classId>:<topicKey>". */
  autoKey: text("auto_key"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: assignmentStatusEnum("status").notNull().default("assigned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("assignments_class_idx").on(table.classId), index("assignments_creator_idx").on(table.createdBy), uniqueIndex("assignments_auto_key_unique").on(table.autoKey)]);

export const assignmentSubmissionsTable = pgTable("assignment_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: assignmentStatusEnum("status").notNull().default("submitted"),
  content: text("content").notNull(),
  score: integer("score"),
  feedback: text("feedback").notNull().default(""),
  attachmentCount: integer("attachment_count").notNull().default(0),
  signature: text("signature"),
  signedBy: text("signed_by"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("assignment_submissions_assignment_student_unique").on(table.assignmentId, table.studentId),
  index("assignment_submissions_student_idx").on(table.studentId),
  index("assignment_submissions_assignment_status_idx").on(table.assignmentId, table.status),
]);

/** Notebook photos of a submission, stored as compressed data URLs (free-tier friendly). */
export const submissionFilesTable = pgTable("submission_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => assignmentSubmissionsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  data: text("data").notNull(),
  /** How the photo was taken (camera/gallery), when, which camera, and a small picture fingerprint — for the honest check. */
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("submission_files_submission_idx").on(table.submissionId)]);

export const lessonsTable = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  room: text("room"),
  mode: lessonModeEnum("mode").notNull().default("offline"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("lessons_class_time_idx").on(table.classId, table.startsAt), index("lessons_teacher_time_idx").on(table.teacherId, table.startsAt)]);
