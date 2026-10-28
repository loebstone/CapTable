import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import holdingsRouter from "./holdings";
import residencesRouter from "./residences";
import ratesRouter from "./rates";
import rateCsvRouter from "./rate-csv";
import accessRouter from "./access";
import auditRouter from "./audit";
import yearsRouter from "./years";
import paymentsRouter from "./payments";
import yearDocumentsRouter from "./year-documents";
import reportsRouter from "./reports";
import backupRouter from "./backup";
import mailingsRouter from "./mailings";
import directionsRouter from "./directions";
import directionsPublicRouter from "./directions-public";
import { requireAccess, requireFreshAction } from "../lib/auth";
import ssoRouter from "./sso";
import suiteMenuRouter from "./suite-menu";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ssoRouter);
// Deliberate public signing exception: only hashed link/restricted-signing
// cookies authorize these routes, never a management session or arbitrary IDs.
router.use(directionsPublicRouter);
// Every business endpoint and unknown API route is behind the same server gate.
router.use(requireAccess);
router.use(suiteMenuRouter);
// Freshness is evaluated before validation, uploads, ledger writes or provider
// calls. These are management routes only; public signing remains independent.
router.use((req, res, next) => {
  const sensitive = req.method === "POST" && (
    /^\/years\/[^/]+\/(payments|reversals|holds|reset-practice)$/.test(req.path) ||
    /^\/years\/[^/]+\/directions\/(issue|resend|remind|paper)$/.test(req.path) ||
    /^\/years\/[^/]+\/directions\/[^/]+\/confirm$/.test(req.path) ||
    /^\/years\/[^/]+\/mailing\/send$/.test(req.path)
  );
  if (sensitive) requireFreshAction(req, res, next); else next();
});
router.use(holdingsRouter);
router.use(residencesRouter);
router.use(ratesRouter);
router.use(rateCsvRouter);
router.use(accessRouter);
router.use(auditRouter);
router.use(yearsRouter);
router.use(paymentsRouter);
router.use(yearDocumentsRouter);
router.use(reportsRouter);
router.use(backupRouter);
router.use(mailingsRouter);
router.use(directionsRouter);
router.use((_req, res) => { res.status(404).json({ error: "API route not found" }); });

export default router;
