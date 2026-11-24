import { auditLogTable, db } from "@workspace/db";
import { logger } from "./logger";

/** Records who did what. Never throws: the journal must not break the action itself. */
export async function writeAudit(schoolId: string | null, actorId: string | null, action: string, targetUserId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.insert(auditLogTable).values({ schoolId, actorId, action, targetUserId, details });
  } catch (error) {
    logger.error({ err: error, action }, "audit log write failed");
  }
}
