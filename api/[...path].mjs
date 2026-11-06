/**
 * Vercel serverless catch-all for the EDUVERSE-UZ API.
 *
 * The workspace builds the real Express application with esbuild into
 * `artifacts/api-server/dist/vercel.mjs`. This wrapper imports it lazily so a
 * startup failure (e.g. a missing `DATABASE_URL`) produces a useful JSON 500
 * instead of a crashed function.
 */

let handlerPromise = null;

function loadHandler() {
  if (!handlerPromise) {
    handlerPromise = import("../artifacts/api-server/dist/vercel.mjs")
      .then((module) => module.default)
      .catch((error) => error);
  }
  return handlerPromise;
}

export default async function handler(req, res) {
  const app = await loadHandler();

  if (app instanceof Error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error:
          "The API failed to start. Set DATABASE_URL and NODE_ENV=production on your Vercel project, then run `pnpm --filter @workspace/db run push` once against that database. See docs/vercel-deployment.md.",
        detail: app.message,
      }),
    );
    return;
  }

  return app(req, res);
}
