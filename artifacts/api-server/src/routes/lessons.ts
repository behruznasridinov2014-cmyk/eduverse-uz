import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  classMembersTable,
  classesTable,
  db,
  lessonContentTable,
  lessonLiveAnswersTable,
  lessonLiveTable,
  lessonStageProgressTable,
  schoolMembersTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { canManageClass, isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { lessonHelp, type LessonHelpAction } from "../lib/ai-content";
import BOOKS from "../lib/book-topics.json";

/*
 * The seven-stage lesson of a textbook topic:
 *  - every pupil's result per stage (answers with right / wrong) — the teacher sees the class;
 *  - what the teacher added with the lesson builder (intro, notes, questions, videos, pictures, 3D);
 *  - the class board: the teacher shows a stage or a question, pupils answer from their phones,
 *    the board shows anonymous statistics (short polling, works on every school network);
 *  - the lesson helper (explains, gives examples and practice, never just the answer).
 */
const router: IRouter = Router();
type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const staffRoles = ["teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const perSession = (req: { cookies?: Record<string, unknown>; ip?: string }) => {
  const token = req.cookies?.["eduverse.sid"];
  return typeof token === "string" && token ? `sid:${token.slice(0, 64)}` : `ip:${req.ip ?? "unknown"}`;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const TOPIC_RE = /^[a-z0-9][a-z0-9.\-]{1,39}$/;
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

type Topic = { key: string; code: string; title: string; essence?: string };
type Book = { id: string; subject: string; grade: number; topics: Topic[] };
const COURSE = BOOKS as Book[];
function topicOf(key: string): { book: Book; topic: Topic } | null {
  for (const book of COURSE) {
    const topic = book.topics.find((item) => item.key === key);
    if (topic) return { book, topic };
  }
  return null;
}

const saveLimiter = createRateLimiter(600, 10 * 60 * 1000, "Too many saves. Wait a minute.", "lesson-progress", perSession);
const liveLimiter = createRateLimiter(900, 10 * 60 * 1000, "Too many requests. Wait a minute.", "lesson-live", perSession);
const helpLimiter = createRateLimiter(40, 10 * 60 * 1000, "Too many questions. Wait a few minutes.", "lesson-help", perSession);
const contentLimiter = createRateLimiter(60, 10 * 60 * 1000, "Too many saves. Wait a minute.", "lesson-content", perSession);

/** read: a member of the class; edit: its teacher or the school's managers. */
async function classAccess(viewer: Viewer, classId: string): Promise<{ read: boolean; edit: boolean; student: boolean }> {
  const [klass] = await db.select({ schoolId: classesTable.schoolId }).from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!klass) return { read: false, edit: false, student: false };
  if (isGlobalAdminRole(viewer.role)) return { read: true, edit: true, student: false };
  const [[schoolRow], [classRow]] = await Promise.all([
    db.select({ role: schoolMembersTable.role }).from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.schoolId, klass.schoolId), eq(schoolMembersTable.userId, viewer.id))).limit(1),
    db.select({ role: classMembersTable.role }).from(classMembersTable)
      .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.userId, viewer.id))).limit(1),
  ]);
  const edit = canManageClass(viewer.role, schoolRow?.role ?? null, classRow?.role ?? null);
  return { read: edit || Boolean(classRow), edit, student: classRow?.role === "student" };
}

async function studentClassIds(userId: string): Promise<string[]> {
  return (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
    .where(and(eq(classMembersTable.userId, userId), eq(classMembersTable.role, "student")))).map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* 1. The pupil's own progress through the stages                              */
/* -------------------------------------------------------------------------- */

type Answer = { id: string; ok: boolean; v?: string; q?: string };
function cleanAnswers(value: unknown): Answer[] | null {
  if (!Array.isArray(value) || value.length > 80) return null;
  const out: Answer[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = str(item.id, 60);
    if (!id || typeof item.ok !== "boolean") return null;
    const answer: Answer = { id, ok: item.ok };
    const v = str(item.v, 300);
    const q = str(item.q, 300);
    if (v) answer.v = v;
    if (q) answer.q = q;
    out.push(answer);
  }
  return out;
}

router.get("/me/lesson-progress/:topicKey", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const topicKey = String(req.params.topicKey ?? "");
  if (!TOPIC_RE.test(topicKey)) { res.status(400).json({ error: "Invalid topic." }); return; }
  const rows = await db
    .select({ stage: lessonStageProgressTable.stage, score: lessonStageProgressTable.score, total: lessonStageProgressTable.total, done: lessonStageProgressTable.done, answers: lessonStageProgressTable.answers, attempts: lessonStageProgressTable.attempts, updatedAt: lessonStageProgressTable.updatedAt })
    .from(lessonStageProgressTable)
    .where(and(eq(lessonStageProgressTable.userId, viewerOf(res).id), eq(lessonStageProgressTable.topicKey, topicKey)))
    .orderBy(asc(lessonStageProgressTable.stage));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ stages: rows });
});

router.put("/me/lesson-progress/:topicKey/:stage", requireAuthenticatedRole(...everyRole), saveLimiter, async (req, res) => {
  const topicKey = String(req.params.topicKey ?? "");
  const stage = Number.parseInt(String(req.params.stage ?? ""), 10);
  const body = isRecord(req.body) ? req.body : {};
  const answers = cleanAnswers(body.answers ?? []);
  const score = Number(body.score);
  const total = Number(body.total);
  if (!TOPIC_RE.test(topicKey) || !topicOf(topicKey) || !(stage >= 1 && stage <= 7) || !answers
    || !Number.isInteger(score) || !Number.isInteger(total) || score < 0 || total < 0 || score > total || total > 200) {
    res.status(400).json({ error: "Invalid result." });
    return;
  }
  const viewer = viewerOf(res);
  const done = body.done === true;
  let classId: string | null = null;
  if (viewer.role === "student") {
    const wanted = str(body.classId, 40);
    const own = await studentClassIds(viewer.id);
    classId = own.includes(wanted) ? wanted : own[0] ?? null;
  }
  const [row] = await db
    .insert(lessonStageProgressTable)
    .values({ userId: viewer.id, classId, topicKey, stage, score, total, done, answers })
    .onConflictDoUpdate({
      target: [lessonStageProgressTable.userId, lessonStageProgressTable.topicKey, lessonStageProgressTable.stage],
      set: {
        score, total, answers, classId,
        // once a stage is done it stays done; a retry keeps counting attempts
        done: sql`${lessonStageProgressTable.done} OR ${done}`,
        attempts: sql`${lessonStageProgressTable.attempts} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ stage: lessonStageProgressTable.stage, score: lessonStageProgressTable.score, total: lessonStageProgressTable.total, done: lessonStageProgressTable.done, attempts: lessonStageProgressTable.attempts });
  res.json({ saved: row });
});

/* -------------------------------------------------------------------------- */
/* 2. The class's progress (teacher): who is where, what the class got wrong   */
/* -------------------------------------------------------------------------- */

router.get("/classes/:classId/lesson-progress/:topicKey", requireAuthenticatedRole(...staffRoles), async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const topicKey = String(req.params.topicKey ?? "");
  if (!isValidUuid(classId) || !TOPIC_RE.test(topicKey)) { res.status(400).json({ error: "Invalid class or topic." }); return; }
  const access = await classAccess(viewerOf(res), classId);
  if (!access.edit) { res.status(403).json({ error: "Only the class teacher sees this." }); return; }
  const students = await db
    .select({ id: usersTable.id, name: usersTable.username })
    .from(classMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, classMembersTable.userId))
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))
    .orderBy(asc(usersTable.username));
  const ids = students.map((item) => item.id);
  const rows = ids.length
    ? await db
      .select({ userId: lessonStageProgressTable.userId, stage: lessonStageProgressTable.stage, score: lessonStageProgressTable.score, total: lessonStageProgressTable.total, done: lessonStageProgressTable.done, answers: lessonStageProgressTable.answers, updatedAt: lessonStageProgressTable.updatedAt })
      .from(lessonStageProgressTable)
      .where(and(inArray(lessonStageProgressTable.userId, ids), eq(lessonStageProgressTable.topicKey, topicKey)))
    : [];
  // Every question: how many answered right and wrong (anonymous for the board).
  const questions = new Map<string, { id: string; q: string; right: number; wrong: number }>();
  for (const row of rows) {
    for (const answer of (Array.isArray(row.answers) ? row.answers : []) as Answer[]) {
      const entry = questions.get(answer.id) ?? { id: answer.id, q: answer.q ?? "", right: 0, wrong: 0 };
      if (answer.ok) entry.right += 1; else entry.wrong += 1;
      if (!entry.q && answer.q) entry.q = answer.q;
      questions.set(answer.id, entry);
    }
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    students: students.map((student) => ({
      id: student.id,
      name: student.name,
      stages: rows.filter((row) => row.userId === student.id).map(({ stage, score, total, done, updatedAt }) => ({ stage, score, total, done, updatedAt })),
    })),
    questions: [...questions.values()].sort((a, b) => b.wrong - a.wrong).slice(0, 40),
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Lesson builder: the teacher's own blocks for a topic                     */
/* -------------------------------------------------------------------------- */

type Question = { id: string; prompt: string; choices: string[]; correct: number; explain: string };
type Block =
  | { id: string; kind: "text"; title: string; text: string }
  | { id: string; kind: "video"; title: string; url: string }
  | { id: string; kind: "image"; title: string; url: string }
  | { id: string; kind: "model"; title: string; url: string };
type LessonContent = {
  intro: { title: string; text: string };
  blocks: Block[];
  questions: Question[];
  minutes: number[];
  homework: string;
};

const MAX_IMAGE = 450 * 1024;
const urlOk = (value: string) => /^https:\/\/[^\s"'<>]{4,600}$/.test(value);
const imageOk = (value: string) => urlOk(value) || (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= MAX_IMAGE);

function cleanContent(value: unknown): LessonContent | null {
  if (!isRecord(value)) return null;
  const intro = isRecord(value.intro) ? { title: str(value.intro.title, 140), text: str(value.intro.text, 1500) } : { title: "", text: "" };
  const blocks: Block[] = [];
  if (Array.isArray(value.blocks)) {
    for (const item of value.blocks.slice(0, 20)) {
      if (!isRecord(item)) return null;
      const id = str(item.id, 40) || Math.random().toString(36).slice(2, 10);
      const title = str(item.title, 140);
      if (item.kind === "text") {
        const text = str(item.text, 3000);
        if (text) blocks.push({ id, kind: "text", title, text });
      } else if (item.kind === "video" || item.kind === "model") {
        const url = str(item.url, 600);
        if (!urlOk(url)) return null;
        blocks.push({ id, kind: item.kind, title, url });
      } else if (item.kind === "image") {
        const url = typeof item.url === "string" ? item.url.trim() : "";
        if (!imageOk(url)) return null;
        blocks.push({ id, kind: "image", title, url });
      } else return null;
    }
  }
  const questions: Question[] = [];
  if (Array.isArray(value.questions)) {
    for (const item of value.questions.slice(0, 20)) {
      if (!isRecord(item)) return null;
      const prompt = str(item.prompt, 500);
      const choices = Array.isArray(item.choices) ? item.choices.map((choice) => str(choice, 200)).filter(Boolean).slice(0, 6) : [];
      const correct = Number(item.correct);
      if (!prompt || choices.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= choices.length) return null;
      questions.push({ id: str(item.id, 40) || Math.random().toString(36).slice(2, 10), prompt, choices, correct, explain: str(item.explain, 600) });
    }
  }
  const minutes = Array.isArray(value.minutes)
    ? value.minutes.slice(0, 7).map((item) => Math.max(0, Math.min(45, Math.round(Number(item) || 0))))
    : [];
  const content = { intro, blocks, questions, minutes, homework: str(value.homework, 1500) };
  return JSON.stringify(content).length <= 2_000_000 ? content : null;
}

router.get("/lesson-content/:topicKey", requireAuthenticatedRole(...everyRole), async (req, res) => {
  const topicKey = String(req.params.topicKey ?? "");
  if (!TOPIC_RE.test(topicKey)) { res.status(400).json({ error: "Invalid topic." }); return; }
  const viewer = viewerOf(res);
  res.setHeader("Cache-Control", "private, no-store");
  let teacherIds: string[] = [viewer.id];
  if (viewer.role === "student") {
    const classIds = await studentClassIds(viewer.id);
    const wanted = str(req.query.classId, 40);
    const scope = classIds.includes(wanted) ? [wanted] : classIds;
    teacherIds = scope.length
      ? (await db.select({ id: classMembersTable.userId }).from(classMembersTable)
        .where(and(inArray(classMembersTable.classId, scope), eq(classMembersTable.role, "teacher")))).map((row) => row.id)
      : [];
  }
  if (!teacherIds.length) { res.json({ content: null }); return; }
  const [row] = await db
    .select({ content: lessonContentTable.content, teacherId: lessonContentTable.teacherId, updatedAt: lessonContentTable.updatedAt, name: usersTable.username })
    .from(lessonContentTable)
    .innerJoin(usersTable, eq(usersTable.id, lessonContentTable.teacherId))
    .where(and(inArray(lessonContentTable.teacherId, teacherIds), eq(lessonContentTable.topicKey, topicKey)))
    .orderBy(desc(lessonContentTable.updatedAt))
    .limit(1);
  res.json({ content: row ? row.content : null, author: row ? row.name : null, updatedAt: row?.updatedAt ?? null, own: row?.teacherId === viewer.id });
});

router.put("/me/lesson-content/:topicKey", requireAuthenticatedRole("teacher", "school_director", "school_admin"), contentLimiter, async (req, res) => {
  const topicKey = String(req.params.topicKey ?? "");
  if (!TOPIC_RE.test(topicKey) || !topicOf(topicKey)) { res.status(400).json({ error: "Invalid topic." }); return; }
  const content = cleanContent(isRecord(req.body) ? req.body.content : null);
  if (!content) { res.status(400).json({ error: "Check the blocks: links must start with https://, pictures up to 450 KB, a question needs 2 answers." }); return; }
  const viewer = viewerOf(res);
  await db.insert(lessonContentTable).values({ teacherId: viewer.id, topicKey, content })
    .onConflictDoUpdate({ target: [lessonContentTable.teacherId, lessonContentTable.topicKey], set: { content, updatedAt: new Date() } });
  res.json({ content });
});

/* -------------------------------------------------------------------------- */
/* 4. The class board (teacher shows, pupils answer from their devices)        */
/* -------------------------------------------------------------------------- */

type LiveQuestion = { id: string; prompt: string; choices: string[]; correct: number };
function cleanLiveQuestion(value: unknown): LiveQuestion | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const id = str(value.id, 60);
  const prompt = str(value.prompt, 500);
  const choices = Array.isArray(value.choices) ? value.choices.map((item) => str(item, 200)).filter(Boolean).slice(0, 6) : [];
  const correct = Number(value.correct);
  if (!id || !prompt || choices.length < 2 || !Number.isInteger(correct) || correct < -1 || correct >= choices.length) return undefined;
  return { id, prompt, choices, correct };
}
const LIVE_FRESH_MS = 3 * 3600 * 1000;

async function liveView(classId: string, canSeeAll: boolean, viewerId: string) {
  const [live] = await db.select().from(lessonLiveTable).where(eq(lessonLiveTable.classId, classId)).limit(1);
  if (!live || !live.active || Date.now() - live.updatedAt.getTime() > LIVE_FRESH_MS) return { live: null };
  const question = live.question as LiveQuestion | null;
  const [students] = await db.select({ count: sql<number>`count(*)::int` }).from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")));
  let stats: { counts: number[]; answered: number; right: number } | null = null;
  let mine: number | null = null;
  if (question) {
    const answers = await db.select({ userId: lessonLiveAnswersTable.userId, choice: lessonLiveAnswersTable.choice, correct: lessonLiveAnswersTable.correct })
      .from(lessonLiveAnswersTable)
      .where(and(eq(lessonLiveAnswersTable.classId, classId), eq(lessonLiveAnswersTable.questionId, question.id)));
    mine = answers.find((item) => item.userId === viewerId)?.choice ?? null;
    if (canSeeAll || live.reveal) {
      const counts = question.choices.map((_, index) => answers.filter((item) => item.choice === index).length);
      stats = { counts, answered: answers.length, right: answers.filter((item) => item.correct).length };
    } else {
      stats = { counts: [], answered: answers.length, right: 0 };
    }
  }
  return {
    live: {
      topicKey: live.topicKey,
      stage: live.stage,
      reveal: live.reveal,
      updatedAt: live.updatedAt,
      students: students?.count ?? 0,
      // pupils never get the right answer before the teacher shows it
      question: question ? { id: question.id, prompt: question.prompt, choices: question.choices, correct: canSeeAll || live.reveal ? question.correct : -1 } : null,
      stats,
      mine,
    },
  };
}

router.get("/classes/:classId/live", requireAuthenticatedRole(...everyRole), liveLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  if (!isValidUuid(classId)) { res.status(400).json({ error: "Invalid class." }); return; }
  const viewer = viewerOf(res);
  const access = await classAccess(viewer, classId);
  if (!access.read) { res.status(403).json({ error: "You are not in this class." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await liveView(classId, access.edit, viewer.id));
});

router.put("/classes/:classId/live", requireAuthenticatedRole(...staffRoles), liveLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const body = isRecord(req.body) ? req.body : {};
  const topicKey = str(body.topicKey, 40);
  const stage = Number(body.stage);
  const question = cleanLiveQuestion(body.question ?? null);
  if (!isValidUuid(classId) || !TOPIC_RE.test(topicKey) || !(Number.isInteger(stage) && stage >= 1 && stage <= 7) || question === undefined) {
    res.status(400).json({ error: "Invalid board state." });
    return;
  }
  const viewer = viewerOf(res);
  const access = await classAccess(viewer, classId);
  if (!access.edit) { res.status(403).json({ error: "Only the class teacher controls the board." }); return; }
  const values = { teacherId: viewer.id, topicKey, stage, question, reveal: body.reveal === true, active: body.active !== false, updatedAt: new Date() };
  await db.insert(lessonLiveTable).values({ classId, ...values })
    .onConflictDoUpdate({ target: lessonLiveTable.classId, set: values });
  res.json(await liveView(classId, true, viewer.id));
});

router.post("/classes/:classId/live/answer", requireAuthenticatedRole("student"), liveLimiter, async (req, res) => {
  const classId = String(req.params.classId ?? "");
  const body = isRecord(req.body) ? req.body : {};
  const choice = Number(body.choice);
  const questionId = str(body.questionId, 60);
  if (!isValidUuid(classId) || !questionId || !Number.isInteger(choice) || choice < 0 || choice > 5) { res.status(400).json({ error: "Invalid answer." }); return; }
  const viewer = viewerOf(res);
  const access = await classAccess(viewer, classId);
  if (!access.student) { res.status(403).json({ error: "You are not in this class." }); return; }
  const [live] = await db.select().from(lessonLiveTable).where(eq(lessonLiveTable.classId, classId)).limit(1);
  const question = live?.question as LiveQuestion | null | undefined;
  if (!live || !live.active || !question || question.id !== questionId || choice >= question.choices.length) {
    res.status(409).json({ error: "This question is closed." });
    return;
  }
  if (live.reveal) { res.status(409).json({ error: "The answer is already shown." }); return; }
  await db.insert(lessonLiveAnswersTable).values({ classId, questionId, userId: viewer.id, choice, correct: choice === question.correct })
    .onConflictDoUpdate({ target: [lessonLiveAnswersTable.classId, lessonLiveAnswersTable.questionId, lessonLiveAnswersTable.userId], set: { choice, correct: choice === question.correct, createdAt: new Date() } });
  res.json(await liveView(classId, false, viewer.id));
});

/* -------------------------------------------------------------------------- */
/* 5. The lesson helper                                                        */
/* -------------------------------------------------------------------------- */

const ACTIONS: LessonHelpAction[] = ["simple", "detail", "example", "word", "practice", "mistake", "review", "ask"];
const SUBJECT_NAME: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };

router.post("/ai/lesson-help", requireAuthenticatedRole(...everyRole), helpLimiter, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const action = ACTIONS.find((item) => item === body.action);
  const found = topicOf(str(body.topicKey, 40));
  if (!action || !found) { res.status(400).json({ error: "Choose a topic and an action." }); return; }
  const question = str(body.question, 400);
  if ((action === "word" || action === "ask") && question.length < 2) { res.status(400).json({ error: "Write a word or a question." }); return; }
  const mistakes = Array.isArray(body.mistakes) ? body.mistakes.map((item) => str(item, 200)).filter(Boolean).slice(0, 6) : [];
  const lang = body.lang === "uz" || body.lang === "en" ? body.lang : "ru";
  const answer = await lessonHelp({
    action,
    subject: SUBJECT_NAME[found.book.subject] ?? found.book.subject,
    grade: found.book.grade,
    topic: `§${found.topic.code} ${found.topic.title}`,
    essence: found.topic.essence ?? "",
    stage: str(body.stage, 60),
    question,
    mistakes,
    language: lang,
  });
  // No helper connected (or busy): the page answers from the topic itself.
  res.json({ answer, source: answer ? "ai" : "local" });
});

export default router;
