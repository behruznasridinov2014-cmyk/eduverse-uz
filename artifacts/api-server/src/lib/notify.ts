import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, parentLinksTable, telegramNotifyTable } from "@workspace/db";
import { sendTelegramMessage, telegramBotConfigured } from "./telegram";
import { logger } from "./logger";

/**
 * Telegram notifications for school events (absence, grade, announcement).
 *
 * Messages are sent directly instead of through the outbox: the outbox worker
 * does not run on serverless hosting. Every failure is logged and swallowed —
 * a notification must never break the action that triggered it.
 */
export async function notifyUsers(userIds: string[], text: string): Promise<number> {
  if (!telegramBotConfigured() || userIds.length === 0) return 0;
  try {
    const rows = await db
      .select({ chatId: telegramNotifyTable.chatId })
      .from(telegramNotifyTable)
      .where(and(inArray(telegramNotifyTable.userId, [...new Set(userIds)]), isNotNull(telegramNotifyTable.chatId)));
    let sent = 0;
    await Promise.all(
      rows.map(async (row) => {
        if (!row.chatId) return;
        const result = await sendTelegramMessage(row.chatId, text);
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

/** Notifies every parent of one student (and the student) with the same text. */
export async function notifyFamily(studentId: string, text: string, includeStudent = false): Promise<void> {
  const parents = await parentsOf([studentId]);
  await notifyUsers([...parents.map((row) => row.parentId), ...(includeStudent ? [studentId] : [])], text);
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

void eq;
