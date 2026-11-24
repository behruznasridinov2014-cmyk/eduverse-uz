import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import learningRouter from "./learning";
import lessonRoomsRouter from "./lesson-rooms";
import schoolsRouter from "./schools";
import schoolToolsRouter from "./school-tools";
import courseRouter from "./course";
import accountRouter from "./account";
import requestsRouter from "./requests";
import demoRouter from "./demo";
import timetableRouter from "./timetable";
import journalRouter from "./journal";
import aiToolsRouter from "./ai-tools";
import lessonsRouter from "./lessons";
import ecosystemRouter from "./ecosystem";
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
router.use(schoolToolsRouter);
router.use(courseRouter);
router.use(accountRouter);
router.use(requestsRouter);
router.use(demoRouter);
router.use(timetableRouter);
router.use(journalRouter);
router.use(aiToolsRouter);
router.use(lessonsRouter);
router.use(ecosystemRouter);
router.use(authRouter);
router.use(learningRouter);
router.use(lessonRoomsRouter);
router.use(schoolsRouter);

export default router;
