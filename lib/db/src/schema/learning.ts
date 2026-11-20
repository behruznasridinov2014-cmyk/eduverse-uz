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
    /** The lesson's subject: every teacher marks their own lesson ("" = old whole-day mark). */
    subject: text("subject").notNull().default(""),
    status: attendanceStatusEnum("status").notNull().default("present"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_class_student_date_subject_unique").on(
      table.classId,
      table.studentId,
      table.attendanceDate,
      table.subject,
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
    // Topic from the class textbook (course-data key) shown in the lesson.
    courseKey: text("course_key"),
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

/** Short messages from a teacher to a whole class (shown on the home page). */
export const classAnnouncementsTable = pgTable(
  "class_announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("class_announcements_class_idx").on(table.classId)],
);

/** A parent account linked to a student account (set by school staff). */
export const parentLinksTable = pgTable(
  "parent_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parent_links_parent_student_unique").on(table.parentId, table.studentId),
    index("parent_links_student_idx").on(table.studentId),
  ],
);

/** Telegram chat that receives school notifications for an account. */
export const telegramNotifyTable = pgTable("telegram_notify", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  chatId: text("chat_id"),
  nonce: text("nonce"),
  nonceExpiresAt: timestamp("nonce_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("telegram_notify_nonce_unique").on(table.nonce)]);

/** A virtual lab report done by a student (measurements, result, grade). */
export const labReportsTable = pgTable("lab_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lab: text("lab").notNull(),
  data: jsonb("data").notNull().default({}),
  result: text("result").notNull().default(""),
  errorPercent: integer("error_percent"),
  grade: integer("grade"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("lab_reports_student_idx").on(table.studentId)]);

/** A student's (or teacher's) own drawings on top of a textbook page — like writing in a notebook. */
export const bookAnnotationsTable = pgTable("book_annotations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  book: text("book").notNull(),
  page: integer("page").notNull(),
  /** Strokes in page-relative coordinates (0…1), so they fit any zoom. */
  strokes: jsonb("strokes").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("book_annotations_user_book_page_unique").on(table.userId, table.book, table.page)]);

/** Where a class stopped in a textbook: one row per topic covered in class, with its date. */
export const courseProgressTable = pgTable("course_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  topicKey: text("topic_key").notNull(),
  /** Lesson date, YYYY-MM-DD. */
  doneOn: text("done_on").notNull(),
  markedBy: uuid("marked_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("course_progress_class_topic_unique").on(table.classId, table.topicKey),
  index("course_progress_class_idx").on(table.classId),
]);

/** Lessons per week a class has for one textbook (used for the finish forecast). */
export const coursePaceTable = pgTable("course_pace", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  book: text("book").notNull(),
  lessonsPerWeek: integer("lessons_per_week").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("course_pace_class_book_unique").on(table.classId, table.book)]);

/** In-app notifications (the bell): grades, homework, messages, announcements, lessons, security. */
export const userNotificationsTable = pgTable("user_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("user_notifications_user_created_idx").on(table.userId, table.createdAt)]);

/**
 * In-app support chat. One thread per user and channel:
 *  - "curator": the user ↔ EDUVERSE curators (platform staff);
 *  - "school":  the user ↔ the administration of their school.
 */
export const supportMessagesTable = pgTable("support_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadUserId: uuid("thread_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  schoolId: uuid("school_id").references(() => schoolsTable.id, { onDelete: "set null" }),
  authorId: uuid("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  fromStaff: boolean("from_staff").notNull().default(false),
  body: text("body").notNull(),
  readByOwner: boolean("read_by_owner").notNull().default(false),
  readByStaff: boolean("read_by_staff").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("support_messages_thread_idx").on(table.threadUserId, table.channel, table.createdAt),
  index("support_messages_school_idx").on(table.schoolId, table.channel),
]);

/**
 * The school's own year calendar: four quarters and any extra days off (holidays,
 * quarantine). The textbook forecast counts only these school weeks.
 */
export const schoolCalendarTable = pgTable("school_calendar", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  /** [{ start: "2026-09-02", end: "2026-10-31" }, ...] — exactly four, in order. */
  quarters: jsonb("quarters").notNull(),
  /** [{ from: "2026-12-31", to: "2027-01-02", name: "Новый год" }, ...] */
  holidays: jsonb("holidays").notNull().default([]),
  updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("school_calendar_school_unique").on(table.schoolId)]);

/**
 * A school's request to EDUVERSE: enrol pupils, expel / transfer / graduate one,
 * restore one, or correct a person's details. The owner approves or rejects it.
 */
export const schoolRequestsTable = pgTable("school_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** enroll | expel | transfer | graduate | restore | edit */
  kind: text("kind").notNull(),
  /** The person the request is about (null for enroll). */
  targetUserId: uuid("target_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").notNull().default({}),
  reason: text("reason").notNull().default(""),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  /** What approving did, e.g. created logins (without passwords). */
  result: jsonb("result").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("school_requests_status_idx").on(table.status, table.createdAt),
  index("school_requests_school_idx").on(table.schoolId, table.createdAt),
]);

/** Who created, changed or removed what — kept for every school. */
export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").references(() => schoolsTable.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_log_school_idx").on(table.schoolId, table.createdAt)]);

/** Daily trainer: one result per pupil per day; the class rating sums the last 7 days. */
export const trainerResultsTable = pgTable("trainer_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  classId: uuid("class_id").references(() => classesTable.id, { onDelete: "set null" }),
  /** YYYY-MM-DD */
  day: text("day").notNull(),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trainer_results_user_day_unique").on(table.userId, table.day),
  index("trainer_results_class_day_idx").on(table.classId, table.day),
]);

/**
 * Trainer test of one subject on one lesson day: 8 questions on the topic of that lesson.
 * A pupil may redo it within 24 hours of the lesson; the best score stays.
 */
export const trainerTestsTable = pgTable("trainer_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  classId: uuid("class_id").references(() => classesTable.id, { onDelete: "set null" }),
  /** YYYY-MM-DD: the lesson day */
  day: text("day").notNull(),
  /** textbook subject key: physics / chemistry / biology / math */
  subject: text("subject").notNull(),
  topicKey: text("topic_key").notNull().default(""),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  attempts: integer("attempts").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trainer_tests_user_day_subject_unique").on(table.userId, table.day, table.subject),
  index("trainer_tests_class_day_idx").on(table.classId, table.day),
]);

/**
 * The school's weekly timetable: on which weekday (1 = Monday … 6 = Saturday) and in which
 * period a class has which subject and with which teacher. The bell times of the periods are
 * kept per school in `school_bells`. Subject is the textbook subject key
 * (physics / chemistry / biology / math) or any other subject name.
 */
export const timetableSlotsTable = pgTable("timetable_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  period: integer("period").notNull(),
  subject: text("subject").notNull(),
  teacherId: uuid("teacher_id").references(() => usersTable.id, { onDelete: "set null" }),
  room: text("room"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("timetable_slots_class_day_period_unique").on(table.classId, table.weekday, table.period),
  index("timetable_slots_teacher_idx").on(table.teacherId, table.weekday),
  index("timetable_slots_school_idx").on(table.schoolId),
]);

/** Bell times of a school: [{ start: "08:30", end: "09:15" }, …], period 1 first. */
export const schoolBellsTable = pgTable("school_bells", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
  periods: jsonb("periods").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("school_bells_school_unique").on(table.schoolId)]);
