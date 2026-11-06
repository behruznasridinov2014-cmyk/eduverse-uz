import { timingSafeEqual } from "node:crypto";

export function matchesTelegramWebhookSecret(
  expectedSecret: string,
  receivedSecret: string,
): boolean {
  if (!expectedSecret) return false;
  const expected = Buffer.from(expectedSecret, "utf8");
  const received = Buffer.from(receivedSecret, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function telegramBindNonceFromMessage(
  chatType: unknown,
  text: unknown,
): string | null {
  if (chatType !== "private" || typeof text !== "string") return null;
  const match = /^\/start(?:@\w+)?\s+bind_([A-Za-z0-9_-]{40,64})$/.exec(text.trim());
  return match?.[1] ?? null;
}

export function isActiveTelegramBindNonce(input: {
  candidate: string;
  pendingNonce: string | null;
  pendingExpiresAt: Date | null;
  enabled: boolean;
  now?: number;
}): boolean {
  return (
    !input.enabled &&
    input.pendingNonce !== null &&
    input.pendingNonce === input.candidate &&
    input.pendingExpiresAt !== null &&
    input.pendingExpiresAt.getTime() > (input.now ?? Date.now())
  );
}
