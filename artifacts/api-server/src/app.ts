import cookieParser from "cookie-parser";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1" || process.env.VERCEL === "1") app.set("trust proxy", 1);
const configuredOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
// A wildcard really means "any origin" — otherwise an operator who sets
// CORS_ORIGINS=* silently ends up with a same-origin-only API.
const allowAnyOrigin = configuredOrigins.has("*");

/**
 * Security headers for every API response.
 */
const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
};

app.use(securityHeaders);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAnyOrigin || configuredOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: !allowAnyOrigin,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
// The API only speaks JSON — a form body parser is not needed and widens the
// attack surface.
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

/**
 * Cross-site request forgery protection.
 *
 * The session cookie is "Lax", which blocks cross-site POSTs in current
 * browsers but not requests from a hostile sibling subdomain. Every state
 * changing request therefore has to come from the same origin (or from an
 * explicitly allowed one).
 */
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const originGuard: RequestHandler = (req, res, next) => {
  if (!unsafeMethods.has(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  const allowed =
    configuredOrigins.has(origin) ||
    (() => {
      try {
        // Behind a proxy (Vercel) the public host is in `x-forwarded-host`.
        const host = req.get("x-forwarded-host") || req.get("host") || "";
        const proto = req.get("x-forwarded-proto") || req.protocol;
        return new URL(origin).origin === `${proto}://${host}`;
      } catch {
        return false;
      }
    })();
  if (!allowed) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
};

app.use("/api", originGuard);
app.use("/api", (_req, res, next) => {
  // Nothing behind the API may be cached by a browser or a proxy.
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "Request body must contain valid JSON." });
    return;
  }

  logger.error({ err: error }, "Unhandled API request error");
  res.status(500).json({ error: "Internal server error." });
};

app.use(errorHandler);

export default app;
