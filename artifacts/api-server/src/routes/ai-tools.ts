import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  classMembersTable,
  courseProgressTable,
  db,
  journalMarksTable,
  trainerTestsTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, requireAuthenticatedRole } from "./auth";
import { explainWord, generatePracticeTest } from "../lib/ai-content";
import BOOKS from "../lib/book-topics.json";

/*
 * AI help for pupils (Google Gemini):
 *  - POST /ai/explain        — "I did not understand this word": a very simple explanation.
 *  - POST /me/practice-test  — a personal 5-question test on the topics the pupil finds hard
 *                              (low journal marks, weak trainer results).
 */
const router: IRouter = Router();
type Viewer = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as Viewer;
const perSession = (req: { cookies?: Record<string, unknown>; ip?: string }) => {
  const token = req.cookies?.["eduverse.sid"];
  return typeof token === "string" && token ? `sid:${token.slice(0, 64)}` : `ip:${req.ip ?? "unknown"}`;
};
const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;
const explainLimiter = createRateLimiter(40, 10 * 60 * 1000, "Too many questions. Wait a few minutes.", "ai-explain", perSession);
const testLimiter = createRateLimiter(12, 60 * 60 * 1000, "Too many tests. Try again later.", "ai-practice", perSession);

type Topic = { key: string; code: string; title: string; essence?: string };
type Book = { id: string; subject: string; grade: number; topics: Topic[] };
const COURSE = BOOKS as Book[];
const langOf = (value: unknown) => (value === "uz" || value === "en" ? value : "ru");

router.post("/ai/explain", requireAuthenticatedRole(...everyRole), explainLimiter, async (req, res) => {
  const body = typeof req.body === "object" && req.body ? req.body as Record<string, unknown> : {};
  const word = typeof body.word === "string" ? body.word.trim().slice(0, 60) : "";
  if (word.length < 2) { res.status(400).json({ error: "Write a word." }); return; }
  const topicKey = typeof body.topicKey === "string" ? body.topicKey : "";
  let topic = "";
  let subject = "";
  for (const book of COURSE) {
    const found = book.topics.find((item) => item.key === topicKey);
    if (found) { topic = `§${found.code} ${found.title}`; subject = book.subject; break; }
  }
  const answer = await explainWord(word, topic, subject, langOf(body.lang));
  if (!answer) { res.status(503).json({ error: "The helper is busy. Try again in a minute." }); return; }
  res.json(answer);
});

router.post("/me/practice-test", requireAuthenticatedRole("student"), testLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const body = typeof req.body === "object" && req.body ? req.body as Record<string, unknown> : {};
  const classIds = (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
    .where(and(eq(classMembersTable.userId, viewer.id), eq(classMembersTable.role, "student")))).map((row) => row.id);
  if (!classIds.length) { res.status(404).json({ error: "You are not in a class yet." }); return; }
  // Weak subjects: a journal average below 4, or trainer tests under 75 %.
  const [marks, tests, progress] = await Promise.all([
    db.select({ subject: journalMarksTable.subject, mark: journalMarksTable.mark }).from(journalMarksTable).where(eq(journalMarksTable.studentId, viewer.id)),
    db.select({ subject: trainerTestsTable.subject, score: trainerTestsTable.score, total: trainerTestsTable.total }).from(trainerTestsTable).where(eq(trainerTestsTable.userId, viewer.id)).orderBy(desc(trainerTestsTable.day)).limit(30),
    db.select({ topicKey: courseProgressTable.topicKey, doneOn: courseProgressTable.doneOn }).from(courseProgressTable).where(inArray(courseProgressTable.classId, classIds)).orderBy(desc(courseProgressTable.doneOn)),
  ]);
  const weakness = new Map<string, number>();
  for (const subject of ["math", "physics", "chemistry", "biology"]) {
    const own = marks.filter((row) => row.subject === subject && typeof row.mark === "number").map((row) => row.mark as number);
    const tried = tests.filter((row) => row.subject === subject);
    const average = own.length ? own.reduce((sum, mark) => sum + mark, 0) / own.length / 2 : 4.5;
    const share = tried.length ? tried.reduce((sum, row) => sum + row.score / Math.max(1, row.total), 0) / tried.length : 0.8;
    weakness.set(subject, (5 - average) + (1 - share) * 3);
  }
  // The pupil may pick one subject before the test starts; otherwise the weakest subjects come first.
  const only = typeof body.subject === "string" && weakness.has(body.subject) ? body.subject : null;
  const subjects = only ? [only] : [...weakness.entries()].sort((a, b) => b[1] - a[1]).map(([subject]) => subject);
  // The latest covered topics of the weakest subjects (or of any subject when everything is fine).
  const picked: Array<{ subject: string; title: string; essence: string; key: string }> = [];
  for (const subject of subjects) {
    const book = COURSE.find((item) => item.subject === subject);
    if (!book) continue;
    for (const row of progress) {
      const topic = book.topics.find((item) => item.key === row.topicKey);
      if (topic && !picked.some((item) => item.key === topic.key)) {
        picked.push({ subject, title: `§${topic.code} ${topic.title}`, essence: topic.essence ?? "", key: topic.key });
        if (picked.filter((item) => item.subject === subject).length >= (only ? 3 : 2)) break;
      }
    }
    if (picked.length >= 3) break;
  }
  if (!picked.length) { res.status(404).json({ error: "No covered topics yet." }); return; }
  const questions = await generatePracticeTest(picked, langOf(body.lang));
  if (!questions) { res.status(503).json({ error: "The helper is busy. Try again in a minute." }); return; }
  res.json({ topics: picked.map(({ subject, title, key }) => ({ subject, title, key })), questions });
});

export default router;
