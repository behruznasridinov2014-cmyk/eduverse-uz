import { pool } from "@workspace/db";
import { runTelegramOutboxWorker } from "./lib/telegram-outbox-worker";
import { logger } from "./lib/logger";

const abortController = new AbortController();
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Telegram worker shutdown requested");
  abortController.abort();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const workerLockId = 1_820_711_501;
const lockConnection = await pool.connect();
try {
  const lock = await lockConnection.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [workerLockId],
  );
  if (!lock.rows[0]?.acquired) {
    throw new Error("Another Telegram outbox worker already holds the database lock.");
  }
  await runTelegramOutboxWorker(abortController.signal);
} finally {
  await lockConnection.query("SELECT pg_advisory_unlock($1)", [workerLockId]);
  lockConnection.release();
  await pool.end();
}
