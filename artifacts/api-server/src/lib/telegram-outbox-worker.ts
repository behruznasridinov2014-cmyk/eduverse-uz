import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, lt, or, sql } from "drizzle-orm";
import { db, telegramOutboxTable } from "@workspace/db";
import { logger } from "./logger";
import { sendTelegramMessage } from "./telegram";
import {
  telegramChatDelayMs,
  telegramRetryDelaySeconds,
} from "./telegram-outbox-policy";
import { decryptSecret } from "./two-factor";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1_000;
const LOCK_TIMEOUT_MS = 90_000;
const MIN_SEND_INTERVAL_MS = 40;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
let nextCleanupAt = 0;

async function claimBatch(now: Date) {
  return db.transaction(async (tx) => {
    const staleLock = new Date(now.getTime() - LOCK_TIMEOUT_MS);
    const rows = await tx
      .select()
      .from(telegramOutboxTable)
      .where(
        or(
          and(
            eq(telegramOutboxTable.status, "pending"),
            lte(telegramOutboxTable.availableAt, now),
          ),
          and(
            eq(telegramOutboxTable.status, "processing"),
            or(
              isNull(telegramOutboxTable.lockedAt),
              lt(telegramOutboxTable.lockedAt, staleLock),
            ),
          ),
        ),
      )
      .orderBy(asc(telegramOutboxTable.availableAt))
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    await tx
      .update(telegramOutboxTable)
      .set({
        status: "processing",
        lockedAt: now,
        attempts: sql`${telegramOutboxTable.attempts} + 1`,
      })
      .where(inArray(telegramOutboxTable.id, ids));
    return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
  });
}

async function deliver(row: Awaited<ReturnType<typeof claimBatch>>[number]): Promise<void> {
  let now = new Date();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await db
      .update(telegramOutboxTable)
      .set({ status: "failed", lockedAt: null, lastErrorCode: "message_expired" })
      .where(eq(telegramOutboxTable.id, row.id));
    return;
  }

  const [lastSent] = await db
    .select({ sentAt: telegramOutboxTable.sentAt })
    .from(telegramOutboxTable)
    .where(
      and(
        eq(telegramOutboxTable.chatId, row.chatId),
        eq(telegramOutboxTable.status, "sent"),
        isNotNull(telegramOutboxTable.sentAt),
      ),
    )
    .orderBy(desc(telegramOutboxTable.sentAt))
    .limit(1);
  const chatDelayMs = telegramChatDelayMs(lastSent?.sentAt ?? null, now.getTime());
  if (chatDelayMs > 0) {
    await sleep(chatDelayMs);
    now = new Date();
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      await db
        .update(telegramOutboxTable)
        .set({ status: "failed", lockedAt: null, lastErrorCode: "message_expired" })
        .where(eq(telegramOutboxTable.id, row.id));
      return;
    }
  }

  let text: string;
  try {
    text = decryptSecret(row.encryptedText);
  } catch {
    await db
      .update(telegramOutboxTable)
      .set({ status: "failed", lockedAt: null, lastErrorCode: "message_decryption_failed" })
      .where(eq(telegramOutboxTable.id, row.id));
    logger.error({ outboxId: row.id }, "Telegram outbox message could not be decrypted");
    return;
  }

  const result = await sendTelegramMessage(row.chatId, text);
  if (result.ok) {
    await db
      .update(telegramOutboxTable)
      .set({
        status: "sent",
        lockedAt: null,
        sentAt: new Date(),
        lastErrorCode: null,
      })
      .where(eq(telegramOutboxTable.id, row.id));
    return;
  }

  const canRetry = result.retryable && row.attempts < MAX_ATTEMPTS;
  await db
    .update(telegramOutboxTable)
    .set({
      status: canRetry ? "pending" : "failed",
      lockedAt: null,
      availableAt: canRetry
        ? new Date(Date.now() + telegramRetryDelaySeconds(row.attempts, result.retryAfterSeconds) * 1_000)
        : row.availableAt,
      lastErrorCode: result.errorCode,
    })
    .where(eq(telegramOutboxTable.id, row.id));

  if (!canRetry) {
    logger.warn(
      { outboxId: row.id, errorCode: result.errorCode, attempts: row.attempts },
      "Telegram outbox delivery failed permanently",
    );
  }
}

export async function runTelegramOutboxOnce(): Promise<number> {
  const now = new Date();
  if (now.getTime() >= nextCleanupAt) {
    await db
      .delete(telegramOutboxTable)
      .where(
        and(
          inArray(telegramOutboxTable.status, ["sent", "failed"]),
          lt(telegramOutboxTable.createdAt, new Date(now.getTime() - RETENTION_MS)),
        ),
      );
    nextCleanupAt = now.getTime() + CLEANUP_INTERVAL_MS;
  }
  const rows = await claimBatch(now);
  for (const row of rows) {
    try {
      await deliver(row);
    } catch (error) {
      logger.error(
        { err: error, outboxId: row.id },
        "Telegram outbox delivery could not be recorded",
      );
      await db
        .update(telegramOutboxTable)
        .set({
          status: row.attempts < MAX_ATTEMPTS ? "pending" : "failed",
          lockedAt: null,
          availableAt: new Date(Date.now() + telegramRetryDelaySeconds(row.attempts) * 1_000),
          lastErrorCode: "delivery_processing_failed",
        })
        .where(eq(telegramOutboxTable.id, row.id));
    }
    await sleep(MIN_SEND_INTERVAL_MS);
  }
  return rows.length;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runTelegramOutboxWorker(signal?: AbortSignal): Promise<void> {
  logger.info("Telegram outbox worker started");
  while (!signal?.aborted) {
    try {
      const processed = await runTelegramOutboxOnce();
      if (processed > 0) continue;
    } catch (error) {
      logger.error({ err: error }, "Telegram outbox poll failed");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  logger.info("Telegram outbox worker stopped");
}
