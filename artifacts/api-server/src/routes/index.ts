import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import holdingsRouter from "./holdings";
import residencesRouter from "./residences";
import ratesRouter from "./rates";
import accessRouter from "./access";
import auditRouter from "./audit";
import { requireAccess } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Every business endpoint and unknown API route is behind the same server gate.
router.use(requireAccess);
router.use(holdingsRouter);
router.use(residencesRouter);
router.use(ratesRouter);
router.use(accessRouter);
router.use(auditRouter);
router.use((_req, res) => { res.status(404).json({ error: "API route not found" }); });

export default router;
