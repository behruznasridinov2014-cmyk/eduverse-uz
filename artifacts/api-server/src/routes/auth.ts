import { and, eq, gt, isNull } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import {
  db,
  sessionsTable,
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
  5,
  60 * 60 * 1000,
  "Too many registration attempts.",
);
const loginRateLimiter = createRateLimiter(
  12,
  15 * 60 * 1000,
  "Too many sign-in attempts.",
);

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

export function createRateLimiter(
  limit: number,
  windowMs: number,
  message: string,
): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const maxBuckets = 10_000;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }

      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    buckets.delete(key);
    buckets.set(key, bucket);

    if (bucket.count >= limit) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      );
      res.status(429).json({ error: message });
      return;
    }

    bucket.count += 1;
    next();
  };
}

export function getAuthSecurityConfiguration() {
  return {
    sessionCookieHttpOnly: cookieOptions.httpOnly,
    sessionCookieSameSite: cookieOptions.sameSite,
    sessionCookieSecure: cookieOptions.secure,
    production: isProduction,
    loginRateLimitEnabled: typeof loginRateLimiter === "function",
    loginRateLimitScope: "process-local" as const,
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

export default router;
