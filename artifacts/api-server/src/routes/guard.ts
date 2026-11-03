import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { ACCOUNT_ROLES, db } from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth-crypto";
import { logger } from "../lib/logger";
import {
  createRateLimiter,
  getAuthSecurityConfiguration,
  requireAllowedOrigin,
  requireAuthenticatedRole,
} from "./auth";

type CheckStatus = "pass" | "warning" | "missing" | "unavailable";
type CheckId =
  | "api"
  | "database"
  | "session"
  | "password_hashing"
  | "cookie"
  | "login_rate_limit"
  | "multi_factor"
  | "password_recovery"
  | "school_data";

type GuardCheck = {
  id: CheckId;
  status: CheckStatus;
};

const localModelName = process.env.EDUVERSE_LOCAL_AI_MODEL?.trim();
const localAiEndpoint = "http://127.0.0.1:11434/api/chat";
const guardRateLimit = createRateLimiter(
  5,
  60_000,
  "Too many Guard checks. Try again in a minute.",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createReport(checks: GuardCheck[]) {
  const counts = checks.reduce(
    (result, check) => {
      result[check.status] += 1;
      return result;
    },
    { pass: 0, warning: 0, missing: 0, unavailable: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    checks,
    counts,
  };
}

async function runGuardChecks(): Promise<ReturnType<typeof createReport>> {
  const checks: GuardCheck[] = [
    { id: "api", status: "pass" },
    { id: "session", status: "pass" },
  ];

  try {
    await db.execute(sql`select 1`);
    checks.push({ id: "database", status: "pass" });
  } catch (error) {
    logger.error({ err: error }, "EDUVERSE Guard database check failed");
    checks.push({ id: "database", status: "unavailable" });
  }

  try {
    const probePassword = randomBytes(32).toString("base64url");
    const probeHash = await hashPassword(probePassword);
    const validHash = await verifyPassword(probePassword, probeHash);
    checks.push({
      id: "password_hashing",
      status: validHash ? "pass" : "unavailable",
    });
  } catch (error) {
    logger.error({ err: error }, "EDUVERSE Guard password hash check failed");
    checks.push({ id: "password_hashing", status: "unavailable" });
  }

  const authConfiguration = getAuthSecurityConfiguration();
  const cookieIsSafe =
    authConfiguration.sessionCookieHttpOnly &&
    authConfiguration.sessionCookieSameSite === "lax" &&
    (!authConfiguration.production || authConfiguration.sessionCookieSecure);
  checks.push({
    id: "cookie",
    status: cookieIsSafe
      ? authConfiguration.production
        ? "pass"
        : "warning"
      : "unavailable",
  });
  checks.push({
    id: "login_rate_limit",
    status: !authConfiguration.loginRateLimitEnabled
      ? "missing"
      : authConfiguration.loginRateLimitScope === "process-local"
        ? "warning"
        : "pass",
  });
  checks.push({ id: "multi_factor", status: "missing" });
  checks.push({ id: "password_recovery", status: "missing" });

  try {
    const result = await db.execute(sql`select to_regclass('public.schools') as schools, to_regclass('public.school_members') as school_members, to_regclass('public.school_classes') as school_classes`);
    const row = result.rows[0] as { schools?: string | null; school_members?: string | null; school_classes?: string | null } | undefined;
    const ready = Boolean(row?.schools && row.school_members && row.school_classes);
    checks.push({ id: "school_data", status: ready ? "pass" : "missing" });
  } catch (error) {
    logger.error({ err: error }, "EDUVERSE Guard school data check failed");
    checks.push({ id: "school_data", status: "unavailable" });
  }

  return createReport(checks);
}

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get(
  "/guard/check",
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  guardRateLimit,
  async (_req, res) => {
    const report = await runGuardChecks();
    res.json(report);
  },
);

router.post(
  "/guard/analyze",
  requireAllowedOrigin,
  requireAuthenticatedRole(...ACCOUNT_ROLES),
  guardRateLimit,
  async (req, res) => {
    const language = isRecord(req.body) ? req.body.language : undefined;
    if (
      !isRecord(req.body) ||
      Object.keys(req.body).some((key) => key !== "language") ||
      !["Uzbek", "Русский", "English"].includes(String(language))
    ) {
      res.status(400).json({ error: "Select a supported report language." });
      return;
    }

    if (!localModelName) {
      res.status(503).json({
        error:
          "Local AI is not configured. Set EDUVERSE_LOCAL_AI_MODEL to a model already installed in Ollama.",
        code: "LOCAL_AI_NOT_CONFIGURED",
      });
      return;
    }

    const report = await runGuardChecks();
    let response: globalThis.Response;
    try {
      response = await fetch(localAiEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model: localModelName,
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "You are EDUVERSE Guard, a defensive security status explainer. Explain only the supplied check IDs and statuses. Do not claim a control exists unless its status is pass. Distinguish warnings and missing controls, give short safe next steps, and state that this is not a penetration test. Never request passwords, tokens, source code, or personal data. Reply in the requested language.",
            },
            {
              role: "user",
              content: JSON.stringify({ language, report }),
            },
          ],
          options: { temperature: 0.1, num_predict: 350 },
        }),
      });
    } catch (error) {
      logger.warn(
        { err: error },
        "EDUVERSE Guard could not reach the local Ollama service",
      );
      res.status(503).json({
        error:
          "The local AI model could not be reached at 127.0.0.1:11434. Start Ollama and try again.",
        code: "LOCAL_AI_UNAVAILABLE",
      });
      return;
    }

    if (!response.ok) {
      logger.warn(
        { statusCode: response.status },
        "EDUVERSE Guard local AI returned an error",
      );
      res.status(503).json({
        error:
          "The local AI model returned an error. Check that the selected Ollama model is installed.",
        code: "LOCAL_AI_ERROR",
      });
      return;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      logger.warn(
        { err: error },
        "EDUVERSE Guard received invalid local AI output",
      );
      res.status(502).json({
        error: "The local AI returned an unreadable response.",
        code: "LOCAL_AI_INVALID_RESPONSE",
      });
      return;
    }

    const message = isRecord(payload) ? payload.message : undefined;
    const analysis =
      isRecord(message) && typeof message.content === "string"
        ? message.content.trim().slice(0, 8_000)
        : "";
    if (!analysis) {
      res.status(502).json({
        error: "The local AI returned an empty response.",
        code: "LOCAL_AI_EMPTY_RESPONSE",
      });
      return;
    }

    res.json({ analysis, model: localModelName, report });
  },
);

export default router;
