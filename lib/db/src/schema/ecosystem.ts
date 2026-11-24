import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { classesTable, schoolsTable } from "./school";

/*
 * The school as one system: messages between parents and teachers, tuition payments of a
 * private school, and day-to-day timetable changes (a substitute teacher, a cancelled lesson).
 */

/** A parent ↔ teacher conversation about one pupil. */
export const familyMessagesTable = pgTable("family_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fromId: uuid("from_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("family_messages_thread_idx").on(table.teacherId, table.parentId, table.studentId, table.createdAt),
  index("family_messages_parent_idx").on(table.parentId, table.createdAt),
]);

/** What a pupil pays per month (a private school): the fee and a discount. */
export const tuitionPlansTable = pgTable("tuition_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Monthly fee in sums. */
  monthlyFee: integer("monthly_fee").notNull().default(0),
  discountPercent: integer("discount_percent").notNull().default(0),
  /** First month to pay for, YYYY-MM. */
  startMonth: text("start_month").notNull(),
  note: text("note").notNull().default(""),
  updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("tuition_plans_school_student_unique").on(table.schoolId, table.studentId)]);

/** One payment. Never deleted: a mistake is cancelled with a reason (kept for the audit). */
export const tuitionPaymentsTable = pgTable("tuition_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  /** The month it pays for, YYYY-MM. */
  month: text("month").notNull(),
  /** cash | card | transfer */
  method: text("method").notNull().default("cash"),
  paidOn: text("paid_on").notNull(),
  receiptNo: integer("receipt_no").notNull(),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
  cancelReason: text("cancel_reason").notNull().default(""),
}, (table) => [
  index("tuition_payments_school_month_idx").on(table.schoolId, table.month),
  index("tuition_payments_student_idx").on(table.studentId),
  uniqueIndex("tuition_payments_school_receipt_unique").on(table.schoolId, table.receiptNo),
]);

/** A change of one lesson on one day: a substitute teacher, a cancelled lesson or another room. */
export const timetableChangesTable = pgTable("timetable_changes", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  /** YYYY-MM-DD (Tashkent). */
  date: text("date").notNull(),
  period: integer("period").notNull(),
  /** substitute | cancelled | room */
  kind: text("kind").notNull(),
  teacherId: uuid("teacher_id").references(() => usersTable.id, { onDelete: "set null" }),
  room: text("room"),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("timetable_changes_class_date_period_unique").on(table.classId, table.date, table.period),
  index("timetable_changes_school_date_idx").on(table.schoolId, table.date),
]);
