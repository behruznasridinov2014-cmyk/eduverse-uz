import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { databaseIsConfigured } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    database: databaseIsConfigured() ? "configured" : "missing",
  });
});

export default router;
