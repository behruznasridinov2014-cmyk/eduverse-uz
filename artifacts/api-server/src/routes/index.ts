import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import learningRouter from "./learning";
import lessonRoomsRouter from "./lesson-rooms";
import schoolsRouter from "./schools";
import { ensureSchema } from "../lib/schema-sync";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(async (_req, _res, next) => {
  try {
    await ensureSchema();
  } catch (error) {
    // Never block a request because the sync failed; the next one retries.
    logger.error({ err: error }, "database schema sync failed");
  }
  next();
});
router.use(authRouter);
router.use(learningRouter);
router.use(lessonRoomsRouter);
router.use(schoolsRouter);

export default router;
