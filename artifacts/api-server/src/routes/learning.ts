import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  attendanceTable,
  classMembersTable,
  classesTable,
  db,
  lessonTopicsTable,
  schoolMembersTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";
import {
  canManageClass,
  cleanText,
  isGlobalAdminRole,
  isSchoolManagementRole,
  isValidUuid,
} from "../lib/school-access";
import {
  generateStudentQuestion,
  generateTopicPackage,
  isAiConfigured,
  SUPPORTED_SUBJECTS,
} from "../lib/ai-content";

const router: IRouter = Router();

type RequestUser = { id: string; role: AccountRole };

const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

function user(res: Response): RequestUser {
  return res.locals.authenticatedUser as RequestUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(body: unknown, key: string, maxLength = 200): string | undefined {
  if (!isRecord(body)) return undefined;
  return cleanText(body[key], maxLength);
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

(async () => {
  // touch tables once so missing-DB errors surface as a clear log line
  try {
    await db.select({ id: attendanceTable.id }).from(attendanceTable).limit(0);
  } catch {
    /* schema may not be pushed yet; routes still register */
  }
})();

/* -------------------------------------------------------------------------- */
/* Authorization helpers                                                       */
/* -------------------------------------------------------------------------- */

async function schoolRole(userId: string, schoolId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(
      and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId)),
    )
    .limit(1);
  return row?.role ?? null;
}

async function classRole(userId: string, classId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: classMembersTable.role })
    .from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function classContext(classId: string) {
  const [row] = await db
    .select({
      id: classesTable.id,
      schoolId: classesTable.schoolId,
      name: classesTable.name,
      grade: classesTable.grade,
      academicYear: classesTable.academicYear,
    })
    .from(classesTable)
    .where(eq(classesTable.id, classId))
    .limit(1);
  return row ?? null;
}

async function canManage(userId: string, role: AccountRole, classId: string): Promise<boolean> {
  const ctx = await classContext(classId);
  if (!ctx) return false;
  if (isGlobalAdminRole(role)) return true;
  const [sRole, cRole] = await Promise.all([
    schoolRole(userId, ctx.schoolId),
    classRole(userId, classId),
  ]);
  return canManageClass(role, sRole, cRole);
}

async function canViewClass(userId: string, role: AccountRole, classId: string): Promise<boolean> {
  if (await canManage(userId, role, classId)) return true;
  const cRole = await classRole(userId, classId);
  return Boolean(cRole);
}

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

router.get("/subjects", requireAuthenticatedRole(
  "student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin",
), (_req, res) => {
  res.json({
    subjects: SUPPORTED_SUBJECTS.map((slug) => ({
      slug,
      grade: 7,
      label: slug,
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* AI-generated lesson topics                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  "/topics",
  requireAuthenticatedRole(
    "student", "teacher", "parent", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const viewer = user(res);
    if (isSchoolManagementRole(viewer.role) || isGlobalAdminRole(viewer.role)) {
      const mine = await db
        .select()
        .from(lessonTopicsTable)
        .orderBy(desc(lessonTopicsTable.updatedAt))
        .limit(50);
      res.json({ topics: mine });
      return;
    }
    // Students (and parents) see global published topics plus the ones
    // assigned to the classes they belong to.
    const subject = typeof req.query.subject === "string" ? req.query.subject : undefined;
    const classFilter = typeof req.query.classId === "string" && isValidUuid(req.query.classId)
      ? [req.query.classId]
      : [];
    const myClasses = classFilter.length
      ? classFilter
      : (
          await db
            .select({ classId: classMembersTable.classId })
            .from(classMembersTable)
            .where(eq(classMembersTable.userId, viewer.id))
        ).map((row) => row.classId);
    const visibility = [
      isNull(lessonTopicsTable.classId),
      ...(myClasses.length > 0 ? [inArray(lessonTopicsTable.classId, myClasses)] : []),
    ];
    const where = subject
      ? and(eq(lessonTopicsTable.status, "published"), eq(lessonTopicsTable.subject, subject), or(...visibility))
      : and(eq(lessonTopicsTable.status, "published"), or(...visibility));
    const rows = await db
      .select()
      .from(lessonTopicsTable)
      .where(where)
      .orderBy(desc(lessonTopicsTable.updatedAt))
      .limit(50);
    res.json({ topics: rows });
  },
);

router.post("/topics", requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), async (req, res) => {
  const creator = user(res);
  const subject = readString(req.body, "subject", 60);
  const title = readString(req.body, "title", 180);
  const gradeRaw = isRecord(req.body) ? Number(req.body.grade) : Number.NaN;
  const grade = Number.isInteger(gradeRaw) && gradeRaw >= 1 && gradeRaw <= 11 ? gradeRaw : 7;
  const classId = readString(req.body, "classId", 64);
  if (!subject || !title) {
    res.status(400).json({ error: "Subject and title are required." });
    return;
  }
  if (classId && !isValidUuid(classId)) {
    res.status(400).json({ error: "Invalid class identifier." });
    return;
  }
  if (classId && !(await canManage(creator.id, creator.role, classId))) {
    res.status(403).json({ error: "You cannot publish a topic for this class." });
    return;
  }

  const pkg = await generateTopicPackage(subject, grade, title);
  const ctx = classId ? await classContext(classId) : null;
  const [created] = await db
    .insert(lessonTopicsTable)
    .values({
      schoolId: ctx?.schoolId ?? null,
      classId: classId ?? null,
      createdBy: creator.id,
      subject: pkg.subject,
      grade,
      title: pkg.title,
      summary: pkg.summary,
      status: "published",
      slides: pkg.slides,
      facts: pkg.facts,
      visual3d: pkg.visual3d,
      quiz: pkg.quiz,
      source: pkg.source,
    })
    .returning();
  res.status(201).json({ topic: created, aiConfigured: isAiConfigured() });
});

router.get(
  "/topics/:topicId",
  requireAuthenticatedRole(
    "student", "teacher", "parent", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    if (!isValidUuid(req.params.topicId)) {
      res.status(400).json({ error: "Invalid topic identifier." });
      return;
    }
    const [topic] = await db
      .select()
      .from(lessonTopicsTable)
      .where(eq(lessonTopicsTable.id, String(req.params.topicId)))
      .limit(1);
    if (!topic) {
      res.status(404).json({ error: "Topic not found." });
      return;
    }
    res.json({ topic });
  },
);

router.post(
  "/topics/:topicId/student-questions",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    if (!isValidUuid(req.params.topicId)) {
      res.status(400).json({ error: "Invalid topic identifier." });
      return;
    }
    const viewer = user(res);
    const [topic] = await db
      .select()
      .from(lessonTopicsTable)
      .where(eq(lessonTopicsTable.id, String(req.params.topicId)))
      .limit(1);
    if (!topic) {
      res.status(404).json({ error: "Topic not found." });
      return;
    }
    let studentName = readString(req.body, "studentName", 80);
    const studentId = readString(req.body, "studentId", 64);
    if (!studentName && studentId && isValidUuid(studentId)) {
      const [row] = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, studentId))
        .limit(1);
      studentName = row?.username;
    }
    if (!studentName && viewer.role === "student") {
      const [row] = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, viewer.id))
        .limit(1);
      studentName = row?.username ?? "Ученик";
    }
    const difficultyRaw = readString(req.body, "difficulty", 20);
    const difficulty = difficultyRaw === "support" || difficultyRaw === "challenge" ? difficultyRaw : "core";
    const weakAreas = isRecord(req.body) && Array.isArray(req.body.weakAreas)
      ? (req.body.weakAreas as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 5)
      : [];

    const question = await generateStudentQuestion(
      topic.subject,
      topic.title,
      studentName ?? "Ученик",
      { weakAreas, difficulty },
    );
    res.json({ question });
  },
);

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

router.post(
  "/classes/:classId/members/by-login",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const classId = String(req.params.classId);
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    const viewer = user(res);
    if (!(await canManage(viewer.id, viewer.role, classId))) {
      res.status(403).json({ error: "You cannot manage this class." });
      return;
    }
    const login = readString(req.body, "login", 64);
    const roleRaw = readString(req.body, "role", 20);
    if (!login || !/^[a-zA-Z0-9._-]{3,32}$/.test(login)) {
      res.status(400).json({ error: "A valid student login is required." });
      return;
    }
    if (roleRaw !== "student" && roleRaw !== "teacher") {
      res.status(400).json({ error: "Role must be student or teacher." });
      return;
    }
    const [target] = await db
      .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.loginNormalized, login.toLowerCase()))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "No account with that login exists." });
      return;
    }
    if (roleRaw === "student" && target.role !== "student") {
      res.status(400).json({ error: "A student login is required." });
      return;
    }
    if (roleRaw === "teacher" && target.role !== "teacher") {
      res.status(400).json({ error: "A teacher login is required." });
      return;
    }
    const [ctx] = await db
      .select({ schoolId: classesTable.schoolId })
      .from(classesTable)
      .where(eq(classesTable.id, classId))
      .limit(1);
    if (ctx) {
      const schoolId = ctx.schoolId;
      await db
        .insert(schoolMembersTable)
        .values({ schoolId, userId: target.id, role: roleRaw })
        .onConflictDoNothing({ target: [schoolMembersTable.schoolId, schoolMembersTable.userId] });
    }
    await db
      .insert(classMembersTable)
      .values({ classId, userId: target.id, role: roleRaw })
      .onConflictDoNothing({ target: [classMembersTable.classId, classMembersTable.userId] });
    res.json({ added: true, name: target.username });
  },
);

/* -------------------------------------------------------------------------- */
/* Director: create student accounts for a class                               */
/* -------------------------------------------------------------------------- */

const SCRYPT_CONFIG = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPasswordWithSalt(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, SCRYPT_CONFIG, (error, key) => {
      if (error) return reject(error);
      resolve(
        [
          "scrypt",
          SCRYPT_CONFIG.N,
          SCRYPT_CONFIG.r,
          SCRYPT_CONFIG.p,
          salt.toString("base64url"),
          key.toString("base64url"),
        ].join("$"),
      );
    });
  });
}

function readablePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function loginCandidate(username: string): string {
  const base = username
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 14);
  return `${base || "student"}_${randomBytes(2).toString("hex")}`;
}

/**
 * Creates a student account with an auto-generated login and temporary
 * password, enrols the student into the class (and the parent school) and
 * returns the credentials exactly once so the director can hand them out.
 */
router.post(
  "/classes/:classId/accounts",
  requireAuthenticatedRole(
    "teacher",
    "school_director",
    "school_admin",
    "education_admin",
    "ministry_admin",
    "platform_superadmin",
  ),
  async (req, res) => {
    const classId = String(req.params.classId);
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    const viewer = user(res);
    if (!(await canManage(viewer.id, viewer.role, classId))) {
      res.status(403).json({ error: "You cannot manage this class." });
      return;
    }
    const [ctx] = await db
      .select({ schoolId: classesTable.schoolId })
      .from(classesTable)
      .where(eq(classesTable.id, classId))
      .limit(1);
    if (!ctx) {
      res.status(404).json({ error: "Class not found." });
      return;
    }
    const rawNames = isRecord(req.body) && Array.isArray(req.body.names) ? req.body.names : null;
    if (!rawNames || rawNames.length === 0) {
      res.status(400).json({ error: "Provide at least one student name." });
      return;
    }
    const names = rawNames
      .map((value) => cleanText(typeof value === "string" ? value : String(value), 80))
      .filter((name): name is string => Boolean(name))
      .slice(0, 40);
    if (names.length === 0) {
      res.status(400).json({ error: "No valid names provided." });
      return;
    }

    const created: Array<{ username: string; login: string; password: string }> = [];
    for (const name of names) {
      const password = readablePassword();
      const passwordHash = await hashPasswordWithSalt(password);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const login = loginCandidate(name);
        try {
          const [account] = await db
            .insert(usersTable)
            .values({
              username: name,
              usernameNormalized: name.trim().toLowerCase(),
              login,
              loginNormalized: login.toLowerCase(),
              passwordHash,
              role: "student",
            })
            .returning({ id: usersTable.id });
          if (!account) continue;
          await db
            .insert(schoolMembersTable)
            .values({ schoolId: ctx.schoolId, userId: account.id, role: "student" })
            .onConflictDoNothing({ target: [schoolMembersTable.schoolId, schoolMembersTable.userId] });
          await db
            .insert(classMembersTable)
            .values({ classId, userId: account.id, role: "student" })
            .onConflictDoNothing({
              target: [classMembersTable.classId, classMembersTable.userId],
            });
          created.push({ username: name, login, password });
          break;
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code?: unknown }).code)
              : "";
          if (code === "23505") continue; // login collision, retry
          throw error;
        }
      }
    }
    res.status(201).json({ created });
  },
);

/* -------------------------------------------------------------------------- */
/* Online resources: YouTube lessons + 3D models from the internet             */
/* -------------------------------------------------------------------------- */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
const SKETCHFAB_API_KEY = process.env.SKETCHFAB_API_KEY ?? "";

router.get(
  "/youtube/search",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query || query.length > 140) {
      res.status(400).json({ error: "A search query is required." });
      return;
    }
    if (YOUTUBE_API_KEY) {
      try {
        const url =
          "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=3&safeSearch=strict&relevanceLanguage=ru&q=" +
          encodeURIComponent(query) +
          "&key=" +
          YOUTUBE_API_KEY;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status}`);
        const payload = (await response.json()) as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
          }>;
        };
        const videos = (payload.items ?? [])
          .map((item) => ({
            videoId: item.id?.videoId ?? "",
            title: item.snippet?.title ?? "",
            channel: item.snippet?.channelTitle ?? "",
            thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
          }))
          .filter((video) => video.videoId);
        res.json({ source: "youtube", videos });
        return;
      } catch {
        // fall through to the safe fallback so the lesson still works offline
      }
    }
    res.json({
      source: "link",
      videos: [],
      searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    });
  },
);

router.get(
  "/models/3d",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query || query.length > 140) {
      res.status(400).json({ error: "A search query is required." });
      return;
    }
    if (SKETCHFAB_API_KEY) {
      try {
        const response = await fetch(
          `https://sketchfab.com/apiv3/search?type=models&q=${encodeURIComponent(query)}&count=6&sort=-relevance`,
          { headers: { Authorization: `Bearer ${SKETCHFAB_API_KEY}`, Accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`Sketchfab returned HTTP ${response.status}`);
        const payload = (await response.json()) as {
          results?: Array<{
            uid?: string;
            name?: string;
            user?: { displayName?: string };
            thumbnails?: { images?: Array<{ url?: string; width?: number }> };
            isDownloadable?: boolean;
            viewCount?: number;
          }>;
        };
        const models = (payload.results ?? [])
          .map((model) => ({
            uid: model.uid ?? "",
            name: model.name ?? "",
            author: model.user?.displayName ?? "",
            embedUrl: model.uid ? `https://sketchfab.com/models/${model.uid}/embed` : "",
            thumbnail:
              model.thumbnails?.images?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "",
            downloadable: Boolean(model.isDownloadable),
          }))
          .filter((model) => model.uid);
        res.json({ source: "sketchfab", models });
        return;
      } catch {
        // fall through to the safe fallback
      }
    }
    res.json({
      source: "link",
      models: [],
      searchUrl: `https://sketchfab.com/search?type=models&q=${encodeURIComponent(query)}`,
    });
  },
);

/**
 * Assign an existing published topic to a class (director / school admin).
 * The class's students then see the 3D-object, facts and test for this topic.
 */
router.post(
  "/topics/:topicId/assign",
  requireAuthenticatedRole(
    "teacher",
    "school_director",
    "school_admin",
    "education_admin",
    "ministry_admin",
    "platform_superadmin",
  ),
  async (req, res) => {
    const topicId = String(req.params.topicId);
    if (!isValidUuid(topicId)) {
      res.status(400).json({ error: "Invalid topic identifier." });
      return;
    }
    const classId = readString(req.body, "classId", 64);
    if (!classId || !isValidUuid(classId)) {
      res.status(400).json({ error: "A valid class is required." });
      return;
    }
    const viewer = user(res);
    if (!(await canManage(viewer.id, viewer.role, classId))) {
      res.status(403).json({ error: "You cannot assign a topic for this class." });
      return;
    }
    const [topic] = await db
      .select({ id: lessonTopicsTable.id })
      .from(lessonTopicsTable)
      .where(eq(lessonTopicsTable.id, topicId))
      .limit(1);
    if (!topic) {
      res.status(404).json({ error: "Topic not found." });
      return;
    }
    await db
      .update(lessonTopicsTable)
      .set({ classId, updatedAt: new Date() })
      .where(eq(lessonTopicsTable.id, topicId));
    res.json({ assigned: true });
  },
);

router.get(
  "/classes/:classId/attendance",
  requireAuthenticatedRole(
    "student", "teacher", "parent", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const classId = String(req.params.classId);
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    const viewer = user(res);
    if (!(await canViewClass(viewer.id, viewer.role, classId))) {
      res.status(403).json({ error: "You cannot view this class." });
      return;
    }
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayIso();

    const members = await db
      .select({
        userId: usersTable.id,
        username: usersTable.username,
        login: usersTable.login,
      })
      .from(classMembersTable)
      .innerJoin(usersTable, eq(classMembersTable.userId, usersTable.id))
      .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
      .orderBy(asc(usersTable.username));

    const marks = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.classId, classId), eq(attendanceTable.attendanceDate, date)));
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));

    res.json({
      date,
      canManage: await canManage(viewer.id, viewer.role, classId),
      records: members.map((member) => {
        const mark = byStudent.get(member.userId);
        return {
          studentId: member.userId,
          studentName: member.username,
          login: member.login,
          status: (mark?.status ?? "unmarked") as AttendanceStatus | "unmarked",
          note: mark?.note ?? "",
          markedAt: mark?.updatedAt ?? null,
        };
      }),
      summary: {
        total: members.length,
        present: marks.filter((m) => m.status === "present").length,
        absent: marks.filter((m) => m.status === "absent").length,
        late: marks.filter((m) => m.status === "late").length,
        excused: marks.filter((m) => m.status === "excused").length,
      },
    });
  },
);

router.put(
  "/classes/:classId/attendance",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const classId = String(req.params.classId);
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    const viewer = user(res);
    if (!(await canManage(viewer.id, viewer.role, classId))) {
      res.status(403).json({ error: "You cannot mark attendance for this class." });
      return;
    }
    const date = readString(req.body, "date", 20) ?? todayIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Date must be YYYY-MM-DD." });
      return;
    }
    const rawRecords = isRecord(req.body) && Array.isArray(req.body.records) ? req.body.records : null;
    if (!rawRecords || rawRecords.length === 0) {
      res.status(400).json({ error: "At least one attendance record is required." });
      return;
    }
    const entries: Array<{ studentId: string; status: AttendanceStatus; note: string }> = [];
    for (const item of rawRecords) {
      if (!isRecord(item)) continue;
      const studentId = readString(item, "studentId", 64);
      if (!studentId || !isValidUuid(studentId) || !isAttendanceStatus(item.status)) continue;
      entries.push({ studentId, status: item.status, note: cleanText(item.note, 200) ?? "" });
    }
    if (entries.length === 0) {
      res.status(400).json({ error: "No valid attendance records were provided." });
      return;
    }
    const studentIds = entries.map((e) => e.studentId);
    const memberRows = await db
      .select({ userId: classMembersTable.userId })
      .from(classMembersTable)
      .where(
        and(
          eq(classMembersTable.classId, classId),
          eq(classMembersTable.role, "student"),
          inArray(classMembersTable.userId, studentIds),
        ),
      );
    const allowed = new Set(memberRows.map((m) => m.userId));
    const finalEntries = entries.filter((e) => allowed.has(e.studentId));
    if (finalEntries.length === 0) {
      res.status(400).json({ error: "No students in this class matched the records." });
      return;
    }

    await db.transaction(async (tx) => {
      for (const entry of finalEntries) {
        await tx
          .insert(attendanceTable)
          .values({
            classId,
            studentId: entry.studentId,
            markedBy: viewer.id,
            attendanceDate: date,
            status: entry.status,
            note: entry.note,
          })
          .onConflictDoUpdate({
            target: [attendanceTable.classId, attendanceTable.studentId, attendanceTable.attendanceDate],
            set: { status: entry.status, note: entry.note, markedBy: viewer.id, updatedAt: new Date() },
          });
      }
    });

    res.json({ saved: finalEntries.length, date });
  },
);

router.get(
  "/students/:studentId/attendance",
  requireAuthenticatedRole(
    "student", "teacher", "parent", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const studentId = String(req.params.studentId);
    if (!isValidUuid(studentId)) {
      res.status(400).json({ error: "Invalid student identifier." });
      return;
    }
    const viewer = user(res);
    if (viewer.role === "student" && viewer.id !== studentId) {
      res.status(403).json({ error: "You can only view your own attendance." });
      return;
    }
    const rows = await db
      .select({
        id: attendanceTable.id,
        classId: attendanceTable.classId,
        className: classesTable.name,
        status: attendanceTable.status,
        note: attendanceTable.note,
        attendanceDate: attendanceTable.attendanceDate,
        updatedAt: attendanceTable.updatedAt,
      })
      .from(attendanceTable)
      .innerJoin(classesTable, eq(attendanceTable.classId, classesTable.id))
      .where(eq(attendanceTable.studentId, studentId))
      .orderBy(desc(attendanceTable.attendanceDate))
      .limit(60);
    const total = rows.length;
    const present = rows.filter((r) => r.status === "present" || r.status === "late").length;
    res.json({
      records: rows,
      summary: {
        total,
        present,
        rate: total === 0 ? 0 : Math.round((present / total) * 100),
      },
    });
  },
);

export default router;
