import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, parentLinksTable, telegramNotifyTable, usersTable } from "@workspace/db";
import { sendTelegramMessage, telegramBotConfigured } from "./telegram";
import { logger } from "./logger";
import { usersWanting } from "./inbox";

/**
 * Telegram notifications for school events (absence, grade, announcement).
 *
 * Messages are sent directly instead of through the outbox: the outbox worker
 * does not run on serverless hosting. Every failure is logged and swallowed —
 * a notification must never break the action that triggered it.
 */
export type NoticeLang = "uz" | "ru" | "en";
/** A message: one text, or a text built for each language (the person picks it with /lang in the bot). */
export type Notice = string | ((lang: NoticeLang) => string);
export const tl = (lang: NoticeLang, uz: string, ru: string, en: string) => (lang === "ru" ? ru : lang === "en" ? en : uz);

const SUBJECTS: Array<[string[], [string, string, string]]> = [
  [["physics", "физика", "fizika"], ["Fizika", "Физика", "Physics"]],
  [["chemistry", "химия", "kimyo"], ["Kimyo", "Химия", "Chemistry"]],
  [["biology", "биология", "biologiya"], ["Biologiya", "Биология", "Biology"]],
  [["math", "mathematics", "математика", "matematika"], ["Matematika", "Математика", "Maths"]],
];
/** A subject name (key or Russian name) in the reader's language. */
export function subjectText(lang: NoticeLang, value: string): string {
  const found = SUBJECTS.find(([names]) => names.includes(value.trim().toLowerCase()));
  return found ? tl(lang, ...found[1]) : value;
}
export const dateText = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

export async function notifyUsers(userIds: string[], notice: Notice): Promise<number> {
  if (!telegramBotConfigured() || userIds.length === 0) return 0;
  try {
    const wanted = await usersWanting(userIds, "telegram");
    if (wanted.length === 0) return 0;
    const rows = await db
      .select({ chatId: telegramNotifyTable.chatId, lang: telegramNotifyTable.lang })
      .from(telegramNotifyTable)
      .where(and(inArray(telegramNotifyTable.userId, wanted), isNotNull(telegramNotifyTable.chatId)));
    let sent = 0;
    await Promise.all(
      rows.map(async (row) => {
        if (!row.chatId) return;
        const lang: NoticeLang = row.lang === "uz" || row.lang === "en" ? row.lang : "ru";
        const result = await sendTelegramMessage(row.chatId, typeof notice === "function" ? notice(lang) : notice);
        if (result.ok) sent += 1;
        else logger.warn({ errorCode: result.errorCode }, "telegram notification not delivered");
      }),
    );
    return sent;
  } catch (error) {
    logger.error({ err: error }, "telegram notification failed");
    return 0;
  }
}

/** Parents linked to the given students. */
export async function parentsOf(studentIds: string[]): Promise<Array<{ parentId: string; studentId: string }>> {
  if (studentIds.length === 0) return [];
  return db
    .select({ parentId: parentLinksTable.parentId, studentId: parentLinksTable.studentId })
    .from(parentLinksTable)
    .where(inArray(parentLinksTable.studentId, studentIds));
}

/**
 * Notifies every parent of one student (and the student). The builder gets the pupil's name,
 * so a parent with two children knows who the message is about.
 */
export async function notifyFamily(studentId: string, notice: string | ((lang: NoticeLang, pupil: string) => string), includeStudent = false): Promise<void> {
  const parents = await parentsOf([studentId]);
  const [pupil] = await db.select({ name: usersTable.username }).from(usersTable).where(eq(usersTable.id, studentId)).limit(1);
  const name = escapeHtml(pupil?.name ?? "");
  await notifyUsers([...parents.map((row) => row.parentId), ...(includeStudent ? [studentId] : [])], typeof notice === "function" ? (lang) => notice(lang, name) : notice);
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

void eq;
