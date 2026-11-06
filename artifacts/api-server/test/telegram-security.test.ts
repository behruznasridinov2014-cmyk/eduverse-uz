import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isActiveTelegramBindNonce,
  matchesTelegramWebhookSecret,
  telegramBindNonceFromMessage,
} from "../src/lib/telegram-security.ts";

describe("Telegram webhook security helpers", () => {
  it("compares webhook secrets safely and rejects missing or incorrect values", () => {
    assert.equal(matchesTelegramWebhookSecret("", ""), false);
    assert.equal(matchesTelegramWebhookSecret("expected_secret", ""), false);
    assert.equal(matchesTelegramWebhookSecret("expected_secret", "wrong_secret!"), false);
    assert.equal(matchesTelegramWebhookSecret("expected_secret", "expected_secret"), true);
    assert.doesNotThrow(() =>
      matchesTelegramWebhookSecret("aaaaaaaa", "💡💡💡💡💡💡💡💡"),
    );
    assert.equal(
      matchesTelegramWebhookSecret("aaaaaaaa", "💡💡💡💡💡💡💡💡"),
      false,
    );
  });

  it("accepts only private /start bind commands with bounded nonce syntax", () => {
    const nonce = "A".repeat(43);
    assert.equal(
      telegramBindNonceFromMessage("private", `/start bind_${nonce}`),
      nonce,
    );
    assert.equal(
      telegramBindNonceFromMessage("private", `/start@eduverse_bot bind_${nonce}`),
      nonce,
    );
    assert.equal(telegramBindNonceFromMessage("group", `/start bind_${nonce}`), null);
    assert.equal(telegramBindNonceFromMessage("private", `/start bind_short`), null);
    assert.equal(telegramBindNonceFromMessage("private", `/help bind_${nonce}`), null);
  });

  it("accepts a live nonce once and rejects wrong, expired, enabled, and consumed states", () => {
    const nonce = "B".repeat(43);
    const now = Date.now();
    const liveBinding = {
      candidate: nonce,
      pendingNonce: nonce,
      pendingExpiresAt: new Date(now + 1_000),
      enabled: false,
      now,
    };

    assert.equal(isActiveTelegramBindNonce(liveBinding), true);
    assert.equal(
      isActiveTelegramBindNonce({ ...liveBinding, candidate: "C".repeat(43) }),
      false,
    );
    assert.equal(
      isActiveTelegramBindNonce({
        ...liveBinding,
        pendingExpiresAt: new Date(now),
      }),
      false,
    );
    assert.equal(isActiveTelegramBindNonce({ ...liveBinding, enabled: true }), false);
    assert.equal(
      isActiveTelegramBindNonce({
        ...liveBinding,
        pendingNonce: null,
        pendingExpiresAt: null,
      }),
      false,
    );
  });
});
