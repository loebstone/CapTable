import { Router, type IRouter } from "express";
import { db, auditLog } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListAuditResponse } from "@workspace/api-zod";

const router: IRouter = Router();
router.get("/audit", async (_req, res): Promise<void> => {
  res.json(ListAuditResponse.parse(await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100)));
});
export default router;
