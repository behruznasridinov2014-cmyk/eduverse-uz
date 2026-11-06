import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const listenOptions = process.env.HOST
  ? { port, host: process.env.HOST }
  : { port };

app.listen(listenOptions, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
