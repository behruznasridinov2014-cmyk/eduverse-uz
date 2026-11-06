import assert from "node:assert/strict";
import { once } from "node:events";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  encryptSecret,
  generateTotpSecret,
  hashChallengeToken,
  hashRecoveryCode,
  totp,
} from "../src/lib/two-factor.ts";
import { hashPassword } from "../src/lib/auth-crypto.ts";

const testDatabaseUrl = process.env.EDUVERSE_TEST_DATABASE_URL;

function isDedicatedLocalTestDatabase(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const isLoopback =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1";
    return isLoopback && /^\/eduverse_test(?:_[a-z0-9_]+)?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

if (!isDedicatedLocalTestDatabase(testDatabaseUrl)) {
  describe("Telegram 2FA API integration", { skip: "Requires EDUVERSE_TEST_DATABASE_URL pointing to a dedicated local eduverse_test database." }, () => {
    it("is intentionally skipped without an isolated local test database", () => {});
  });
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.TRUST_PROXY = "1";
  process.env.TELEGRAM_BOT_TOKEN = "123456:test_only_token";
  process.env.TELEGRAM_BOT_USERNAME = "eduverse_test_bot";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.TWO_FACTOR_ENCRYPTION_KEY = "11".repeat(32);
  process.env.EDUVERSE_DEV_2FA_ECHO = "0";

  describe("Telegram 2FA API integration", { concurrency: false }, () => {
    type DatabaseModule = typeof import("@workspace/db");
    let database: DatabaseModule;
    let baseUrls: string[] = [];
    let servers: import("node:http").Server[] = [];
    const userIds: string[] = [];
    const chatIds: string[] = [];
    let forwardedIpCounter = randomInt(1, 200);

    before(async () => {
      database = await import("@workspace/db");
      const { default: app } = await import("../src/app.ts");
      const schemaState = await database.pool.query<{ ready: boolean }>(
        `SELECT to_regclass('public.users') IS NOT NULL
          AND to_regclass('public.sessions') IS NOT NULL
          AND to_regclass('public.two_factor_recovery_codes') IS NOT NULL
          AND to_regclass('public.two_factor_challenges') IS NOT NULL
          AND to_regclass('public.telegram_outbox') IS NOT NULL
          AND to_regclass('public.rate_limit_buckets') IS NOT NULL AS ready`,
      );
      assert.equal(
        schemaState.rows[0]?.ready,
        true,
        "Apply the schema to the dedicated local test database before running integration tests.",
      );
      servers = [app.listen(0, "127.0.0.1"), app.listen(0, "127.0.0.1")];
      await Promise.all(servers.map((instance) => once(instance, "listening")));
      baseUrls = servers.map((instance) => {
        const address = instance.address();
        assert.ok(address && typeof address === "object");
        return `http://127.0.0.1:${address.port}`;
      });
    });

    after(async () => {
      if (database && chatIds.length > 0) {
        await database.db
          .delete(database.telegramOutboxTable)
          .where(inArray(database.telegramOutboxTable.chatId, chatIds));
      }
      if (database && userIds.length > 0) {
        await database.db
          .delete(database.usersTable)
          .where(inArray(database.usersTable.id, userIds));
      }
      if (servers) {
        await Promise.all(
          servers.map((instance) => new Promise<void>((resolve, reject) => {
            instance.close((error) => error ? reject(error) : resolve());
          })),
        );
      }
      if (database) await database.pool.end();
    });

    async function createUser(options: {
      enabled?: boolean;
      pendingNonce?: string | null;
      pendingExpiresAt?: Date | null;
      recoveryCode?: string;
    } = {}) {
      const idSuffix = randomUUID().replaceAll("-", "");
      const login = `twofa_${idSuffix.slice(0, 24)}`;
      const secret = generateTotpSecret();
      const chatId = String(randomInt(1_000_000_000, 9_000_000_000));
      const passwordHash = await hashPassword("test-password-2026");
      const [user] = await database.db
        .insert(database.usersTable)
        .values({
          username: login,
          usernameNormalized: login,
          login,
          loginNormalized: login,
          passwordHash,
          twoFactorSecret: options.enabled || options.pendingNonce
            ? encryptSecret(secret)
            : null,
          twoFactorTelegramId: options.enabled ? chatId : null,
          twoFactorEnabled: options.enabled ?? false,
          twoFactorPendingNonce: options.pendingNonce ?? null,
          twoFactorPendingExpiresAt: options.pendingExpiresAt ?? null,
        })
        .returning({ id: database.usersTable.id });
      assert.ok(user);
      userIds.push(user.id);
      if (options.enabled) chatIds.push(chatId);
      if (options.recoveryCode) {
        await database.db.insert(database.twoFactorRecoveryTable).values({
          userId: user.id,
          codeHash: hashRecoveryCode(options.recoveryCode),
        });
      }
      return { id: user.id, login, secret, chatId };
    }

    async function post(
      path: string,
      body: unknown,
      options: { webhookSecret?: string | null } = {},
    ) {
      forwardedIpCounter = (forwardedIpCounter % 200) + 1;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${forwardedIpCounter}`,
      };
      if (options.webhookSecret !== null) {
        headers["x-telegram-bot-api-secret-token"] =
          options.webhookSecret ?? "test_webhook_secret";
      }
      const baseUrl = baseUrls[forwardedIpCounter % baseUrls.length]!;
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    async function startLogin(login: string) {
      const response = await post("/api/auth/login", {
        login,
        password: "test-password-2026",
      });
      assert.equal(response.status, 202);
      assert.equal(response.headers.get("set-cookie"), null);
      return response.json() as Promise<{ twoFactorRequired: boolean; challengeToken: string }>;
    }

    async function sessionCount(userId: string): Promise<number> {
      const rows = await database.db
        .select({ id: database.sessionsTable.id })
        .from(database.sessionsTable)
        .where(eq(database.sessionsTable.userId, userId));
      return rows.length;
    }

    it("rejects missing and incorrect webhook secrets without changing account state", async () => {
      const nonce = randomBytesText();
      const user = await createUser({
        pendingNonce: nonce,
        pendingExpiresAt: new Date(Date.now() + 60_000),
      });
      const update = {
        update_id: randomInt(1, 2_000_000_000),
        message: {
          text: `/start bind_${nonce}`,
          chat: { id: 2_000_001_001, type: "private" },
        },
      };

      const missing = await post("/api/auth/2fa/telegram/webhook", update, {
        webhookSecret: null,
      });
      const incorrect = await post("/api/auth/2fa/telegram/webhook", update, {
        webhookSecret: "incorrect_webhook_secret",
      });
      assert.equal(missing.status, 403);
      assert.equal(incorrect.status, 403);

      const [account] = await database.db
        .select({ telegramId: database.usersTable.twoFactorTelegramId })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, user.id));
      assert.equal(account?.telegramId, null);
    });

    it("binds a private chat once, ignores wrong or expired nonces, and deduplicates repeated updates", async () => {
      const nonce = randomBytesText();
      const validUser = await createUser({
        pendingNonce: nonce,
        pendingExpiresAt: new Date(Date.now() + 60_000),
      });
      const validChatId = "2000001002";
      chatIds.push(validChatId);
      const update = {
        update_id: randomInt(1, 2_000_000_000),
        message: {
          text: `/start bind_${nonce}`,
          chat: { id: Number(validChatId), type: "private" },
        },
      };

      const bound = await post("/api/auth/2fa/telegram/webhook", update);
      assert.equal(bound.status, 200);
      const duplicate = await post("/api/auth/2fa/telegram/webhook", update);
      assert.equal(duplicate.status, 200);
      const [validAccount] = await database.db
        .select({
          telegramId: database.usersTable.twoFactorTelegramId,
          pendingNonce: database.usersTable.twoFactorPendingNonce,
        })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, validUser.id));
      assert.equal(validAccount?.telegramId, validChatId);
      assert.equal(validAccount?.pendingNonce, null);
      const outboxRows = await database.db
        .select({ id: database.telegramOutboxTable.id })
        .from(database.telegramOutboxTable)
        .where(eq(database.telegramOutboxTable.chatId, validChatId));
      assert.equal(outboxRows.length, 1);

      const wrongNonce = randomBytesText();
      const wrongUser = await createUser({
        pendingNonce: wrongNonce,
        pendingExpiresAt: new Date(Date.now() + 60_000),
      });
      const wrong = await post("/api/auth/2fa/telegram/webhook", {
        update_id: randomInt(1, 2_000_000_000),
        message: {
          text: `/start bind_${randomBytesText()}`,
          chat: { id: 2_000_001_003, type: "private" },
        },
      });
      assert.equal(wrong.status, 200);
      const [wrongAccount] = await database.db
        .select({ telegramId: database.usersTable.twoFactorTelegramId })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, wrongUser.id));
      assert.equal(wrongAccount?.telegramId, null);

      const expiredNonce = randomBytesText();
      const expiredUser = await createUser({
        pendingNonce: expiredNonce,
        pendingExpiresAt: new Date(Date.now() - 1_000),
      });
      const expired = await post("/api/auth/2fa/telegram/webhook", {
        update_id: randomInt(1, 2_000_000_000),
        message: {
          text: `/start bind_${expiredNonce}`,
          chat: { id: 2_000_001_004, type: "private" },
        },
      });
      assert.equal(expired.status, 200);
      const [expiredAccount] = await database.db
        .select({ telegramId: database.usersTable.twoFactorTelegramId })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, expiredUser.id));
      assert.equal(expiredAccount?.telegramId, null);

      const groupNonce = randomBytesText();
      const groupUser = await createUser({
        pendingNonce: groupNonce,
        pendingExpiresAt: new Date(Date.now() + 60_000),
      });
      const group = await post("/api/auth/2fa/telegram/webhook", {
        update_id: randomInt(1, 2_000_000_000),
        message: {
          text: `/start bind_${groupNonce}`,
          chat: { id: -2_000_001_005, type: "group" },
        },
      });
      assert.equal(group.status, 200);
      const [groupAccount] = await database.db
        .select({ telegramId: database.usersTable.twoFactorTelegramId })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, groupUser.id));
      assert.equal(groupAccount?.telegramId, null);
    });

    it("does not issue a session before a valid code and rejects expired or replayed challenges", async () => {
      const user = await createUser({ enabled: true });
      const challenge = await startLogin(user.login);
      assert.equal(challenge.twoFactorRequired, true);
      assert.equal(await sessionCount(user.id), 0);

      const invalid = await post("/api/auth/2fa/login/verify", {
        challengeToken: challenge.challengeToken,
        code: wrongCodeFor(user.secret),
      });
      assert.equal(invalid.status, 401);
      assert.equal(invalid.headers.get("set-cookie"), null);
      assert.equal(await sessionCount(user.id), 0);

      const usedCode = totp(user.secret);
      const valid = await post("/api/auth/2fa/login/verify", {
        challengeToken: challenge.challengeToken,
        code: usedCode,
      });
      assert.equal(valid.status, 200);
      assert.ok(valid.headers.get("set-cookie"));
      assert.equal(await sessionCount(user.id), 1);

      const secondChallenge = await startLogin(user.login);
      const reusedCode = await post("/api/auth/2fa/login/verify", {
        challengeToken: secondChallenge.challengeToken,
        code: usedCode,
      });
      assert.equal(reusedCode.status, 409);
      assert.equal(reusedCode.headers.get("set-cookie"), null);
      assert.equal(await sessionCount(user.id), 1);

      const replay = await post("/api/auth/2fa/login/verify", {
        challengeToken: challenge.challengeToken,
        code: totp(user.secret),
      });
      assert.ok([409, 410].includes(replay.status));
      assert.equal(replay.headers.get("set-cookie"), null);

      const expiredUser = await createUser({ enabled: true });
      const expiredChallenge = await startLogin(expiredUser.login);
      await database.db
        .update(database.twoFactorChallengesTable)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(
          eq(
            database.twoFactorChallengesTable.tokenHash,
            hashChallengeToken(expiredChallenge.challengeToken),
          ),
        );
      const expired = await post("/api/auth/2fa/login/verify", {
        challengeToken: expiredChallenge.challengeToken,
        code: totp(expiredUser.secret),
      });
      assert.equal(expired.status, 410);
      assert.equal(expired.headers.get("set-cookie"), null);
      assert.equal(await sessionCount(expiredUser.id), 0);
    });

    it("applies shared per-account limits to code delivery and verification", async () => {
      const deliveryUser = await createUser({ enabled: true });
      const deliveryResponses = await Promise.all(
        Array.from({ length: 8 }, () =>
          post("/api/auth/login", {
            login: deliveryUser.login,
            password: "test-password-2026",
          }),
        ),
      );
      assert.equal(
        deliveryResponses.filter((response) => response.status === 202).length,
        5,
      );
      assert.equal(
        deliveryResponses.filter((response) => response.status === 429).length,
        3,
      );
      const queuedMessages = await database.db
        .select({ id: database.telegramOutboxTable.id })
        .from(database.telegramOutboxTable)
        .where(eq(database.telegramOutboxTable.chatId, deliveryUser.chatId));
      assert.equal(queuedMessages.length, 5);

      const verificationUser = await createUser({ enabled: true });
      const challenge = await startLogin(verificationUser.login);
      const invalidCode = wrongCodeFor(verificationUser.secret);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await post("/api/auth/2fa/login/verify", {
          challengeToken: challenge.challengeToken,
          code: invalidCode,
        });
        assert.equal(response.status, 401);
      }
      const blockedVerification = await post("/api/auth/2fa/login/verify", {
        challengeToken: challenge.challengeToken,
        code: invalidCode,
      });
      assert.equal(blockedVerification.status, 429);
      assert.equal(await sessionCount(verificationUser.id), 0);
    });

    it("atomically binds one of two concurrent private-chat updates", async () => {
      const nonce = randomBytesText();
      const user = await createUser({
        pendingNonce: nonce,
        pendingExpiresAt: new Date(Date.now() + 60_000),
      });
      const chatIdsForRace = ["2000001101", "2000001102"];
      chatIds.push(...chatIdsForRace);
      const responses = await Promise.all(
        chatIdsForRace.map((chatId, index) =>
          post("/api/auth/2fa/telegram/webhook", {
            update_id: randomInt(1, 2_000_000_000) + index,
            message: {
              text: `/start bind_${nonce}`,
              chat: { id: Number(chatId), type: "private" },
            },
          }),
        ),
      );
      assert.deepEqual(responses.map((response) => response.status), [200, 200]);
      const [account] = await database.db
        .select({ telegramId: database.usersTable.twoFactorTelegramId })
        .from(database.usersTable)
        .where(eq(database.usersTable.id, user.id));
      assert.ok(chatIdsForRace.includes(account?.telegramId ?? ""));
      const outboxRows = await database.db
        .select({ id: database.telegramOutboxTable.id })
        .from(database.telegramOutboxTable)
        .where(inArray(database.telegramOutboxTable.chatId, chatIdsForRace));
      assert.equal(outboxRows.length, 1);
    });

    it("consumes recovery codes once and permits the ordinary password-only login", async () => {
      const recoveryCode = "a1b2-c3d4-e5f6";
      const user = await createUser({
        enabled: true,
        recoveryCode,
      });
      const firstChallenge = await startLogin(user.login);
      const recovered = await post("/api/auth/2fa/login/verify", {
        challengeToken: firstChallenge.challengeToken,
        code: recoveryCode,
      });
      assert.equal(recovered.status, 200);

      const secondChallenge = await startLogin(user.login);
      const reused = await post("/api/auth/2fa/login/verify", {
        challengeToken: secondChallenge.challengeToken,
        code: recoveryCode,
      });
      assert.equal(reused.status, 401);

      const ordinaryUser = await createUser();
      const ordinaryLogin = await post("/api/auth/login", {
        login: ordinaryUser.login,
        password: "test-password-2026",
      });
      assert.equal(ordinaryLogin.status, 200);
      assert.ok(ordinaryLogin.headers.get("set-cookie"));
      assert.equal(await sessionCount(ordinaryUser.id), 1);
    });

    it("allows exactly one of two concurrent code checks to create a session", async () => {
      const user = await createUser({ enabled: true });
      const challenge = await startLogin(user.login);
      const payload = {
        challengeToken: challenge.challengeToken,
        code: totp(user.secret),
      };
      const responses = await Promise.all([
        post("/api/auth/2fa/login/verify", payload),
        post("/api/auth/2fa/login/verify", payload),
      ]);
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      assert.equal(
        responses.filter((response) => [409, 410].includes(response.status)).length,
        1,
      );
      assert.equal(await sessionCount(user.id), 1);
    });
  });
}

function randomBytesText(): string {
  return randomUUID().replaceAll("-", "") + randomUUID().slice(0, 8);
}

function wrongCodeFor(secret: string): string {
  const valid = new Set(
    [-30_000, 0, 30_000].map((offset) => totp(secret, Date.now() + offset)),
  );
  for (let value = 0; value < 1_000_000; value += 1) {
    const candidate = String(value).padStart(6, "0");
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error("Could not produce a test code distinct from valid TOTP codes.");
}
