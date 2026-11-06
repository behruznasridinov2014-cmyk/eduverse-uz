/**
 * Vercel serverless entry-point. The default export is an Express app that
 * Vercel's Node runtime invokes as a `(req, res)` handler. Local development
 * and self-hosting use `src/index.ts` (a long-lived listener) instead.
 */
import app from "./app";

export default app;
