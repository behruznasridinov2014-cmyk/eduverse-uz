import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import learningRouter from "./learning";
import lessonRoomsRouter from "./lesson-rooms";
import schoolsRouter from "./schools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(learningRouter);
router.use(lessonRoomsRouter);
router.use(schoolsRouter);

export default router;
