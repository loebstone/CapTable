import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db, signedDirections, yearDocuments } from "@workspace/db";
import { currentIdentity } from "../lib/auth";
import { publicOrigin } from "../lib/origin";
import { authLimit } from "../lib/auth-limits";
import { directionView, confirmSignedDirection, recordPaperDirection } from "../lib/directions";
import { dispatchDirection, remindUnsigned } from "../lib/direction-dispatch";
import { directionCutoff } from "../lib/direction-links";
import { yearDocumentStore } from "../lib/year-document-store";
import { HttpError } from "../lib/errors";
import { mailingView } from "../lib/mailings";
import { printPaperDirections } from "../lib/mailing-paper";
import { resendHolderEnvelope } from "../lib/mailing-send";

const id = z.coerce.number().int().positive(), router: IRouter = Router();
router.get("/years/:id/directions", async (req, res): Promise<void> => { res.json(await directionView(id.parse(req.params.id))); });
router.get("/years/:id/directions/paper.pdf", async (req, res): Promise<void> => {
  const yearId = id.parse(req.params.id), view = await mailingView(yearId);
  const bytes = await printPaperDirections(yearId, view);
  res.setHeader("Content-Disposition", `attachment; filename="HWD_${view.calendarYear}_${view.isPractice ? "Practice_" : ""}Paper_Tax_Reinvestment.pdf"`);
  res.type("application/pdf").send(bytes);
});
router.post("/years/:id/directions/issue", async (req, res): Promise<void> => {
  const identity = currentIdentity(req);
  authLimit(`direction-issue:${identity.personId}`, 15);
  const data = z.object({ personId: z.string().min(1) }).parse(req.body);
  res.json(await dispatchDirection(identity, id.parse(req.params.id), data.personId, publicOrigin(req)));
});
router.post("/years/:id/directions/resend", async (req, res): Promise<void> => {
  const identity = currentIdentity(req);
  authLimit(`direction-envelope-resend:${identity.personId}`, 15, "Too many resends; please wait a minute.");
  const data = z.object({ personId: z.string().min(1) }).strict().parse(req.body);
  res.json(await resendHolderEnvelope(identity, id.parse(req.params.id), data.personId, publicOrigin(req)));
});
router.post("/years/:id/directions/remind", async (req, res): Promise<void> => {
  const identity = currentIdentity(req);
  authLimit(`direction-remind:${identity.personId}`, 2);
  res.json(await remindUnsigned(identity, id.parse(req.params.id), publicOrigin(req)));
});
router.post("/years/:id/directions/:directionId/confirm", async (req, res): Promise<void> => {
  const data = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
  res.json(await confirmSignedDirection(currentIdentity(req).personId, id.parse(req.params.id), id.parse(req.params.directionId), data.note));
});
router.post("/years/:id/directions/paper", async (req, res): Promise<void> => {
  res.json(await recordPaperDirection(currentIdentity(req).personId, id.parse(req.params.id), req.body));
});
router.get("/years/:id/directions/:directionId/pdf", async (req, res): Promise<void> => {
  const yearId = id.parse(req.params.id), directionId = id.parse(req.params.directionId);
  const [direction] = await db.select().from(signedDirections).where(and(eq(signedDirections.id, directionId), eq(signedDirections.yearId, yearId)));
  const reset = await directionCutoff(db, yearId);
  if (!direction || direction.id <= (reset?.lastDirectionId ?? 0) || !direction.documentId) throw new HttpError(404, "No signed PDF or paper scan is available");
  const [doc] = await db.select().from(yearDocuments).where(and(eq(yearDocuments.id, direction.documentId), eq(yearDocuments.yearId, yearId)));
  if (!doc) throw new HttpError(404, "Document not found");
  const file = await yearDocumentStore.getFile(doc.objectPath);
  res.setHeader("Content-Type", doc.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/[^A-Za-z0-9_.-]/g, "_")}"`);
  file.createReadStream().on("error", () => res.destroy()).pipe(res);
});
export default router;
