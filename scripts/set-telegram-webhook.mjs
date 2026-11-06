const WEBHOOK_PATH = "/api/auth/2fa/telegram/webhook";
const TELEGRAM_API = "https://api.telegram.org";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const suppliedUrl =
    (process.env.TELEGRAM_WEBHOOK_URL ?? "").trim() ||
    process.argv.slice(2).find((arg) => arg !== "--");

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    fail("TELEGRAM_BOT_TOKEN is missing or malformed in the environment.");
    return;
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    fail("TELEGRAM_WEBHOOK_SECRET must be 1–256 letters, digits, _ or -.");
    return;
  }
  if (!suppliedUrl) {
    fail(`Set TELEGRAM_WEBHOOK_URL to the deployed HTTPS URL ending in ${WEBHOOK_PATH}.`);
    return;
  }

  let webhookUrl;
  try {
    webhookUrl = new URL(suppliedUrl);
  } catch {
    fail("TELEGRAM_WEBHOOK_URL must be a valid HTTPS URL.");
    return;
  }
  if (
    webhookUrl.protocol !== "https:" ||
    webhookUrl.username ||
    webhookUrl.password ||
    webhookUrl.search ||
    webhookUrl.hash ||
    webhookUrl.pathname !== WEBHOOK_PATH
  ) {
    fail(`TELEGRAM_WEBHOOK_URL must be HTTPS and use the exact path ${WEBHOOK_PATH}.`);
    return;
  }

  let response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl.toString(),
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail("Telegram webhook registration failed due to a network or timeout error.");
    return;
  }

  let result;
  try {
    result = await response.json();
  } catch {
    fail(`Telegram webhook registration failed (HTTP ${response.status}).`);
    return;
  }
  if (!response.ok || !result || result.ok !== true) {
    fail(`Telegram webhook registration failed (HTTP ${response.status}).`);
    return;
  }
  console.log("Telegram webhook registered successfully.");
}

main().catch(() => {
  fail("Telegram webhook registration failed.");
});
