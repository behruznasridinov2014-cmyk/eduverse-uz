import { db, telegramOutboxTable } from "@workspace/db";
import { encryptSecret } from "./two-factor";

export async function enqueueTelegramMessage(input: {
  chatId: string | number;
  text: string;
  deduplicationKey: string;
  expiresAt?: Date;
}): Promise<void> {
  if (!input.deduplicationKey || input.deduplicationKey.length > 200) {
    throw new Error("Telegram outbox deduplication key is invalid.");
  }
  await db
    .insert(telegramOutboxTable)
    .values({
      chatId: String(input.chatId),
      encryptedText: encryptSecret(input.text),
      deduplicationKey: input.deduplicationKey,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    })
    .onConflictDoNothing({
      target: telegramOutboxTable.deduplicationKey,
    });
}
