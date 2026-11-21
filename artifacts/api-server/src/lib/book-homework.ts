import { and, eq, inArray } from "drizzle-orm";
import { assignmentsTable, classMembersTable, courseProgressTable, db, noticeMarksTable, timetableSlotsTable } from "@workspace/db";
import { lessonReader } from "../routes/timetable";
import { pushNotice, withParents } from "./inbox";
import { escapeHtml, notifyUsers, subjectText, tl } from "./notify";
import BOOKS from "./book-topics.json";
import { logger } from "./logger";

/*
 * Homework from the textbook, given by EDUVERSE itself (the teacher writes nothing):
 * when a lesson with a textbook ends, the class gets the homework of that lesson's topic,
 * and the topic is marked as covered on that day, so the next lesson moves to the next topic.
 * The topic of a lesson is the one the class covered that day, else the next after the last covered.
 */

type BookTopic = { key: string; code: string; title: string; homework: string; tasks: string[] };
type Book = { id: string; subject: string; grade: number; topics: BookTopic[] };
const COURSE = BOOKS as Book[];

const SUBJECT_RU: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };

export function bookFor(subject: string, grade: number): Book | undefined {
  return COURSE.find((book) => book.subject === subject && book.grade === grade) ?? COURSE.find((book) => book.subject === subject);
}

export type EndedLesson = { classId: string; subject: string; grade: number; teacherId: string | null; endsAt: string };

/** "2026-11-21" → the next school day (Sunday skipped) at 20:00 Tashkent. */
function dueAfter(date: string): Date {
  const day = new Date(`${date}T20:00:00+05:00`);
  day.setUTCDate(day.getUTCDate() + 1);
  const local = new Date(day.getTime() + 5 * 3600 * 1000);
  if (local.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

/** Gives the book homework for today's lessons that have ended. Safe to call many times. */
export async function giveBookHomework(date: string, lessons: EndedLesson[], now = Date.now()): Promise<void> {
  const ended = lessons.filter((lesson) => lesson.teacherId && Date.parse(lesson.endsAt) <= now && bookFor(lesson.subject, lesson.grade));
  if (!ended.length) return;
  try {
    const classIds = [...new Set(ended.map((lesson) => lesson.classId))];
    const progress = await db.select({ classId: courseProgressTable.classId, topicKey: courseProgressTable.topicKey, doneOn: courseProgressTable.doneOn })
      .from(courseProgressTable).where(inArray(courseProgressTable.classId, classIds));
    const handled = new Set<string>();
    for (const lesson of ended) {
      const book = bookFor(lesson.subject, lesson.grade)!;
      const key = `${lesson.classId}:${book.id}`;
      if (handled.has(key)) continue;
      handled.add(key);
      const rows = progress.filter((row) => row.classId === lesson.classId);
      const covered = new Set(rows.map((row) => row.topicKey));
      const today = book.topics.find((topic) => rows.some((row) => row.topicKey === topic.key && row.doneOn === date));
      const last = book.topics.reduce((index, topic, i) => (covered.has(topic.key) ? i : index), -1);
      const topic = today ?? book.topics[last + 1];
      if (!topic) continue;
      if (!today) {
        await db.insert(courseProgressTable).values({ classId: lesson.classId, topicKey: topic.key, doneOn: date, markedBy: lesson.teacherId })
          .onConflictDoNothing();
      }
      const autoKey = `book:${lesson.classId}:${topic.key}`;
      const [exists] = await db.select({ id: assignmentsTable.id }).from(assignmentsTable)
        .where(and(eq(assignmentsTable.classId, lesson.classId), eq(assignmentsTable.autoKey, autoKey))).limit(1);
      if (exists) continue;
      const tasks = topic.tasks.slice(0, 3).map((task, index) => `${index + 1}. ${task}`).join("\n");
      const [created] = await db.insert(assignmentsTable).values({
        classId: lesson.classId,
        createdBy: lesson.teacherId!,
        title: `§${topic.code} ${topic.title}`.slice(0, 160),
        subject: SUBJECT_RU[lesson.subject] ?? lesson.subject,
        description: `${topic.homework}${tasks ? `\n\nИз учебника:\n${tasks}` : ""}`,
        topicId: `course:${topic.key}`,
        topicTitle: `§${topic.code} ${topic.title}`,
        autoKey,
        dueAt: dueAfter(date),
        status: "assigned",
      }).onConflictDoNothing().returning({ id: assignmentsTable.id });
      if (created) await bellHomework(lesson.classId, `§${topic.code} ${topic.title}`, topic.homework, SUBJECT_RU[lesson.subject] ?? lesson.subject);
    }
    // Telegram gets ONE message per class a day, after the class's last lesson: all homework of the day.
    for (const classId of classIds) await sendDaySummary(classId, date, now);
  } catch (error) {
    logger.warn({ err: error }, "book homework was not given");
  }
}

async function pupilsAndParents(classId: string): Promise<string[]> {
  const pupils = (await db.select({ id: classMembersTable.userId }).from(classMembersTable)
    .where(and(eq(classMembersTable.classId, classId), eq(classMembersTable.role, "student")))).map((row) => row.id);
  return pupils.length ? withParents(pupils) : [];
}

/** The bell on the site shows each new homework (quiet, no Telegram). */
async function bellHomework(classId: string, title: string, homework: string, subject: string): Promise<void> {
  try {
    const people = await pupilsAndParents(classId);
    if (people.length) await pushNotice(people, "homework", `Домашнее задание: ${subject}`, `${title} — ${homework}`, "/classes");
  } catch (error) {
    logger.warn({ err: error }, "homework notice was not sent");
  }
}

/** One Telegram message per class and day, once the last lesson of the class is over. */
async function sendDaySummary(classId: string, date: string, now: number): Promise<void> {
  try {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    const classLessons = await lessonReader(eq(timetableSlotsTable.classId, classId))(date, weekday);
    if (!classLessons.length || classLessons.some((lesson) => Date.parse(lesson.endsAt) > now)) return;
    const done = await db.select({ topicKey: courseProgressTable.topicKey }).from(courseProgressTable)
      .where(and(eq(courseProgressTable.classId, classId), eq(courseProgressTable.doneOn, date)));
    if (!done.length) return;
    const tasks = await db.select({ title: assignmentsTable.title, subject: assignmentsTable.subject, description: assignmentsTable.description })
      .from(assignmentsTable)
      .where(and(eq(assignmentsTable.classId, classId), inArray(assignmentsTable.autoKey, done.map((row) => `book:${classId}:${row.topicKey}`))));
    if (!tasks.length) return;
    const [mark] = await db.insert(noticeMarksTable).values({ key: `hw-day:${classId}:${date}` }).onConflictDoNothing().returning({ key: noticeMarksTable.key });
    if (!mark) return; // already sent today
    const people = await pupilsAndParents(classId);
    const day = date.split("-").reverse().join(".");
    await notifyUsers(people, (lang) => [
      `📚 <b>${tl(lang, "Bugungi uy vazifasi", "Домашнее задание на завтра", "Today’s homework")}</b> · ${day}`,
      "",
      ...tasks.map((task) => `• <b>${subjectText(lang, task.subject)}</b> — ${escapeHtml(task.title)}\n  ${escapeHtml(task.description.split("\n")[0]!.slice(0, 200))}`),
      "",
      `${tl(lang, "Daftar rasmini saytda yuboring", "Фото тетради — на сайте", "Send notebook photos on the site")}: https://eduverse-uz1.vercel.app/classes`,
    ].join("\n"));
  } catch (error) {
    logger.warn({ err: error }, "homework summary was not sent");
  }
}
