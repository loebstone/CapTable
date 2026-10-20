import { Router, type IRouter } from "express";
import { yearUploads, yearDocuments } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GetYearParams, RequestYearUploadBody, RequestYearUploadResponse, AttachYearDocumentBody,
  AttachYearDocumentResponse, DownloadYearDocumentParams,
} from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { write, append } from "../lib/records";
import { requireYear, requireDocument, documentResponse } from "../lib/distribution-years";
import { yearDocumentStore } from "../lib/year-document-store";
import { HttpError } from "../lib/errors";
import { db } from "@workspace/db";

const router: IRouter = Router();
router.post("/years/:id/documents/uploads", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = RequestYearUploadBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireYear(tx, id);
    const filename = data.filename.replace(/[\r\n\u0000]/g, "").split(/[\\/]/).pop()?.trim();
    if (!filename) throw new HttpError(400, "A filename is required");
    const upload = await yearDocumentStore.requestUpload();
    const row = await append(tx, actor, yearUploads, {
      yearId: id, filename, contentType: data.contentType, size: data.size,
      objectPath: upload.objectPath, createdBy: actor,
    });
    return { uploadId: row.id, uploadURL: upload.uploadURL };
  });
  res.status(201).json(RequestYearUploadResponse.parse(result));
});
router.post("/years/:id/documents", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = AttachYearDocumentBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireYear(tx, id);
    const [upload] = await tx.select().from(yearUploads).where(and(eq(yearUploads.id, data.uploadId), eq(yearUploads.yearId, id))).limit(1);
    if (!upload || upload.createdBy !== actor) throw new HttpError(404, "Your upload reservation for this year was not found");
    const [existing] = await tx.select().from(yearDocuments).where(eq(yearDocuments.uploadId, upload.id)).limit(1);
    if (existing) throw new HttpError(409, "This source document is already attached");
    const objectPath = await yearDocumentStore.seal(upload.objectPath, upload.contentType, upload.size);
    const row = await append(tx, actor, yearDocuments, {
      yearId: id, uploadId: upload.id, objectPath, filename: upload.filename,
      contentType: upload.contentType, size: upload.size, uploadedBy: actor,
    });
    return documentResponse(row);
  });
  res.status(201).json(AttachYearDocumentResponse.parse(result));
});
router.get("/years/:id/documents/:documentId/file", async (req, res): Promise<void> => {
  const { id, documentId } = DownloadYearDocumentParams.parse(req.params);
  const document = await requireDocument(db, id, documentId);
  const file = await yearDocumentStore.getFile(document.objectPath);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", document.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="source-document"; filename*=UTF-8''${encodeURIComponent(document.filename)}`);
  file.createReadStream().on("error", () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); }).pipe(res);
});
export default router;
