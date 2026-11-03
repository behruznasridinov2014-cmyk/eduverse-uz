import { Router, type IRouter } from "express";
import authRouter from "./auth";
import guardRouter from "./guard";
import healthRouter from "./health";
import schoolsRouter from "./schools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(guardRouter);
router.use(schoolsRouter);

export default router;
