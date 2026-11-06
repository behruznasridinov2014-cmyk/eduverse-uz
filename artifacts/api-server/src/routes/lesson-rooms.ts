import { and, asc, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { randomBytes } from "node:crypto";
import {
  classMembersTable,
  classesTable,
  db,
  lessonRoomParticipantsTable,
  lessonRoomSignalsTable,
  lessonRoomsTable,
  lessonTopicsTable,
  quizAttemptsTable,
  schoolMembersTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";
import {
  canManageClass,
  cleanText,
  isGlobalAdminRole,
  isValidUuid,
} from "../lib/school-access";

const router: IRouter = Router();

type RequestUser = { id: string; role: AccountRole };

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

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i]! % alphabet.length];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/* -------------------------------------------------------------------------- */
/* WebRTC signalling (stored in PostgreSQL)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Signalling messages are persisted in PostgreSQL with a monotonic `seq`
 * cursor so the WebRTC mesh works across serverless invocations (Vercel) as
 * well as long-lived servers. Every message is addressed to a specific
 * participant or the whole room and expires after a few minutes.
 */
type SignalMessage = {
  seq: number;
  from: string;
  to: string | "all";
  kind: "offer" | "answer" | "ice" | "chat" | "control";
  payload: unknown;
  at: number;
};

const SIGNAL_TTL_MS = 5 * 60 * 1000;

async function appendSignal(
  roomId: string,
  message: Omit<SignalMessage, "seq" | "at">,
): Promise<void> {
  try {
    await db.insert(lessonRoomSignalsTable).values({
      roomId,
      fromId: message.from,
      to: message.to,
      kind: message.kind,
      payload:
        message.payload === undefined || message.payload === null
          ? {}
          : (message.payload as Record<string, unknown>),
    });
    if (Math.random() < 0.15) {
      const cutoff = new Date(Date.now() - SIGNAL_TTL_MS);
      await db
        .delete(lessonRoomSignalsTable)
        .where(lt(lessonRoomSignalsTable.createdAt, cutoff));
    }
  } catch {
    // signalling is best-effort; clients keep polling
  }
}

async function readSignals(
  roomId: string,
  since: number,
  viewerId: string,
): Promise<SignalMessage[]> {
  const rows = await db
    .select({
      seq: lessonRoomSignalsTable.seq,
      fromId: lessonRoomSignalsTable.fromId,
      to: lessonRoomSignalsTable.to,
      kind: lessonRoomSignalsTable.kind,
      payload: lessonRoomSignalsTable.payload,
      at: lessonRoomSignalsTable.createdAt,
    })
    .from(lessonRoomSignalsTable)
    .where(
      and(
        eq(lessonRoomSignalsTable.roomId, roomId),
        gt(lessonRoomSignalsTable.seq, since),
        ne(lessonRoomSignalsTable.fromId, viewerId),
        or(eq(lessonRoomSignalsTable.to, "all"), eq(lessonRoomSignalsTable.to, viewerId)),
      ),
    )
    .orderBy(asc(lessonRoomSignalsTable.seq))
    .limit(200);
  return rows.map((row) => ({
    seq: row.seq,
    from: row.fromId,
    to: row.to,
    kind: row.kind as SignalMessage["kind"],
    payload: row.payload,
    at: new Date(row.at).getTime(),
  }));
}

async function dropSignals(roomId: string): Promise<void> {
  try {
    await db.delete(lessonRoomSignalsTable).where(eq(lessonRoomSignalsTable.roomId, roomId));
  } catch {
    /* best effort */
  }
}

/* -------------------------------------------------------------------------- */
/* Authorization helpers                                                       */
/* -------------------------------------------------------------------------- */

async function schoolRole(userId: string, schoolId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId)))
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

async function canManage(userId: string, role: AccountRole, classId: string | null): Promise<boolean> {
  if (isGlobalAdminRole(role)) return true;
  if (!classId) return role === "teacher" || role === "school_director" || role === "school_admin";
  const [ctx] = await db
    .select({ schoolId: classesTable.schoolId })
    .from(classesTable)
    .where(eq(classesTable.id, classId))
    .limit(1);
  if (!ctx) return false;
  const [sRole, cRole] = await Promise.all([
    schoolRole(userId, ctx.schoolId),
    classRole(userId, classId),
  ]);
  return canManageClass(role, sRole, cRole);
}

async function roomById(roomId: string) {
  if (!isValidUuid(roomId)) return null;
  const [row] = await db
    .select()
    .from(lessonRoomsTable)
    .where(eq(lessonRoomsTable.id, roomId))
    .limit(1);
  return row ?? null;
}

async function participants(roomId: string) {
  return db
    .select({
      userId: lessonRoomParticipantsTable.userId,
      role: lessonRoomParticipantsTable.role,
      username: usersTable.username,
      cameraOn: lessonRoomParticipantsTable.cameraOn,
      micOn: lessonRoomParticipantsTable.micOn,
      sharingScreen: lessonRoomParticipantsTable.sharingScreen,
      testPrompt: lessonRoomParticipantsTable.testPrompt,
      testChoices: lessonRoomParticipantsTable.testChoices,
      testCorrect: lessonRoomParticipantsTable.testCorrect,
      testExplanation: lessonRoomParticipantsTable.testExplanation,
      testAnswer: lessonRoomParticipantsTable.testAnswer,
      testScore: lessonRoomParticipantsTable.testScore,
      joinedAt: lessonRoomParticipantsTable.joinedAt,
      leftAt: lessonRoomParticipantsTable.leftAt,
    })
    .from(lessonRoomParticipantsTable)
    .innerJoin(usersTable, eq(lessonRoomParticipantsTable.userId, usersTable.id))
    .where(and(eq(lessonRoomParticipantsTable.roomId, roomId), isNull(lessonRoomParticipantsTable.leftAt)))
    .orderBy(asc(lessonRoomParticipantsTable.joinedAt));
}

/* -------------------------------------------------------------------------- */
/* Rooms                                                                       */
/* -------------------------------------------------------------------------- */

router.get(
  "/rooms",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const viewer = user(res);
    const rows =
      viewer.role === "student"
        ? await db
            .select()
            .from(lessonRoomsTable)
            .where(eq(lessonRoomsTable.status, "open"))
            .orderBy(desc(lessonRoomsTable.createdAt))
            .limit(40)
        : await db
            .select()
            .from(lessonRoomsTable)
            .orderBy(desc(lessonRoomsTable.createdAt))
            .limit(40);
    res.json({ rooms: rows });
  },
);

router.post(
  "/rooms",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const host = user(res);
    const topicId = readString(req.body, "topicId", 64);
    const classId = readString(req.body, "classId", 64);
    if (topicId && !isValidUuid(topicId)) {
      res.status(400).json({ error: "Invalid topic identifier." });
      return;
    }
    if (classId && !isValidUuid(classId)) {
      res.status(400).json({ error: "Invalid class identifier." });
      return;
    }
    if (!(await canManage(host.id, host.role, classId ?? null))) {
      res.status(403).json({ error: "You cannot open a lesson for this class." });
      return;
    }

    let subject = readString(req.body, "subject", 60) ?? "";
    let title = readString(req.body, "title", 180) ?? "";
    let schoolId: string | null = null;
    if (topicId) {
      const [topic] = await db
        .select()
        .from(lessonTopicsTable)
        .where(eq(lessonTopicsTable.id, topicId))
        .limit(1);
      if (topic) {
        subject = topic.subject;
        title = topic.title;
        schoolId = topic.schoolId;
      }
    }
    if (classId && !schoolId) {
      const [ctx] = await db
        .select({ schoolId: classesTable.schoolId })
        .from(classesTable)
        .where(eq(classesTable.id, classId))
        .limit(1);
      schoolId = ctx?.schoolId ?? null;
    }

    const [room] = await db
      .insert(lessonRoomsTable)
      .values({
        code: roomCode(),
        topicId: topicId ?? null,
        classId: classId ?? null,
        schoolId,
        hostId: host.id,
        subject,
        title: title || "Живой урок",
        status: "open",
      })
      .returning();
    res.status(201).json({ room });
  },
);

router.get(
  "/rooms/:roomId",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    res.json({
      room,
      participants: await participants(room.id),
      serverTime: new Date().toISOString(),
    });
  },
);

router.get(
  "/rooms/by-code/:code",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const code = String(req.params.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) {
      res.status(400).json({ error: "Enter a valid join code." });
      return;
    }
    const [room] = await db
      .select()
      .from(lessonRoomsTable)
      .where(eq(lessonRoomsTable.code, code))
      .limit(1);
    if (!room) {
      res.status(404).json({ error: "No lesson matches that code." });
      return;
    }
    if (room.status === "ended") {
      res.status(410).json({ error: "This lesson has ended." });
      return;
    }
    res.json({ room });
  },
);

/**
 * The teacher joins as host. This also flips the room to "live" and seeds the
 * topic if one was attached.
 */
router.post(
  "/rooms/:roomId/join",
  requireAuthenticatedRole(
    "student", "teacher", "school_director", "school_admin",
    "education_admin", "ministry_admin", "platform_superadmin",
  ),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    if (room.status === "ended") {
      res.status(410).json({ error: "This lesson has ended." });
      return;
    }
    const isHost = room.hostId === viewer.id;
    if (!isHost && viewer.role === "student" && !room.classId) {
      // open room with no class: any signed-in student may join by code
    } else if (!isHost && viewer.role === "student" && room.classId) {
      const cRole = await classRole(viewer.id, room.classId);
      if (!cRole) {
        res.status(403).json({ error: "You are not a member of this class." });
        return;
      }
    }

    await db
      .insert(lessonRoomParticipantsTable)
      .values({ roomId: room.id, userId: viewer.id, role: isHost ? "teacher" : viewer.role })
      .onConflictDoUpdate({
        target: [lessonRoomParticipantsTable.roomId, lessonRoomParticipantsTable.userId],
        set: { leftAt: null, joinedAt: new Date() },
      });
    if (isHost && room.status === "open") {
      await db
        .update(lessonRoomsTable)
        .set({ status: "live" })
        .where(eq(lessonRoomsTable.id, room.id));
    }
    void appendSignal(room.id, { from: viewer.id, to: "all", kind: "control", payload: { event: "joined" } });
    res.json({ room, participants: await participants(room.id) });
  },
);

router.post(
  "/rooms/:roomId/leave",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    await db
      .update(lessonRoomParticipantsTable)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(lessonRoomParticipantsTable.roomId, room.id),
          eq(lessonRoomParticipantsTable.userId, viewer.id),
        ),
      );
    void appendSignal(room.id, { from: viewer.id, to: "all", kind: "control", payload: { event: "left" } });
    res.status(204).end();
  },
);

router.post(
  "/rooms/:roomId/end",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    if (room.hostId !== viewer.id && !(await canManage(viewer.id, viewer.role, room.classId))) {
      res.status(403).json({ error: "Only the host can end this lesson." });
      return;
    }
    await db
      .update(lessonRoomsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(lessonRoomsTable.id, room.id));
    void appendSignal(room.id, { from: viewer.id, to: "all", kind: "control", payload: { event: "ended" } });
    void dropSignals(room.id);
    res.json({ ended: true });
  },
);

router.post(
  "/rooms/:roomId/presence",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const patch: Record<string, boolean> = {};
    if (isRecord(req.body) && typeof req.body.cameraOn === "boolean") patch.cameraOn = req.body.cameraOn;
    if (isRecord(req.body) && typeof req.body.micOn === "boolean") patch.micOn = req.body.micOn;
    if (isRecord(req.body) && typeof req.body.sharingScreen === "boolean") patch.sharingScreen = req.body.sharingScreen;
    if (Object.keys(patch).length > 0) {
      await db
        .update(lessonRoomParticipantsTable)
        .set(patch)
        .where(
          and(
            eq(lessonRoomParticipantsTable.roomId, room.id),
            eq(lessonRoomParticipantsTable.userId, viewer.id),
          ),
        );
    }
    res.json({ ok: true });
  },
);

/* -------------------------------------------------------------------------- */
/* Per-student individual tests (AI-generated)                                 */
/* -------------------------------------------------------------------------- */

router.get(
  "/rooms/:roomId/my-test",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const [me] = await db
      .select()
      .from(lessonRoomParticipantsTable)
      .where(
        and(
          eq(lessonRoomParticipantsTable.roomId, room.id),
          eq(lessonRoomParticipantsTable.userId, viewer.id),
        ),
      )
      .limit(1);
    res.json({
      question: me && me.testPrompt
        ? {
            prompt: me.testPrompt,
            choices: me.testChoices,
            correct: me.testCorrect,
            explanation: me.testExplanation,
          }
        : null,
      answer: me?.testAnswer ?? null,
      score: me?.testScore ?? null,
    });
  },
);

router.put(
  "/rooms/:roomId/my-test",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const [me] = await db
      .select()
      .from(lessonRoomParticipantsTable)
      .where(
        and(
          eq(lessonRoomParticipantsTable.roomId, room.id),
          eq(lessonRoomParticipantsTable.userId, viewer.id),
        ),
      )
      .limit(1);
    if (!me) {
      res.status(409).json({ error: "Join the lesson before answering the test." });
      return;
    }
    const answer = readString(req.body, "answer", 300);
    if (!answer) {
      res.status(400).json({ error: "An answer is required." });
      return;
    }
    const correct = me.testCorrect && answer.trim() === me.testCorrect.trim();
    const score = correct ? 100 : 0;
    await db
      .update(lessonRoomParticipantsTable)
      .set({ testAnswer: answer, testScore: score })
      .where(eq(lessonRoomParticipantsTable.id, me.id));
    res.json({ correct, score, explanation: me.testExplanation });
  },
);

router.post(
  "/rooms/:roomId/tests",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    if (room.hostId !== viewer.id && !(await canManage(viewer.id, viewer.role, room.classId))) {
      res.status(403).json({ error: "Only the host can generate class tests." });
      return;
    }
    const question = isRecord(req.body) ? req.body.question : undefined;
    const choices = isRecord(question) && Array.isArray(question.choices)
      ? question.choices.filter((c): c is string => typeof c === "string").slice(0, 4)
      : [];
    const prompt = isRecord(question) ? cleanText(question.prompt, 400) : undefined;
    const correct = isRecord(question) ? cleanText(question.correct, 200) : undefined;
    const explanation = isRecord(question) ? cleanText(question.explanation, 600) ?? "" : "";
    if (!prompt || choices.length !== 4 || !correct || !choices.includes(correct)) {
      res.status(400).json({ error: "A valid question with four choices and one correct answer is required." });
      return;
    }
    await db
      .update(lessonRoomParticipantsTable)
      .set({
        testPrompt: prompt,
        testChoices: choices,
        testCorrect: correct,
        testExplanation: explanation,
        testAnswer: null,
        testScore: null,
      })
      .where(
        and(
          eq(lessonRoomParticipantsTable.roomId, room.id),
          eq(lessonRoomParticipantsTable.role, "student"),
        ),
      );
    void appendSignal(room.id, { from: viewer.id, to: "all", kind: "control", payload: { event: "test-started" } });
    res.json({ assigned: true });
  },
);

/**
 * Teacher assigns a unique, AI-generated question to every joined student. The
 * questions are persisted per participant so each student sees only theirs.
 */
router.post(
  "/rooms/:roomId/tests/individual",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    if (room.hostId !== viewer.id && !(await canManage(viewer.id, viewer.role, room.classId))) {
      res.status(403).json({ error: "Only the host can generate individual tests." });
      return;
    }
    const students = await db
      .select({
        participantId: lessonRoomParticipantsTable.id,
        userId: lessonRoomParticipantsTable.userId,
        username: usersTable.username,
      })
      .from(lessonRoomParticipantsTable)
      .innerJoin(usersTable, eq(lessonRoomParticipantsTable.userId, usersTable.id))
      .where(
        and(
          eq(lessonRoomParticipantsTable.roomId, room.id),
          eq(lessonRoomParticipantsTable.role, "student"),
          isNull(lessonRoomParticipantsTable.leftAt),
        ),
      );
    if (students.length === 0) {
      res.status(409).json({ error: "No students have joined this lesson yet." });
      return;
    }

    const { generateStudentQuestion } = await import("../lib/ai-content");
    let assigned = 0;
    for (const student of students) {
      const question = await generateStudentQuestion(room.subject || "География", room.title, student.username, {
        difficulty: "core",
      });
      await db
        .update(lessonRoomParticipantsTable)
        .set({
          testPrompt: question.prompt,
          testChoices: question.choices,
          testCorrect: question.correct,
          testExplanation: question.explanation,
          testAnswer: null,
          testScore: null,
        })
        .where(eq(lessonRoomParticipantsTable.id, student.participantId));
      assigned += 1;
    }
    void appendSignal(room.id, { from: viewer.id, to: "all", kind: "control", payload: { event: "individual-tests-started" } });
    res.json({ assigned });
  },
);

/* -------------------------------------------------------------------------- */
/* Gamified results + automatic grade                                          */
/* -------------------------------------------------------------------------- */

router.get(
  "/rooms/:roomId/results",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const rows = await db
      .select({
        userId: lessonRoomParticipantsTable.userId,
        username: usersTable.username,
        score: lessonRoomParticipantsTable.testScore,
        answer: lessonRoomParticipantsTable.testAnswer,
        role: lessonRoomParticipantsTable.role,
      })
      .from(lessonRoomParticipantsTable)
      .innerJoin(usersTable, eq(lessonRoomParticipantsTable.userId, usersTable.id))
      .where(eq(lessonRoomParticipantsTable.roomId, room.id));
    const students = rows
      .filter((r) => r.role === "student")
      .map((r) => ({ studentId: r.userId, studentName: r.username, score: r.score ?? 0, answered: r.answer !== null }))
      .sort((a, b) => b.score - a.score);
    const attempts = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.roomId, room.id))
      .orderBy(desc(quizAttemptsTable.score))
      .limit(3);
    res.json({ room, ranking: students, bonusWinners: attempts });
  },
);

router.post(
  "/rooms/:roomId/results",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const score = isRecord(req.body) && Number.isFinite(Number(req.body.score)) ? Number(req.body.score) : 0;
    const total = isRecord(req.body) && Number.isFinite(Number(req.body.total)) ? Number(req.body.total) : 0;
    const answers = isRecord(req.body) && Array.isArray(req.body.answers) ? req.body.answers : [];
    const grade = total > 0 ? Math.max(2, Math.min(5, Math.round((score / total) * 4) + 1)) : null;
    const [attempt] = await db
      .insert(quizAttemptsTable)
      .values({
        roomId: room.id,
        topicId: room.topicId,
        studentId: viewer.id,
        score: Math.max(0, Math.min(total, score)),
        total: Math.max(0, total),
        grade,
        answers,
      })
      .returning();
    res.status(201).json({ attempt });
  },
);

/**
 * Award the top scorer a grade in the linked class assignment (teacher action),
 * mirroring "the teacher takes the winner and gives a good mark".
 */
router.post(
  "/rooms/:roomId/award",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const studentId = readString(req.body, "studentId", 64);
    const assignmentId = readString(req.body, "assignmentId", 64);
    const gradeRaw = isRecord(req.body) ? Number(req.body.grade) : Number.NaN;
    const grade = Number.isInteger(gradeRaw) && gradeRaw >= 2 && gradeRaw <= 5 ? gradeRaw : 5;
    if (!studentId || !isValidUuid(studentId) || !assignmentId || !isValidUuid(assignmentId)) {
      res.status(400).json({ error: "A valid student and assignment are required." });
      return;
    }
    const enabled = process.env.EDUVERSE_ALLOW_AUTO_GRADING !== "0";
    if (!enabled) {
      res.status(403).json({ error: "Automatic grading is disabled on this deployment." });
      return;
    }
    const { assignmentSubmissionsTable } = await import("@workspace/db");
    await db
      .insert(assignmentSubmissionsTable)
      .values({
        assignmentId,
        studentId,
        status: "checked",
        content: `Награда за 1 место в игровом тесте (урок: ${room.title}).`,
        score: grade * 20,
        feedback: "Отличный результат в игровом тесте по теме урока.",
      })
      .onConflictDoUpdate({
        target: [assignmentSubmissionsTable.assignmentId, assignmentSubmissionsTable.studentId],
        set: {
          status: "checked",
          score: grade * 20,
          feedback: "Отличный результат в игровом тесте по теме урока.",
          updatedAt: new Date(),
        },
      });
    res.json({ awarded: true, grade });
  },
);

/* -------------------------------------------------------------------------- */
/* WebRTC signalling long-poll                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  "/rooms/:roomId/signal",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const kind = readString(req.body, "kind", 20);
    const to = readString(req.body, "to", 64) ?? "all";
    if (!kind || !["offer", "answer", "ice", "chat", "control"].includes(kind)) {
      res.status(400).json({ error: "Unsupported signalling message." });
      return;
    }
    void appendSignal(room.id, {
      from: viewer.id,
      to,
      kind: kind as "offer" | "answer" | "ice" | "chat" | "control",
      payload: isRecord(req.body) ? req.body.payload ?? null : null,
    });
    res.json({ ok: true });
  },
);

router.get(
  "/rooms/:roomId/signal",
  requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const viewer = user(res);
    const room = await roomById(String(req.params.roomId));
    if (!room) {
      res.status(404).json({ error: "Lesson room not found." });
      return;
    }
    const since = Number(req.query.since ?? 0);
    const messages = await readSignals(room.id, Number.isFinite(since) ? since : 0, viewer.id);
    const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : Number.isFinite(since) ? since : 0;
    res.json({
      messages,
      lastSeq,
      participants: await participants(room.id),
      roomStatus: room.status,
    });
  },
);

export default router;
