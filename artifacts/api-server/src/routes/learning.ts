import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  attendanceTable,
  classAnnouncementsTable,
  classMembersTable,
  classesTable,
  db,
  lessonRoomsTable,
  lessonTopicsTable,
  parentLinksTable,
  schoolMembersTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, normalizeUsername, requireAuthenticatedRole } from "./auth";
import {
  canManageClass,
  cleanText,
  isGlobalAdminRole,
  isSchoolManagementRole,
  isValidUuid,
} from "../lib/school-access";
import {
  answerTutorQuestion,
  generateStudentQuestion,
  generateTopicPackage,
  generateTopicTest,
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
    const requestedClasses = typeof req.query.classId === "string" && isValidUuid(req.query.classId)
      ? [req.query.classId]
      : [];
    const memberClasses = (
      await db
        .select({ classId: classMembersTable.classId })
        .from(classMembersTable)
        .where(eq(classMembersTable.userId, viewer.id))
    ).map((row) => row.classId);
    // A requested class is only used when the viewer really belongs to it.
    const myClasses = requestedClasses.length
      ? requestedClasses.filter((classId) => memberClasses.includes(classId))
      : memberClasses;
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
  // A topic can only be published for a class the creator may manage.
  let effectiveClassId = classId ?? null;
  if (effectiveClassId && !(await canManage(creator.id, creator.role, effectiveClassId))) {
    res.status(403).json({ error: "You cannot publish a topic for this class." });
    return;
  }

  const pkg = await generateTopicPackage(subject, grade, title);
  const ctx = effectiveClassId ? await classContext(effectiveClassId) : null;
  const [created] = await db
    .insert(lessonTopicsTable)
    .values({
      schoolId: ctx?.schoolId ?? null,
      classId: effectiveClassId ?? null,
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
    const viewer = user(res);
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
    // A topic is either published for everybody or bound to a class. Drafts
    // and topics of other classes stay hidden.
    if (topic.status !== "published" || topic.classId) {
      const allowed =
        topic.createdBy === viewer.id ||
        isGlobalAdminRole(viewer.role) ||
        (topic.classId
          ? topic.status === "published"
            // Members of the class read the published topic (it is shown in
            // their online lesson); only managers see drafts.
            ? await canViewClass(viewer.id, viewer.role, topic.classId)
            : await canManage(viewer.id, viewer.role, topic.classId)
          : false);
      if (!allowed) {
        res.status(403).json({ error: "You cannot read this topic." });
        return;
      }
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
      // The same answer for "unknown login" and "wrong role" so that the
      // endpoint cannot be used to find out which logins exist.
      res.status(404).json({ error: "No matching account was found." });
      return;
    }
    if (roleRaw === "student" && target.role !== "student") {
      res.status(404).json({ error: "No matching account was found." });
      return;
    }
    if (roleRaw === "teacher" && target.role !== "teacher") {
      res.status(404).json({ error: "No matching account was found." });
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
              usernameNormalized: normalizeUsername(name),
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
          if (code !== "23505") throw error;
          // The unique index can be on the login or on the normalised name. Only
          // a login collision can be solved with another attempt.
          const detail = String((error as { detail?: unknown }).detail ?? "");
          if (detail.includes("username_normalized")) {
            res.status(409).json({ error: `A student with the name "${name}" already exists.` });
            return;
          }
          // login collision — retry with another login
        }
      }
    }
    res.status(201).json({ created });
  },
);

/* -------------------------------------------------------------------------- */
/* Online resources: YouTube lessons + 3D models from the internet             */
/* -------------------------------------------------------------------------- */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const SKETCHFAB_API_KEY = process.env.SKETCHFAB_API_KEY ?? "";

router.get(
  "/youtube/search",
  requireAuthenticatedRole(
    "student", "teacher", "parent", "school_director", "school_admin",
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
        // fall through to the no-key fallback so the lesson still works
      }
    }
    // No-key fallback: search the public YouTube results page and extract IDs.
    try {
      const html = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } },
      ).then((r) => (r.ok ? r.text() : ""));
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)]
        .map((m) => m[1])
        .filter((id) => id !== "dQw4w9WgXcQ");
      const unique = [...new Set(ids)].slice(0, 3);
      if (unique.length > 0) {
        const videos = unique.map((videoId, index) => ({
          videoId,
          title: `Видео по теме — ${query}`,
          channel: "",
          thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          rank: index,
        }));
        res.json({ source: "youtube", videos });
        return;
      }
    } catch {
      // fall through to the link fallback
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
    "student", "teacher", "parent", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query || query.length > 140) {
      res.status(400).json({ error: "A search query is required." });
      return;
    }
    try {
      // The public Sketchfab search works without an API token. A token is
      // only used when the deployment has one (it raises the rate limit).
      const headers: Record<string, string> = { Accept: "application/json" };
      if (SKETCHFAB_API_KEY) headers.Authorization = `Bearer ${SKETCHFAB_API_KEY}`;
      const response = await fetch(
        `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(query)}&count=8&sort=-likeCount`,
        { headers },
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
          likeCount?: number;
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
          likes: model.likeCount ?? 0,
        }))
        .filter((model) => model.uid);
      res.json({ source: "sketchfab", models });
      return;
    } catch {
      // fall through to the safe fallback
    }
    res.json({
      source: "link",
      models: [],
      searchUrl: `https://sketchfab.com/search?type=models&q=${encodeURIComponent(query)}`,
    });
  },
);

/**
 * Create a multiple-question test for a published topic. Teachers and school
 * managers can create and re-create it; students see the generated test in the
 * topic page. The same topic can be regenerated whenever a new test is wanted.
 */
router.post(
  "/topics/:topicId/test",
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
    const viewer = user(res);
    const classId = readString(req.body, "classId", 64);
    if (classId !== undefined && !isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    const requestedCountRaw = isRecord(req.body) ? Number(req.body.count) : Number.NaN;
    const count = Number.isInteger(requestedCountRaw)
      ? Math.max(1, Math.min(10, requestedCountRaw))
      : 5;
    const [topic] = await db
      .select()
      .from(lessonTopicsTable)
      .where(eq(lessonTopicsTable.id, topicId))
      .limit(1);
    if (!topic) {
      res.status(404).json({ error: "Topic not found." });
      return;
    }
    // Only the author of the topic or a manager of its class may replace it.
    if (
      topic.createdBy !== viewer.id &&
      !(topic.classId ? await canManage(viewer.id, viewer.role, topic.classId) : false) &&
      !isGlobalAdminRole(viewer.role)
    ) {
      res.status(403).json({ error: "You cannot change the test of this topic." });
      return;
    }
    // Test can always be created for the topic — class filter is optional.
    const questions = await generateTopicTest(topic.subject, topic.grade, topic.title, count);
    const quizWithQuestions = {
      ...(typeof topic.quiz === "object" && topic.quiz !== null ? topic.quiz : {}),
      prompt: questions[0]?.prompt ?? "Тест по теме",
      choices: questions[0]?.choices ?? [],
      correct: questions[0]?.correct ?? "",
      explanation: questions[0]?.explanation ?? "",
      questions,
    };
    await db
      .update(lessonTopicsTable)
      .set({ quiz: quizWithQuestions, status: "published", updatedAt: new Date() })
      .where(eq(lessonTopicsTable.id, topicId));
    res.json({ questions });
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

    const mayManage = await canManage(viewer.id, viewer.role, classId);
    res.json({
      date,
      canManage: mayManage,
      records: members.map((member) => {
        const mark = byStudent.get(member.userId);
        return {
          studentId: member.userId,
          studentName: member.username,
          // The login is the account identifier used to sign in — it is only
          // shown to the people who may manage the class.
          ...(mayManage ? { login: member.login } : {}),
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
    if (rawRecords.length > 200) {
      res.status(413).json({ error: "Too many attendance records in one request." });
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
    if (viewer.role !== "student") {
      // A teacher or a parent may only see the attendance of students they are
      // responsible for.
      const rows = await db
        .select({ classId: attendanceTable.classId })
        .from(attendanceTable)
        .where(eq(attendanceTable.studentId, studentId));
      const allowed =
        rows.length > 0 &&
        (await Promise.all(rows.map((row) => canManage(viewer.id, viewer.role, row.classId)))).every(Boolean);
      if (!allowed) {
        res.status(403).json({ error: "You cannot view the attendance of this student." });
        return;
      }
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

/* -------------------------------------------------------------------------- */
/* Class announcements                                                         */
/* -------------------------------------------------------------------------- */

const everyRole = [
  "student", "teacher", "parent", "school_director", "school_admin",
  "education_admin", "ministry_admin", "platform_superadmin",
] as const;
const staffRoles = ["teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;

router.get("/me/announcements", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = user(res);
  const memberClasses = (
    await db
      .select({ classId: classMembersTable.classId })
      .from(classMembersTable)
      .where(eq(classMembersTable.userId, viewer.id))
  ).map((row) => row.classId);
  if (!memberClasses.length) {
    res.json({ announcements: [] });
    return;
  }
  const rows = await db
    .select({
      id: classAnnouncementsTable.id,
      classId: classAnnouncementsTable.classId,
      className: classesTable.name,
      authorId: classAnnouncementsTable.authorId,
      authorName: usersTable.username,
      body: classAnnouncementsTable.body,
      createdAt: classAnnouncementsTable.createdAt,
    })
    .from(classAnnouncementsTable)
    .innerJoin(classesTable, eq(classAnnouncementsTable.classId, classesTable.id))
    .innerJoin(usersTable, eq(classAnnouncementsTable.authorId, usersTable.id))
    .where(inArray(classAnnouncementsTable.classId, memberClasses))
    .orderBy(desc(classAnnouncementsTable.createdAt))
    .limit(20);
  res.json({ announcements: rows });
});

router.post("/classes/:classId/announcements", requireAuthenticatedRole(...staffRoles), async (req, res) => {
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
  const body = readString(req.body, "body", 600);
  if (!body) {
    res.status(400).json({ error: "The announcement text is required." });
    return;
  }
  const [created] = await db
    .insert(classAnnouncementsTable)
    .values({ classId, authorId: viewer.id, body })
    .returning();
  res.status(201).json({ announcement: created });
});

router.delete("/announcements/:announcementId", requireAuthenticatedRole(...staffRoles), async (req, res) => {
  const id = String(req.params.announcementId);
  if (!isValidUuid(id)) {
    res.status(400).json({ error: "Invalid announcement identifier." });
    return;
  }
  const viewer = user(res);
  const [row] = await db.select().from(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Announcement not found." });
    return;
  }
  if (row.authorId !== viewer.id && !(await canManage(viewer.id, viewer.role, row.classId))) {
    res.status(403).json({ error: "You cannot delete this announcement." });
    return;
  }
  await db.delete(classAnnouncementsTable).where(eq(classAnnouncementsTable.id, id));
  res.status(204).end();
});

/* -------------------------------------------------------------------------- */
/* Grade journal of a class                                                    */
/* -------------------------------------------------------------------------- */

router.get("/classes/:classId/journal", requireAuthenticatedRole(...staffRoles), async (req, res) => {
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
  const [students, assignments, attendance] = await Promise.all([
    db
      .select({ id: usersTable.id, name: usersTable.username })
      .from(classMembersTable)
      .innerJoin(usersTable, eq(classMembersTable.userId, usersTable.id))
      .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
      .orderBy(asc(usersTable.username)),
    db
      .select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject })
      .from(assignmentsTable)
      .where(eq(assignmentsTable.classId, classId))
      .orderBy(asc(assignmentsTable.createdAt))
      .limit(30),
    db
      .select({ studentId: attendanceTable.studentId, status: attendanceTable.status })
      .from(attendanceTable)
      .where(eq(attendanceTable.classId, classId)),
  ]);
  const submissions = assignments.length
    ? await db
        .select({
          assignmentId: assignmentSubmissionsTable.assignmentId,
          studentId: assignmentSubmissionsTable.studentId,
          score: assignmentSubmissionsTable.score,
        })
        .from(assignmentSubmissionsTable)
        .where(inArray(assignmentSubmissionsTable.assignmentId, assignments.map((item) => item.id)))
    : [];
  const rows = students.map((student) => {
    const cells = assignments.map((assignment) => {
      const submission = submissions.find((item) => item.assignmentId === assignment.id && item.studentId === student.id);
      if (!submission) return { state: "missing" as const, grade: null };
      if (submission.score === null) return { state: "review" as const, grade: null };
      return { state: "graded" as const, grade: Math.max(2, Math.min(5, Math.round(submission.score / 20))) };
    });
    const grades = cells.map((cell) => cell.grade).filter((grade): grade is number => grade !== null);
    const marks = attendance.filter((item) => item.studentId === student.id);
    const attended = marks.filter((item) => item.status === "present" || item.status === "late").length;
    return {
      studentId: student.id,
      studentName: student.name,
      cells,
      average: grades.length ? Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 10) / 10 : null,
      attendancePercent: marks.length ? Math.round((attended / marks.length) * 100) : null,
    };
  });
  res.json({ assignments, rows });
});

/* -------------------------------------------------------------------------- */
/* The viewer's own attendance summary                                         */
/* -------------------------------------------------------------------------- */

const tutorLimiter = createRateLimiter(30, 10 * 60 * 1000, "Too many AI questions. Wait a few minutes.", "ai-tutor");

/**
 * AI tutor: answers a free question, grounded in a topic when one is given.
 * Available to every signed-in school role; rate limited per account/IP.
 */
router.post("/ai/tutor", requireAuthenticatedRole(...everyRole), tutorLimiter, async (req, res) => {
  const question = readString(req.body, "question", 500);
  if (!question) {
    res.status(400).json({ error: "A question is required." });
    return;
  }
  const topicId = readString(req.body, "topicId", 64);
  let context: { subject?: string; title?: string; facts?: string[] } = {};
  if (topicId && isValidUuid(topicId)) {
    const [topic] = await db
      .select({ subject: lessonTopicsTable.subject, title: lessonTopicsTable.title, facts: lessonTopicsTable.facts })
      .from(lessonTopicsTable)
      .where(eq(lessonTopicsTable.id, topicId))
      .limit(1);
    if (topic) {
      context = {
        subject: topic.subject,
        title: topic.title,
        facts: Array.isArray(topic.facts)
          ? (topic.facts as Array<{ text?: string }>).map((fact) => fact?.text ?? "").filter(Boolean)
          : [],
      };
    }
  }
  const answer = await answerTutorQuestion(question, context);
  if (!answer) {
    res.status(503).json({ error: "The AI assistant is not available right now." });
    return;
  }
  res.json({ answer });
});

router.get("/me/attendance-summary", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = user(res);
  const rows = await db
    .select({ status: attendanceTable.status, date: attendanceTable.attendanceDate })
    .from(attendanceTable)
    .where(eq(attendanceTable.studentId, viewer.id))
    .orderBy(desc(attendanceTable.attendanceDate))
    .limit(200);
  const count = (status: string) => rows.filter((row) => row.status === status).length;
  res.json({
    total: rows.length,
    present: count("present"),
    late: count("late"),
    absent: count("absent"),
    excused: count("excused"),
    recent: rows.slice(0, 10),
  });
});

/* -------------------------------------------------------------------------- */
/* Parents: link to a child, family cabinet                                    */
/* -------------------------------------------------------------------------- */

const managerRoles = ["teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;

/** Staff link a parent account to a student of a class they manage. */
router.post("/parents/links", requireAuthenticatedRole(...managerRoles), async (req, res) => {
  const viewer = user(res);
  const parentLogin = readString(req.body, "parentLogin", 64)?.toLowerCase();
  const studentLogin = readString(req.body, "studentLogin", 64)?.toLowerCase();
  if (!parentLogin || !studentLogin) {
    res.status(400).json({ error: "Parent and student logins are required." });
    return;
  }
  const [parent] = await db.select({ id: usersTable.id, role: usersTable.role, name: usersTable.username }).from(usersTable).where(eq(usersTable.loginNormalized, parentLogin)).limit(1);
  const [student] = await db.select({ id: usersTable.id, role: usersTable.role, name: usersTable.username }).from(usersTable).where(eq(usersTable.loginNormalized, studentLogin)).limit(1);
  if (!parent || parent.role !== "parent" || !student || student.role !== "student") {
    res.status(404).json({ error: "No matching parent and student accounts were found." });
    return;
  }
  const classes = await db.select({ classId: classMembersTable.classId }).from(classMembersTable).where(eq(classMembersTable.userId, student.id));
  const allowed = isGlobalAdminRole(viewer.role) || (await Promise.all(classes.map((row) => canManage(viewer.id, viewer.role, row.classId)))).some(Boolean);
  if (!allowed) {
    res.status(403).json({ error: "You can only link parents of your own students." });
    return;
  }
  await db.insert(parentLinksTable).values({ parentId: parent.id, studentId: student.id, createdBy: viewer.id }).onConflictDoNothing();
  // The parent joins the child's school so school-wide data is visible.
  for (const row of classes) {
    const [ctx] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, row.classId)).limit(1);
    if (ctx) await db.insert(schoolMembersTable).values({ schoolId: ctx.schoolId, userId: parent.id, role: "parent" }).onConflictDoNothing();
  }
  res.status(201).json({ linked: true, parent: parent.name, student: student.name });
});

/** Everything a parent needs about each linked child, in one request. */
router.get("/me/children", requireAuthenticatedRole("parent"), async (_req, res) => {
  const viewer = user(res);
  const links = await db
    .select({ id: usersTable.id, name: usersTable.username })
    .from(parentLinksTable)
    .innerJoin(usersTable, eq(parentLinksTable.studentId, usersTable.id))
    .where(eq(parentLinksTable.parentId, viewer.id));
  const children = [];
  for (const child of links) {
    const classes = await db
      .select({ id: classesTable.id, name: classesTable.name })
      .from(classMembersTable)
      .innerJoin(classesTable, eq(classMembersTable.classId, classesTable.id))
      .where(and(eq(classMembersTable.userId, child.id), eq(classMembersTable.role, "student")));
    const classIds = classes.map((item) => item.id);
    const assignments = classIds.length
      ? await db
          .select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject, dueAt: assignmentsTable.dueAt })
          .from(assignmentsTable)
          .where(inArray(assignmentsTable.classId, classIds))
          .orderBy(desc(assignmentsTable.createdAt))
          .limit(20)
      : [];
    const submissions = assignments.length
      ? await db
          .select({ assignmentId: assignmentSubmissionsTable.assignmentId, score: assignmentSubmissionsTable.score, feedback: assignmentSubmissionsTable.feedback })
          .from(assignmentSubmissionsTable)
          .where(and(eq(assignmentSubmissionsTable.studentId, child.id), inArray(assignmentSubmissionsTable.assignmentId, assignments.map((item) => item.id))))
      : [];
    const homework = assignments.map((item) => {
      const sub = submissions.find((row) => row.assignmentId === item.id);
      return {
        ...item,
        state: !sub ? "missing" : sub.score === null ? "review" : "graded",
        grade: sub && sub.score !== null ? Math.max(2, Math.min(5, Math.round(sub.score / 20))) : null,
        feedback: sub?.feedback ?? "",
      };
    });
    const marks = await db
      .select({ status: attendanceTable.status, date: attendanceTable.attendanceDate })
      .from(attendanceTable)
      .where(eq(attendanceTable.studentId, child.id))
      .orderBy(desc(attendanceTable.attendanceDate))
      .limit(60);
    const attended = marks.filter((row) => row.status === "present" || row.status === "late").length;
    const grades = homework.map((item) => item.grade).filter((grade): grade is number => grade !== null);
    children.push({
      id: child.id,
      name: child.name,
      classes: classes.map((item) => item.name),
      average: grades.length ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null,
      attendancePercent: marks.length ? Math.round((attended / marks.length) * 100) : null,
      absences: marks.filter((row) => row.status === "absent").slice(0, 5).map((row) => row.date),
      homework,
    });
  }
  res.json({ children });
});

/* -------------------------------------------------------------------------- */
/* Director dashboard                                                          */
/* -------------------------------------------------------------------------- */

router.get("/schools/:schoolId/dashboard", requireAuthenticatedRole("school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) {
    res.status(400).json({ error: "Invalid school identifier." });
    return;
  }
  const viewer = user(res);
  const [membership] = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable).where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, viewer.id))).limit(1);
  if (!isGlobalAdminRole(viewer.role) && membership?.role !== "school_director" && membership?.role !== "school_admin") {
    res.status(403).json({ error: "You cannot view this school." });
    return;
  }
  const classes = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(eq(classesTable.schoolId, schoolId)).orderBy(asc(classesTable.name));
  const classIds = classes.map((item) => item.id);
  const members = await db.select({ role: schoolMembersTable.role }).from(schoolMembersTable).where(eq(schoolMembersTable.schoolId, schoolId));
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const marks = classIds.length
    ? await db.select({ classId: attendanceTable.classId, status: attendanceTable.status, date: attendanceTable.attendanceDate }).from(attendanceTable).where(inArray(attendanceTable.classId, classIds))
    : [];
  const recent = marks.filter((row) => row.date >= since);
  const assignments = classIds.length
    ? await db.select({ id: assignmentsTable.id, classId: assignmentsTable.classId }).from(assignmentsTable).where(inArray(assignmentsTable.classId, classIds))
    : [];
  const submissions = assignments.length
    ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, score: assignmentSubmissionsTable.score }).from(assignmentSubmissionsTable).where(inArray(assignmentSubmissionsTable.assignmentId, assignments.map((item) => item.id)))
    : [];
  const lessons = await db.select({ id: lessonRoomsTable.id, classId: lessonRoomsTable.classId, createdAt: lessonRoomsTable.createdAt }).from(lessonRoomsTable).where(eq(lessonRoomsTable.schoolId, schoolId));
  const percent = (rows: typeof marks) => rows.length ? Math.round((rows.filter((row) => row.status === "present" || row.status === "late").length / rows.length) * 100) : null;
  const gradeOf = (score: number) => Math.max(2, Math.min(5, Math.round(score / 20)));
  const graded = submissions.filter((row) => row.score !== null).map((row) => gradeOf(row.score!));
  const perClass = classes.map((item) => {
    const classAssignments = assignments.filter((row) => row.classId === item.id).map((row) => row.id);
    const classGrades = submissions.filter((row) => row.score !== null && classAssignments.includes(row.assignmentId)).map((row) => gradeOf(row.score!));
    return {
      id: item.id,
      name: item.name,
      attendancePercent: percent(recent.filter((row) => row.classId === item.id)),
      assignments: classAssignments.length,
      average: classGrades.length ? Math.round((classGrades.reduce((a, b) => a + b, 0) / classGrades.length) * 10) / 10 : null,
      lessons: lessons.filter((row) => row.classId === item.id).length,
    };
  });
  res.json({
    students: members.filter((row) => row.role === "student").length,
    teachers: members.filter((row) => row.role === "teacher").length,
    parents: members.filter((row) => row.role === "parent").length,
    classes: classes.length,
    attendancePercent: percent(recent),
    absentToday: marks.filter((row) => row.date === new Date().toISOString().slice(0, 10) && row.status === "absent").length,
    assignments: assignments.length,
    toReview: submissions.filter((row) => row.score === null).length,
    average: graded.length ? Math.round((graded.reduce((a, b) => a + b, 0) / graded.length) * 10) / 10 : null,
    lessons30d: lessons.filter((row) => row.createdAt.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000).length,
    perClass,
  });
});

export default router;
