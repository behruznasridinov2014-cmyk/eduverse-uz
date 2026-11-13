import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { assignmentsTable, classesTable, schoolsTable } from "./school";

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "excused",
]);

export const attendanceTable = pgTable(
  "attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    markedBy: uuid("marked_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    attendanceDate: text("attendance_date").notNull(),
    status: attendanceStatusEnum("status").notNull().default("present"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_class_student_date_unique").on(
      table.classId,
      table.studentId,
      table.attendanceDate,
    ),
    index("attendance_class_date_idx").on(table.classId, table.attendanceDate),
    index("attendance_student_idx").on(table.studentId),
  ],
);

export const subjectsTable = pgTable(
  "subjects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    nameUz: text("name_uz").notNull().default(""),
    nameRu: text("name_ru").notNull().default(""),
    grade: integer("grade").notNull().default(7),
    accent: text("accent").notNull().default("blue"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("subjects_slug_grade_unique").on(table.slug, table.grade)],
);

export const lessonTopicStatusEnum = pgEnum("lesson_topic_status", [
  "draft",
  "published",
]);

export const lessonTopicsTable = pgTable(
  "lesson_topics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id").references(() => schoolsTable.id, {
      onDelete: "set null",
    }),
    classId: uuid("class_id").references(() => classesTable.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    grade: integer("grade").notNull().default(7),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: lessonTopicStatusEnum("status").notNull().default("draft"),
    slides: jsonb("slides").notNull().default([]),
    facts: jsonb("facts").notNull().default([]),
    visual3d: jsonb("visual_3d").notNull().default({}),
    quiz: jsonb("quiz").notNull().default({}),
    source: text("source").notNull().default("local"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lesson_topics_creator_idx").on(table.createdBy),
    index("lesson_topics_class_idx").on(table.classId),
    index("lesson_topics_subject_grade_idx").on(table.subject, table.grade),
  ],
);

export const lessonRoomStatusEnum = pgEnum("lesson_room_status", [
  "open",
  "live",
  "ended",
]);

export const lessonRoomsTable = pgTable(
  "lesson_rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    topicId: uuid("topic_id").references(() => lessonTopicsTable.id, {
      onDelete: "set null",
    }),
    classId: uuid("class_id").references(() => classesTable.id, {
      onDelete: "set null",
    }),
    schoolId: uuid("school_id").references(() => schoolsTable.id, {
      onDelete: "set null",
    }),
    hostId: uuid("host_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull().default(""),
    title: text("title").notNull().default(""),
    status: lessonRoomStatusEnum("status").notNull().default("open"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lesson_rooms_code_unique").on(table.code),
    index("lesson_rooms_host_idx").on(table.hostId),
    index("lesson_rooms_status_idx").on(table.status),
  ],
);

export const lessonRoomParticipantsTable = pgTable(
  "lesson_room_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").notNull().references(() => lessonRoomsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("student"),
    cameraOn: boolean("camera_on").notNull().default(false),
    micOn: boolean("mic_on").notNull().default(false),
    sharingScreen: boolean("sharing_screen").notNull().default(false),
    testPrompt: text("test_prompt").notNull().default(""),
    testChoices: jsonb("test_choices").notNull().default([]),
    testCorrect: text("test_correct").notNull().default(""),
    testExplanation: text("test_explanation").notNull().default(""),
    testAnswer: text("test_answer"),
    testScore: integer("test_score"),
    // Several questions per student: [{prompt, choices, correct, explanation, answer}]
    testItems: jsonb("test_items").notNull().default([]),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("lesson_room_participants_room_user_unique").on(
      table.roomId,
      table.userId,
    ),
    index("lesson_room_participants_room_idx").on(table.roomId),
  ],
);

export const lessonRoomSignalsTable = pgTable(
  "lesson_room_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").notNull().references(() => lessonRoomsTable.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    fromId: uuid("from_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    to: text("to").notNull().default("all"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lesson_room_signals_room_seq_unique").on(table.roomId, table.seq),
    index("lesson_room_signals_room_seq_idx").on(table.roomId, table.seq),
    index("lesson_room_signals_created_idx").on(table.createdAt),
  ],
);

export const quizAttemptsTable = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").references(() => lessonRoomsTable.id, {
      onDelete: "set null",
    }),
    topicId: uuid("topic_id").references(() => lessonTopicsTable.id, {
      onDelete: "set null",
    }),
    assignmentId: uuid("assignment_id").references(() => assignmentsTable.id, {
      onDelete: "set null",
    }),
    studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    total: integer("total").notNull().default(0),
    grade: integer("grade"),
    answers: jsonb("answers").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quiz_attempts_student_idx").on(table.studentId),
    index("quiz_attempts_room_idx").on(table.roomId),
    index("quiz_attempts_topic_idx").on(table.topicId),
  ],
);

export const qrLoginStatusEnum = pgEnum("qr_login_status", [
  "pending",
  "scanned",
  "approved",
  "consumed",
  "expired",
  "denied",
]);

export const qrLoginSessionsTable = pgTable(
  "qr_login_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceTokenHash: text("device_token_hash").notNull(),
    approveTokenHash: text("approve_token_hash").notNull(),
    code: text("code").notNull(),
    status: qrLoginStatusEnum("status").notNull().default("pending"),
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    deviceLabel: text("device_label").notNull().default(""),
    approvedBy: uuid("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    issuedSessionToken: text("issued_session_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("qr_login_sessions_device_token_unique").on(table.deviceTokenHash),
    uniqueIndex("qr_login_sessions_approve_token_unique").on(table.approveTokenHash),
    index("qr_login_sessions_code_idx").on(table.code),
    index("qr_login_sessions_status_idx").on(table.status),
    index("qr_login_sessions_expires_idx").on(table.expiresAt),
  ],
);
