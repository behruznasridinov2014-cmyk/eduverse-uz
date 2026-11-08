import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import {
  db,
  rateLimitBucketsTable,
  qrLoginSessionsTable,
  sessionsTable,
  twoFactorChallengesTable,
  twoFactorRecoveryTable,
  telegramOutboxTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import {
  createSessionToken,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../lib/auth-crypto";
import {
  buildBindLink,
  devEchoCodes,
  telegramBotConfigured,
  telegramBotUsername,
  telegramWebhookSecret,
} from "../lib/telegram";
import { enqueueTelegramMessage } from "../lib/telegram-outbox";
import {
  buildOtpauthUrl,
  createChallengeToken,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashChallengeToken,
  hashRecoveryCode,
  twoFactorKeyIsConfigured,
  totp,
  verifyTotpStep,
} from "../lib/two-factor";
import { logger } from "../lib/logger";
import {
  isActiveTelegramBindNonce,
  matchesTelegramWebhookSecret,
  telegramBindNonceFromMessage,
} from "../lib/telegram-security";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";
const allowPublicRegistration = process.env.EDUVERSE_ALLOW_PUBLIC_REGISTRATION === "1";
const sessionCookieName = "eduverse.sid";
const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION_MS,
};
const configuredOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const registrationRateLimiter = createRateLimiter(
  Number(process.env.EDUVERSE_REGISTRATION_RATE_LIMIT ?? "10000") || 10000,
  60 * 60 * 1000,
  "Try again shortly.",
);
const loginRateLimiter = createRateLimiter(
  Number(process.env.EDUVERSE_LOGIN_RATE_LIMIT ?? "10000") || 10000,
  15 * 60 * 1000,
  "Try again shortly.",
);
const twoFactorChallengeDurationMs = 5 * 60 * 1000;
const twoFactorBindNonceDurationMs = 15 * 60 * 1000;
const twoFactorRateWindowMs = 15 * 60 * 1000;
const RATE_LIMIT_BUCKET_CLEANUP_MS = 10 * 60 * 1000;
let nextRateLimitCleanupAt = 0;

type User = typeof usersTable.$inferSelect;

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    login: user.login,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function hasOnlyFields(value: unknown, allowedFields: string[]): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((field) => allowedFields.includes(field))
  );
}

function normalizeUsername(username: string): string {
  return username.normalize("NFKC").toLowerCase();
}

function normalizeLogin(login: string): string {
  return login.toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueConstraintViolation(error.cause);
}

function requestOriginIsAllowed(req: Request, origin: string): boolean {
  if (configuredOrigins.has(origin)) return true;

  try {
    return new URL(origin).origin === `${req.protocol}://${req.get("host")}`;
  } catch {
    return false;
  }
}

export const requireAllowedOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (!origin || requestOriginIsAllowed(req, origin)) {
    next();
    return;
  }

  res.status(403).json({ error: "Request origin is not allowed." });
};

// Rate limits are intentionally DISABLED for this project (user request):
// every request passes straight through. Kept as a no-op so routes keep working.
export function createRateLimiter(
  _limit: number,
  _windowMs: number,
  _message: string,
  _scope = _message,
): RequestHandler {
  return (_req, _res, next) => next();
}

async function consumeRateLimitBucket(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<number | null> {
  const now = new Date();
  const key = createHash("sha256").update(`${scope}\0${identifier}`).digest("hex");
  const cutoff = new Date(now.getTime() - windowMs);

  if (Date.now() >= nextRateLimitCleanupAt) {
    nextRateLimitCleanupAt = Date.now() + RATE_LIMIT_BUCKET_CLEANUP_MS;
    void db
      .delete(rateLimitBucketsTable)
      .where(lt(rateLimitBucketsTable.windowStartedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
      .catch((error: unknown) => {
        logger.error({ err: error }, "Rate-limit bucket cleanup failed");
      });
  }

  const [bucket] = await db
    .insert(rateLimitBucketsTable)
    .values({ key, count: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: rateLimitBucketsTable.key,
      set: {
        count: sql`CASE WHEN ${rateLimitBucketsTable.windowStartedAt} <= ${cutoff} THEN 1 ELSE LEAST(${rateLimitBucketsTable.count} + 1, ${limit + 1}) END`,
        windowStartedAt: sql`CASE WHEN ${rateLimitBucketsTable.windowStartedAt} <= ${cutoff} THEN ${now} ELSE ${rateLimitBucketsTable.windowStartedAt} END`,
      },
    })
    .returning({
      count: rateLimitBucketsTable.count,
      windowStartedAt: rateLimitBucketsTable.windowStartedAt,
    });
  if (!bucket) throw new Error("Rate-limit bucket upsert did not return a row.");
  if (bucket.count <= limit) return null;

  return Math.max(
    1,
    Math.ceil((bucket.windowStartedAt.getTime() + windowMs - now.getTime()) / 1000),
  );
}

function sendRateLimitResponse(
  res: Response,
  message: string,
  retryAfterSeconds: number,
): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({ error: message });
}

async function applyUserRateLimit(
  userId: string,
  scope: string,
  limit: number,
  windowMs: number,
  res: Response,
  message: string,
): Promise<boolean> {
  const retryAfterSeconds = await consumeRateLimitBucket(
    scope,
    userId,
    limit,
    windowMs,
  );
  if (retryAfterSeconds === null) return true;
  sendRateLimitResponse(res, message, retryAfterSeconds);
  return false;
}

export function getAuthSecurityConfiguration() {
  return {
    sessionCookieHttpOnly: cookieOptions.httpOnly,
    sessionCookieSameSite: cookieOptions.sameSite,
    sessionCookieSecure: cookieOptions.secure,
    production: isProduction,
    loginRateLimitEnabled: typeof loginRateLimiter === "function",
    loginRateLimitScope: "postgresql-shared" as const,
  };
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(sessionCookieName, token, cookieOptions);
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}

async function authenticatedUserForRequest(req: Request): Promise<User | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const [user] = await db
    .select({ account: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, hashSessionToken(token)),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return user?.account ?? null;
}

function challengeTokenFrom(value: unknown): string | undefined {
  const token = getString(value, "challengeToken");
  return token && token.length <= 128 ? token : undefined;
}

function telegramSetupIsConfigured(): boolean {
  return telegramBotConfigured() && Boolean(telegramBotUsername()) && Boolean(telegramWebhookSecret());
}

function readSessionToken(req: Request): string | undefined {
  const token: unknown = req.cookies?.[sessionCookieName];
  return typeof token === "string" && token.length <= 128 ? token : undefined;
}

export function requireAuthenticatedRole(
  ...allowedRoles: AccountRole[]
): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(sessionsTable.tokenHash, hashSessionToken(token)),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!user) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: "You do not have permission to access this resource." });
      return;
    }

    res.locals.authenticatedUser = user;
    next();
  };
}

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post(
  "/auth/register",
  requireAllowedOrigin,
  registrationRateLimiter,
  async (req, res) => {
    if (!allowPublicRegistration) {
      res.status(403).json({ error: "Public registration is closed. Ask your school administrator for an account." });
      return;
    }

    if (
      !hasOnlyFields(req.body, [
        "username",
        "login",
        "password",
        "confirmPassword",
      ])
    ) {
      res.status(400).json({ error: "Unexpected registration fields." });
      return;
    }

    const username = getString(req.body, "username")?.trim();
    const login = getString(req.body, "login")?.trim();
    const password = getString(req.body, "password");
    const confirmPassword = getString(req.body, "confirmPassword");

    if (
      !username ||
      username.length < 2 ||
      username.length > 40 ||
      !/^[\p{L}\p{N}_. -]+$/u.test(username)
    ) {
      res.status(400).json({
        error: "Username must be 2–40 letters, numbers, spaces, dots, _ or -.",
      });
      return;
    }

    if (!login || !/^[a-zA-Z0-9._-]{3,32}$/.test(login)) {
      res.status(400).json({
        error: "Login must be 3–32 letters, numbers, dots, _ or -.",
      });
      return;
    }

    if (!password || password.length < 8 || password.length > 128) {
      res.status(400).json({
        error: "Password must be between 8 and 128 characters.",
      });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: "Passwords do not match." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    try {
      const user = await db.transaction(async (transaction) => {
        const [createdUser] = await transaction
          .insert(usersTable)
          .values({
            username,
            usernameNormalized: normalizeUsername(username),
            login,
            loginNormalized: normalizeLogin(login),
            passwordHash,
          })
          .returning();

        if (!createdUser) {
          throw new Error("User insert did not return a row.");
        }

        await transaction.insert(sessionsTable).values({
          userId: createdUser.id,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt,
        });

        return createdUser;
      });

      setSessionCookie(res, sessionToken);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ error: "Username or login is already taken." });
        return;
      }

      throw error;
    }
  },
);

router.post(
  "/auth/login",
  requireAllowedOrigin,
  loginRateLimiter,
  async (req, res) => {
    if (!hasOnlyFields(req.body, ["login", "password"])) {
      res.status(400).json({ error: "Unexpected sign-in fields." });
      return;
    }

    const login = getString(req.body, "login")?.trim();
    const password = getString(req.body, "password");

    if (
      !login ||
      !/^[a-zA-Z0-9._-]{3,32}$/.test(login) ||
      !password ||
      password.length < 8 ||
      password.length > 128
    ) {
      res.status(400).json({ error: "Enter a valid login and password." });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.loginNormalized, normalizeLogin(login)))
      .limit(1);

    const passwordHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const passwordIsValid = await verifyPassword(password, passwordHash);
    if (!user || !passwordIsValid) {
      res.status(401).json({ error: "Login or password is incorrect." });
      return;
    }

    if (user.twoFactorEnabled) {
      if (!user.twoFactorSecret) {
        res.status(503).json({ error: "Two-factor authentication is not configured correctly." });
        return;
      }
      if (process.env.NODE_ENV === "production" && !twoFactorKeyIsConfigured()) {
        res.status(503).json({ error: "Two-factor encryption is not configured on the server." });
        return;
      }
      if (
        !(await applyUserRateLimit(
          user.id,
          "two-factor-login-user",
          9999,
          twoFactorRateWindowMs,
          res,
          "Try again shortly.",
        ))
      ) {
        return;
      }

      const challengeToken = createChallengeToken();
      const expiresAt = new Date(Date.now() + twoFactorChallengeDurationMs);
      await db
        .delete(twoFactorChallengesTable)
        .where(lt(twoFactorChallengesTable.expiresAt, new Date()));
      const [challenge] = await db
        .insert(twoFactorChallengesTable)
        .values({
          userId: user.id,
          tokenHash: hashChallengeToken(challengeToken),
          expiresAt,
        })
        .returning({ id: twoFactorChallengesTable.id });
      if (!challenge) throw new Error("Two-factor challenge insert did not return a row.");

      const code = totp(decryptSecret(user.twoFactorSecret));
      const queued = telegramBotConfigured();
      if (queued && user.twoFactorTelegramId) {
        await enqueueTelegramMessage({
          chatId: user.twoFactorTelegramId,
          text: `EDUVERSE sign-in code: <code>${code}</code>`,
          deduplicationKey: `login:${challenge.id}`,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }

      res.status(202).json({
        twoFactorRequired: true,
        challengeToken,
        expiresAt: expiresAt.toISOString(),
        ...(devEchoCodes() ? { devCode: code } : {}),
      });
      return;
    }

    const sessionToken = createSessionToken();
    await db.insert(sessionsTable).values({
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    });

    setSessionCookie(res, sessionToken);
    res.json({ user: publicUser(user) });
  },
);

router.get("/auth/me", async (req, res) => {
  const token = readSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      login: usersTable.login,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, hashSessionToken(token)),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  res.json({ user });
});

router.post("/auth/logout", requireAllowedOrigin, async (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, hashSessionToken(token)));
  }

  clearSessionCookie(res);
  res.status(204).end();
});

/* -------------------------------------------------------------------------- */
/* Telegram two-factor authentication                                         */
/* -------------------------------------------------------------------------- */

const twoFactorSetupLimiter = createRateLimiter(10000, 15 * 60 * 1000, "Try again shortly.");
const twoFactorCodeLimiter = createRateLimiter(10000, 15 * 60 * 1000, "Try again shortly.");

router.get("/auth/2fa/status", async (req, res) => {
  const user = await authenticatedUserForRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  res.json({
    enabled: user.twoFactorEnabled,
    telegramConnected: Boolean(user.twoFactorTelegramId),
    telegramAvailable: telegramSetupIsConfigured() || devEchoCodes(),
    authenticatorAvailable: true,
    setupLink:
      user.twoFactorPendingNonce &&
      user.twoFactorPendingExpiresAt &&
      user.twoFactorPendingExpiresAt.getTime() > Date.now()
        ? buildBindLink(user.twoFactorPendingNonce)
        : null,
  });
});

router.post("/auth/2fa/setup", requireAllowedOrigin, twoFactorSetupLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, [])) {
    res.status(400).json({ error: "Unexpected two-factor setup fields." });
    return;
  }
  const user = await authenticatedUserForRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (user.twoFactorEnabled) {
    res.status(409).json({ error: "Two-factor authentication is already enabled." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      user.id,
      "two-factor-setup-user",
      9999,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }
  if (process.env.NODE_ENV === "production" && !twoFactorKeyIsConfigured()) {
    res.status(503).json({ error: "Two-factor encryption is not configured on the server." });
    return;
  }
  const localSetup = devEchoCodes() && !telegramSetupIsConfigured();
  const telegramAvailable = telegramSetupIsConfigured();

  const secret = generateTotpSecret();
  const nonce = localSetup ? null : telegramAvailable ? randomBytes(32).toString("base64url") : null;
  const pendingExpiresAt = nonce
    ? new Date(Date.now() + twoFactorBindNonceDurationMs)
    : null;
  const bindLink = nonce ? buildBindLink(nonce) : null;
  const otpauthUrl = buildOtpauthUrl(secret, user.username || user.login);
  const [prepared] = await db
    .update(usersTable)
    .set({
      twoFactorSecret: encryptSecret(secret),
      twoFactorTelegramId: localSetup ? `dev:${user.id}` : null,
      twoFactorPendingNonce: nonce,
      twoFactorPendingExpiresAt: pendingExpiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(usersTable.id, user.id), eq(usersTable.twoFactorEnabled, false)))
    .returning({ id: usersTable.id });
  if (!prepared) {
    res.status(409).json({ error: "Two-factor setup is already in progress or enabled." });
    return;
  }

  res.json({
    otpauthUrl,
    secret,
    telegramAvailable,
    bindLink,
    ...(localSetup ? { devCode: totp(secret) } : {}),
  });
});

router.post("/auth/2fa/setup/resend", requireAllowedOrigin, twoFactorSetupLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, [])) {
    res.status(400).json({ error: "Unexpected two-factor setup fields." });
    return;
  }
  const user = await authenticatedUserForRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (user.twoFactorEnabled || !user.twoFactorSecret) {
    res.status(409).json({ error: "Complete two-factor setup before requesting a code." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      user.id,
      "two-factor-setup-user",
      9999,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }
  const code = totp(decryptSecret(user.twoFactorSecret));
  const queued = telegramBotConfigured();
  if (queued && user.twoFactorTelegramId) {
    await enqueueTelegramMessage({
      chatId: user.twoFactorTelegramId,
      text: `EDUVERSE setup code: <code>${code}</code>`,
      deduplicationKey: `setup:${user.id}:${randomBytes(16).toString("hex")}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  res.json({ sent: queued && Boolean(user.twoFactorTelegramId), ...(devEchoCodes() ? { devCode: code } : {}) });
});

router.post("/auth/2fa/enable", requireAllowedOrigin, twoFactorCodeLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, ["code"])) {
    res.status(400).json({ error: "Unexpected two-factor confirmation fields." });
    return;
  }
  const user = await authenticatedUserForRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      user.id,
      "two-factor-code-user",
      9999,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }
  const code = getString(req.body, "code")?.trim() ?? "";
  const setupStep = user.twoFactorSecret
    ? verifyTotpStep(decryptSecret(user.twoFactorSecret), code)
    : null;
  if (
    user.twoFactorEnabled ||
    !user.twoFactorSecret ||
    !/^\d{6}$/.test(code) ||
    setupStep === null
  ) {
    res.status(401).json({ error: "The confirmation code is invalid or expired." });
    return;
  }

  const recoveryCodes = generateRecoveryCodes();
  try {
    await db.transaction(async (tx) => {
      const [enabled] = await tx
        .update(usersTable)
        .set({
          twoFactorEnabled: true,
          twoFactorPendingNonce: null,
          twoFactorPendingExpiresAt: null,
          twoFactorEnabledAt: new Date(),
          twoFactorLastUsedStep: setupStep,
          updatedAt: new Date(),
        })
        .where(and(eq(usersTable.id, user.id), eq(usersTable.twoFactorEnabled, false)))
        .returning({ id: usersTable.id });
      if (!enabled) throw new TwoFactorChallengeConflict();
      await tx
        .delete(twoFactorRecoveryTable)
        .where(eq(twoFactorRecoveryTable.userId, user.id));
      await tx.insert(twoFactorRecoveryTable).values(
        recoveryCodes.map((recoveryCode) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(recoveryCode),
        })),
      );
    });
  } catch (requestError) {
    if (requestError instanceof TwoFactorChallengeConflict) {
      res.status(409).json({ error: "Two-factor setup has already been completed." });
      return;
    }
    throw requestError;
  }
  res.json({ enabled: true, recoveryCodes });
});

router.post("/auth/2fa/disable", requireAllowedOrigin, twoFactorCodeLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, ["code"])) {
    res.status(400).json({ error: "Unexpected two-factor disable fields." });
    return;
  }
  const user = await authenticatedUserForRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      user.id,
      "two-factor-code-user",
      9999,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }
  const code = getString(req.body, "code")?.trim() ?? "";
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    res.status(409).json({ error: "Two-factor authentication is not enabled." });
    return;
  }

  const disableTotpStep = /^\d{6}$/.test(code)
    ? verifyTotpStep(decryptSecret(user.twoFactorSecret), code)
    : null;
  const isTotpCode = disableTotpStep !== null;
  const recoveryHash = /^[a-fA-F0-9]{4}(?:-[a-fA-F0-9]{4}){2}$/.test(code)
    ? hashRecoveryCode(code)
    : null;
  const [recovery] = recoveryHash
    ? await db
        .select({ id: twoFactorRecoveryTable.id })
        .from(twoFactorRecoveryTable)
        .where(
          and(
            eq(twoFactorRecoveryTable.userId, user.id),
            eq(twoFactorRecoveryTable.codeHash, recoveryHash),
            isNull(twoFactorRecoveryTable.usedAt),
          ),
        )
        .limit(1)
    : [];
  if (!isTotpCode && !recovery) {
    res.status(401).json({ error: "The Telegram or recovery code is invalid." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      if (recovery) {
        const [usedRecovery] = await tx
          .update(twoFactorRecoveryTable)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(twoFactorRecoveryTable.id, recovery.id),
              isNull(twoFactorRecoveryTable.usedAt),
            ),
          )
          .returning({ id: twoFactorRecoveryTable.id });
        if (!usedRecovery) throw new TwoFactorChallengeConflict();
      }

      const [disabled] = await tx
        .update(usersTable)
        .set({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorTelegramId: null,
          twoFactorPendingNonce: null,
          twoFactorPendingExpiresAt: null,
          twoFactorEnabledAt: null,
          twoFactorLastUsedStep: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(usersTable.id, user.id),
            eq(usersTable.twoFactorEnabled, true),
            ...(disableTotpStep === null
              ? []
              : [
                  or(
                    isNull(usersTable.twoFactorLastUsedStep),
                    lt(usersTable.twoFactorLastUsedStep, disableTotpStep),
                  ),
                ]),
          ),
        )
        .returning({ id: usersTable.id });
      if (!disabled) throw new TwoFactorChallengeConflict();

      await tx
        .delete(twoFactorChallengesTable)
        .where(eq(twoFactorChallengesTable.userId, user.id));
      await tx
        .delete(twoFactorRecoveryTable)
        .where(eq(twoFactorRecoveryTable.userId, user.id));
    });
  } catch (error) {
    if (error instanceof TwoFactorChallengeConflict) {
      res.status(409).json({ error: "The two-factor code was already used. Try a new code." });
      return;
    }
    throw error;
  }
  res.json({ enabled: false });
});

router.post("/auth/2fa/login/resend", requireAllowedOrigin, twoFactorSetupLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, ["challengeToken"])) {
    res.status(400).json({ error: "Unexpected two-factor challenge fields." });
    return;
  }
  const challengeToken = challengeTokenFrom(req.body);
  if (!challengeToken) {
    res.status(400).json({ error: "A valid challenge token is required." });
    return;
  }
  const [challenge] = await db
    .select({
      userId: twoFactorChallengesTable.userId,
      expiresAt: twoFactorChallengesTable.expiresAt,
      consumedAt: twoFactorChallengesTable.consumedAt,
      secret: usersTable.twoFactorSecret,
      telegramId: usersTable.twoFactorTelegramId,
    })
    .from(twoFactorChallengesTable)
    .innerJoin(usersTable, eq(usersTable.id, twoFactorChallengesTable.userId))
    .where(eq(twoFactorChallengesTable.tokenHash, hashChallengeToken(challengeToken)))
    .limit(1);
  if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: "This two-factor challenge has expired. Sign in again." });
    return;
  }
  if (!challenge.secret || !challenge.telegramId) {
    res.status(503).json({ error: "Two-factor authentication is not configured correctly." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      challenge.userId,
      "two-factor-login-user",
      5,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }
  const code = totp(decryptSecret(challenge.secret));
  const queued = telegramBotConfigured();
  if (queued && challenge.telegramId) {
    await enqueueTelegramMessage({
      chatId: challenge.telegramId,
      text: `EDUVERSE sign-in code: <code>${code}</code>`,
      deduplicationKey: `login-resend:${hashChallengeToken(challengeToken)}:${randomBytes(12).toString("hex")}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  res.json({ sent: queued && Boolean(challenge.telegramId), ...(devEchoCodes() ? { devCode: code } : {}) });
});

class TwoFactorChallengeConflict extends Error {}

router.post("/auth/2fa/login/verify", requireAllowedOrigin, twoFactorCodeLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, ["challengeToken", "code"])) {
    res.status(400).json({ error: "Unexpected two-factor verification fields." });
    return;
  }
  const challengeToken = challengeTokenFrom(req.body);
  const code = getString(req.body, "code")?.trim() ?? "";
  if (
    !challengeToken ||
    (!/^\d{6}$/.test(code) && !/^[a-fA-F0-9]{4}(?:-[a-fA-F0-9]{4}){2}$/.test(code))
  ) {
    res.status(400).json({ error: "Enter a valid six-digit or recovery code." });
    return;
  }
  const [challenge] = await db
    .select({
      id: twoFactorChallengesTable.id,
      userId: usersTable.id,
      secret: usersTable.twoFactorSecret,
      telegramId: usersTable.twoFactorTelegramId,
      enabled: usersTable.twoFactorEnabled,
      expiresAt: twoFactorChallengesTable.expiresAt,
      consumedAt: twoFactorChallengesTable.consumedAt,
    })
    .from(twoFactorChallengesTable)
    .innerJoin(usersTable, eq(usersTable.id, twoFactorChallengesTable.userId))
    .where(eq(twoFactorChallengesTable.tokenHash, hashChallengeToken(challengeToken)))
    .limit(1);
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt.getTime() <= Date.now() ||
    !challenge.enabled ||
    !challenge.secret
  ) {
    res.status(410).json({ error: "This two-factor challenge has expired. Sign in again." });
    return;
  }
  if (
    !(await applyUserRateLimit(
      challenge.userId,
      "two-factor-code-user",
      9999,
      twoFactorRateWindowMs,
      res,
      "Try again shortly.",
    ))
  ) {
    return;
  }

  const totpStep = /^\d{6}$/.test(code)
    ? verifyTotpStep(decryptSecret(challenge.secret), code)
    : null;
  const isTotpCode = totpStep !== null;
  const recoveryHash = /^[a-fA-F0-9]{4}(?:-[a-fA-F0-9]{4}){2}$/.test(code)
    ? hashRecoveryCode(code)
    : null;
  const [recovery] = recoveryHash
    ? await db
        .select({ id: twoFactorRecoveryTable.id })
        .from(twoFactorRecoveryTable)
        .where(
          and(
            eq(twoFactorRecoveryTable.userId, challenge.userId),
            eq(twoFactorRecoveryTable.codeHash, recoveryHash),
            isNull(twoFactorRecoveryTable.usedAt),
          ),
        )
        .limit(1)
    : [];
  if (!isTotpCode && !recovery) {
    res.status(401).json({ error: "The Telegram or recovery code is invalid." });
    return;
  }

  const sessionToken = createSessionToken();
  try {
    const user = await db.transaction(async (tx) => {
      const [consumedChallenge] = await tx
        .update(twoFactorChallengesTable)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(twoFactorChallengesTable.id, challenge.id),
            isNull(twoFactorChallengesTable.consumedAt),
            gt(twoFactorChallengesTable.expiresAt, new Date()),
          ),
        )
        .returning({ id: twoFactorChallengesTable.id });
      if (!consumedChallenge) throw new TwoFactorChallengeConflict();

      if (recovery) {
        const [usedRecovery] = await tx
          .update(twoFactorRecoveryTable)
          .set({ usedAt: new Date() })
          .where(and(eq(twoFactorRecoveryTable.id, recovery.id), isNull(twoFactorRecoveryTable.usedAt)))
          .returning({ id: twoFactorRecoveryTable.id });
        if (!usedRecovery) throw new TwoFactorChallengeConflict();
      }

      if (totpStep !== null) {
        const [usedStep] = await tx
          .update(usersTable)
          .set({ twoFactorLastUsedStep: totpStep })
          .where(
            and(
              eq(usersTable.id, challenge.userId),
              or(
                isNull(usersTable.twoFactorLastUsedStep),
                lt(usersTable.twoFactorLastUsedStep, totpStep),
              ),
            ),
          )
          .returning({ id: usersTable.id });
        if (!usedStep) throw new TwoFactorChallengeConflict();
      }

      const [account] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, challenge.userId))
        .limit(1);
      if (!account) throw new Error("Two-factor user no longer exists.");

      await tx.insert(sessionsTable).values({
        userId: account.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      });
      return account;
    });
    setSessionCookie(res, sessionToken);
    res.json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof TwoFactorChallengeConflict) {
      res.status(409).json({ error: "This challenge or recovery code was already used. Sign in again." });
      return;
    }
    throw error;
  }
});

router.post("/auth/2fa/telegram/webhook", async (req, res) => {
  const expectedSecret = telegramWebhookSecret();
  const receivedSecret = req.get("x-telegram-bot-api-secret-token") ?? "";
  if (!matchesTelegramWebhookSecret(expectedSecret, receivedSecret)) {
    res.status(403).json({ error: "Invalid Telegram webhook secret." });
    return;
  }

  const message = isRecord(req.body) && isRecord(req.body.message) ? req.body.message : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const chatIdValue = chat?.id;
  const nonce = telegramBindNonceFromMessage(chat?.type, message?.text);
  const validChatId =
    (typeof chatIdValue === "number" &&
      Number.isSafeInteger(chatIdValue) &&
      chatIdValue > 0) ||
    (typeof chatIdValue === "string" &&
      /^[1-9]\d{0,19}$/.test(chatIdValue));
  if (
    !nonce ||
    !validChatId
  ) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = String(chatIdValue);
  const [user] = await db
    .select({
      id: usersTable.id,
      secret: usersTable.twoFactorSecret,
      pendingNonce: usersTable.twoFactorPendingNonce,
      pendingExpiresAt: usersTable.twoFactorPendingExpiresAt,
      enabled: usersTable.twoFactorEnabled,
    })
    .from(usersTable)
    .where(eq(usersTable.twoFactorPendingNonce, nonce))
    .limit(1);
  if (
    !user?.secret ||
    !isActiveTelegramBindNonce({
      candidate: nonce,
      pendingNonce: user.pendingNonce,
      pendingExpiresAt: user.pendingExpiresAt,
      enabled: user.enabled,
    })
  ) {
    res.status(200).json({ ok: true });
    return;
  }
  const code = totp(decryptSecret(user.secret));
  let updated: { id: string } | undefined;
  try {
    const [bound] = await db.transaction(async (tx) => {
      const now = new Date();
      const [claimed] = await tx
        .update(usersTable)
        .set({
          twoFactorTelegramId: chatId,
          twoFactorPendingNonce: null,
          twoFactorPendingExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(usersTable.id, user.id),
            eq(usersTable.twoFactorPendingNonce, nonce),
            eq(usersTable.twoFactorEnabled, false),
            gt(usersTable.twoFactorPendingExpiresAt, now),
          ),
        )
        .returning({ id: usersTable.id });
      if (!claimed) return [];

      await tx
        .insert(telegramOutboxTable)
        .values({
          chatId,
          encryptedText: encryptSecret(`EDUVERSE Telegram connected. Setup code: <code>${code}</code>`),
          deduplicationKey: `bind:${user.id}:${hashSessionToken(nonce)}`,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .onConflictDoNothing({
          target: telegramOutboxTable.deduplicationKey,
        });
      return [claimed];
    });
    updated = bound;
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }
  if (!updated) {
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* QR device-confirmation sign-in (Steam-Guard style)                          */
/* -------------------------------------------------------------------------- */

const QR_TTL_MS = 3 * 60 * 1000;
const qrPollLimiter = createRateLimiter(10000, 15 * 60 * 1000, "Too many QR checks.");
const qrStartLimiter = createRateLimiter(500, 15 * 60 * 1000, "Too many QR sign-in starts.");

function randomCode(): string {
  // 8-character human-friendly code; ambiguous characters removed.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

type QrStatus = "pending" | "scanned" | "approved" | "consumed" | "expired" | "denied";

function effectiveStatus(row: {
  status: QrStatus;
  expiresAt: Date;
}): QrStatus {
  if (row.status === "pending" || row.status === "scanned") {
    return row.expiresAt.getTime() <= Date.now() ? "expired" : row.status;
  }
  return row.status;
}

/**
 * Step 1 — a device that is NOT signed in asks for a challenge. It receives a
 * device token (kept in memory only on that device) plus a code / QR payload to
 * display. Nothing that can be replayed is stored in plain text.
 */
router.post("/auth/qr/start", requireAllowedOrigin, qrStartLimiter, async (req, res) => {
  if (!hasOnlyFields(req.body, ["deviceLabel"])) {
    res.status(400).json({ error: "Unexpected QR request fields." });
    return;
  }
  const deviceLabel = getString(req.body, "deviceLabel")?.trim().slice(0, 80) ?? "";
  const deviceToken = createSessionToken();
  const approveToken = createSessionToken();
  const code = randomCode();
  const expiresAt = new Date(Date.now() + QR_TTL_MS);

  await db.insert(qrLoginSessionsTable).values({
    deviceTokenHash: hashSessionToken(deviceToken),
    approveTokenHash: hashSessionToken(approveToken),
    code: hashSessionToken(code).slice(0, 12),
    status: "pending",
    deviceLabel,
    expiresAt,
  });

  res.status(201).json({
    deviceToken,
    code,
    expiresAt: expiresAt.toISOString(),
    // The signed-in phone scans this URL; it deep-links to the approval screen.
    approveUrl: `/login?qr=${encodeURIComponent(code)}`,
  });
});

/**
 * Step 2 — the requesting device polls for its challenge status. Once approved
 * it calls /consume.
 */
router.get("/auth/qr/status", qrPollLimiter, async (req, res) => {
  const deviceToken = typeof req.query.deviceToken === "string" ? req.query.deviceToken : "";
  if (!deviceToken || deviceToken.length > 128) {
    res.status(400).json({ error: "A device token is required." });
    return;
  }
  const [row] = await db
    .select()
    .from(qrLoginSessionsTable)
    .where(eq(qrLoginSessionsTable.deviceTokenHash, hashSessionToken(deviceToken)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "QR request not found." });
    return;
  }
  res.json({
    status: effectiveStatus({ status: row.status as QrStatus, expiresAt: row.expiresAt }),
    expiresAt: row.expiresAt.toISOString(),
  });
});

/**
 * Step 3 — an already signed-in device approves the challenge by code. This is
 * the "scan from my phone" action: the phone is authenticated, the new device
 * is not.
 */
router.post(
  "/auth/qr/approve",
  requireAllowedOrigin,
  async (req, res) => {
    const token = readSessionToken(req);
    if (!token) {
      res.status(401).json({ error: "Sign in on this device before approving a QR request." });
      return;
    }
    if (!hasOnlyFields(req.body, ["code"])) {
      res.status(400).json({ error: "Unexpected QR approval fields." });
      return;
    }
    const [approver] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(sessionsTable.tokenHash, hashSessionToken(token)),
          isNull(sessionsTable.revokedAt),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!approver) {
      res.status(401).json({ error: "Sign in on this device before approving a QR request." });
      return;
    }
    const code = getString(req.body, "code")?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
      res.status(400).json({ error: "Enter the code shown on the other device." });
      return;
    }
    const [row] = await db
      .select()
      .from(qrLoginSessionsTable)
      .where(eq(qrLoginSessionsTable.code, hashSessionToken(code).slice(0, 12)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "That code is not valid." });
      return;
    }
    const status = effectiveStatus({ status: row.status as QrStatus, expiresAt: row.expiresAt });
    if (status === "expired") {
      res.status(410).json({ error: "This QR request has expired. Ask for a new one." });
      return;
    }
    if (status === "consumed") {
      res.status(409).json({ error: "This QR request was already used." });
      return;
    }

    const sessionToken = createSessionToken();
    await db
      .update(qrLoginSessionsTable)
      .set({
        status: "approved",
        userId: approver.id,
        approvedBy: approver.id,
        issuedSessionToken: hashSessionToken(sessionToken),
      })
      .where(eq(qrLoginSessionsTable.id, row.id));

    res.json({ approved: true, expiresAt: row.expiresAt.toISOString() });
  },
);

/**
 * Step 4 — the requesting device exchanges its device token for the session the
 * approving device minted. The intermediate token is stored only as a digest.
 */
router.post("/auth/qr/consume", requireAllowedOrigin, async (req, res) => {
  if (!hasOnlyFields(req.body, ["deviceToken"])) {
    res.status(400).json({ error: "Unexpected QR consume fields." });
    return;
  }
  const deviceToken = getString(req.body, "deviceToken");
  if (!deviceToken || deviceToken.length > 128) {
    res.status(400).json({ error: "A device token is required." });
    return;
  }
  const [row] = await db
    .select()
    .from(qrLoginSessionsTable)
    .where(eq(qrLoginSessionsTable.deviceTokenHash, hashSessionToken(deviceToken)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "QR request not found." });
    return;
  }
  const status = effectiveStatus({ status: row.status as QrStatus, expiresAt: row.expiresAt });
  if (status !== "approved" || !row.userId || !row.issuedSessionToken) {
    res.status(409).json({ error: status === "expired" ? "This QR request has expired." : "This QR request has not been approved yet." });
    return;
  }

  // Re-mint a fresh session so the intermediate digest is never the cookie.
  const freshToken = createSessionToken();
  const [account] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, row.userId))
    .limit(1);
  if (!account) {
    res.status(404).json({ error: "The approving account no longer exists." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(sessionsTable).values({
      userId: account.id,
      tokenHash: hashSessionToken(freshToken),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    });
    await tx
      .update(qrLoginSessionsTable)
      .set({ status: "consumed", consumedAt: new Date(), issuedSessionToken: null })
      .where(eq(qrLoginSessionsTable.id, row.id));
  });

  setSessionCookie(res, freshToken);
  res.json({ user: publicUser(account) });
});

export default router;
