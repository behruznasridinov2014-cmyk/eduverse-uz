import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendTelegramMessage } from "../src/lib/telegram.ts";
import {
  telegramChatDelayMs,
  telegramRetryDelaySeconds,
} from "../src/lib/telegram-outbox-policy.ts";

describe("Telegram Bot API delivery", () => {
  it("sends a message using the configured bot and reports success", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const result = await sendTelegramMessage("12345", "confirmation code", {
      token: "test-token",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
      },
    });

    assert.deepEqual(result, { ok: true });
    assert.match(requestUrl, /\/bottest-token\/sendMessage$/);
    assert.deepEqual(requestBody, {
      chat_id: "12345",
      text: "confirmation code",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  });

  it("honors Telegram retry_after without exposing its response text", async () => {
    const result = await sendTelegramMessage("12345", "code", {
      token: "test-token",
      fetcher: async () => new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "private response text",
          parameters: { retry_after: 17 },
        }),
        { status: 429 },
      ),
    });

    assert.deepEqual(result, {
      ok: false,
      errorCode: "rate_limited",
      retryable: true,
      retryAfterSeconds: 17,
    });
    assert.equal(JSON.stringify(result).includes("private response text"), false);
  });

  it("retries network and server failures but not permanent Telegram errors", async () => {
    const networkFailure = await sendTelegramMessage("12345", "code", {
      token: "test-token",
      fetcher: async () => { throw new Error("network details"); },
    });

    it("treats a Telegram request timeout as retryable without exposing its error", async () => {
      const timeout = Object.assign(new Error("private timeout details"), {
        name: "TimeoutError",
      });
      const result = await sendTelegramMessage("12345", "code", {
        token: "test-token",
        fetcher: async () => {
          throw timeout;
        },
      });

      assert.deepEqual(result, {
        ok: false,
        errorCode: "network_error",
        retryable: true,
      });
      assert.equal(JSON.stringify(result).includes("private timeout details"), false);
    });
    const serverFailure = await sendTelegramMessage("12345", "code", {
      token: "test-token",
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });
    const permanentFailure = await sendTelegramMessage("12345", "code", {
      token: "test-token",
      fetcher: async () => new Response(
        JSON.stringify({ ok: false, error_code: 400 }),
        { status: 400 },
      ),
    });

    assert.equal(networkFailure.ok, false);
    assert.equal(networkFailure.retryable, true);
    assert.equal(serverFailure.retryable, true);
    assert.equal(permanentFailure.retryable, false);
  });

  it("fails closed when no bot token is configured", async () => {
    const result = await sendTelegramMessage("12345", "code", {
      token: "",
      fetcher: async () => { throw new Error("fetch should not run"); },
    });

    assert.deepEqual(result, {
      ok: false,
      errorCode: "not_configured",
      retryable: false,
    });
  });
});

describe("Telegram outbox retry policy", () => {
  it("uses bounded exponential backoff and Telegram retry_after", () => {
    assert.equal(telegramRetryDelaySeconds(1), 1);
    assert.equal(telegramRetryDelaySeconds(4), 8);
    assert.equal(telegramRetryDelaySeconds(20), 300);
    assert.equal(telegramRetryDelaySeconds(2, 17), 17);
    assert.equal(telegramRetryDelaySeconds(2, 100_000), 3_600);
  });

  it("enforces Telegram's per-chat send interval using persisted last-send time", () => {
    const lastSentAt = new Date(10_000);
    assert.equal(telegramChatDelayMs(null, 10_000), 0);
    assert.equal(telegramChatDelayMs(lastSentAt, 10_250), 750);
    assert.equal(telegramChatDelayMs(lastSentAt, 11_000), 0);
  });
});
