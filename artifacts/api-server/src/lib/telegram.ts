/**
 * Minimal Telegram Bot API client (no external dependencies).
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN   — from @BotFather (required to send real messages)
 *   TELEGRAM_WEBHOOK_SECRET — secret placed in the `X-Telegram-Bot-Api-Secret-Token` header;
 *                              set it with `setWebhook` so only Telegram can call our webhook.
 *   TELEGRAM_BOT_USERNAME — username of the bot (without @), used to build bind links like
 *                           `https://t.me/YourBot?start=bind_…`.
 *
 * Messages are delivered by the database-backed outbox worker. This module
 * deliberately never logs message bodies, chat ids, bot tokens, or API errors.
 */
const API_BASE = "https://api.telegram.org";

const botToken = () => (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
export const telegramBotConfigured = () => botToken().length > 0;
export const telegramBotUsername = () => {
  const username = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
};
export const telegramWebhookSecret = () => {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  return /^[A-Za-z0-9_-]{1,256}$/.test(secret) ? secret : "";
};
export const devEchoCodes = () => process.env.NODE_ENV !== "production" && process.env.EDUVERSE_DEV_2FA_ECHO === "1";

type TelegramResponse = {
  ok: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export type TelegramDeliveryResult =
  | { ok: true }
  | {
      ok: false;
      errorCode: "not_configured" | "rate_limited" | "telegram_error" | "network_error";
      retryable: boolean;
      retryAfterSeconds?: number;
    };

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options: { token?: string; fetcher?: typeof fetch } = {},
): Promise<TelegramDeliveryResult> {
  const token = options.token ?? botToken();
  if (!token) {
    return { ok: false, errorCode: "not_configured", retryable: false };
  }

  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      retryable: true,
    };
  }

  let result: TelegramResponse;
  try {
    result = (await response.json()) as TelegramResponse;
  } catch {
    return {
      ok: false,
      errorCode: "telegram_error",
      retryable: response.status >= 500 || response.status === 408,
    };
  }

  if (response.ok && result.ok) return { ok: true };
  if (response.status === 429 || result.error_code === 429) {
    const retryAfterSeconds = result.parameters?.retry_after;
    return {
      ok: false,
      errorCode: "rate_limited",
      retryable: true,
      ...(typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
        ? { retryAfterSeconds }
        : {}),
    };
  }
  return {
    ok: false,
    errorCode: "telegram_error",
    retryable: response.status >= 500 || response.status === 408,
  };
}

export function buildBindLink(nonce: string): string | null {
  const username = telegramBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=bind_${nonce}`;
}
