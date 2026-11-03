import {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("schools_region_idx").on(table.region)]);

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
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: assignmentStatusEnum("status").notNull().default("assigned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("assignments_class_idx").on(table.classId), index("assignments_creator_idx").on(table.createdBy)]);

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
