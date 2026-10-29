import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { BUILD_ID } from "../lib/build";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok", build: BUILD_ID });
  res.json(data);
});

export default router;
