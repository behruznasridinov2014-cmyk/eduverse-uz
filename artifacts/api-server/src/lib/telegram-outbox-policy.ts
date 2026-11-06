const MAX_BACKOFF_SECONDS = 300;
export const TELEGRAM_CHAT_MIN_SEND_INTERVAL_MS = 1_000;

export function telegramRetryDelaySeconds(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.min(3_600, Math.max(1, Math.ceil(retryAfterSeconds)));
  }
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(0, attempt - 1));
}

export function telegramChatDelayMs(lastSentAt: Date | null, nowMs: number): number {
  if (!lastSentAt) return 0;
  return Math.max(
    0,
    lastSentAt.getTime() + TELEGRAM_CHAT_MIN_SEND_INTERVAL_MS - nowMs,
  );
}
