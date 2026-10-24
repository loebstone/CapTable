import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, mailSettings, paperPreferences, mailingDrafts, mailingBatches } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { append, write } from "../lib/records";
import { draftInput, emailInput } from "../lib/mailing-rules";
import { publicOrigin } from "../lib/origin";
import { mailingView, replyToSetting, validateMailDocuments } from "../lib/mailings";
import { sendMailing } from "../lib/mailing-send";
import { requireYear } from "../lib/distribution-years";
import { HttpError } from "../lib/errors";
import { printPaperLetters } from "../lib/mailing-paper";

const router: IRouter = Router();
const idInput = z.coerce.number().int().positive();
router.get("/mail/settings", async (_req, res): Promise<void> => { res.json({ replyTo: await replyToSetting() }); });
router.post("/mail/settings", async (req, res): Promise<void> => {
  const replyTo = emailInput.parse(req.body.replyTo);
  await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    await append(tx, actor, mailSettings, { replyTo, createdBy: actor }, "MAILING_REPLY_TO_CHANGED");
  });
  res.json({ replyTo });
});
router.post("/mail/paper", async (req, res): Promise<void> => {
  const data = z.object({ personId: z.string().min(1).max(200), prefersPaper: z.boolean() }).parse(req.body);
  await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    await append(tx, actor, paperPreferences, { ...data, createdBy: actor }, "PREFERS_PAPER_CHANGED");
  });
  res.json({ message: "Paper preference saved" });
});
router.get("/years/:id/mailing", async (req, res): Promise<void> => { res.json(await mailingView(idInput.parse(req.params.id))); });
router.post("/years/:id/mailing", async (req, res): Promise<void> => {
  const id = idInput.parse(req.params.id), data = draftInput.parse(req.body);
  const view = await mailingView(id);
  for (const personId of Object.keys(data.choices)) if (!view.recipients.some((r) => r.personId === personId)) throw new HttpError(400, "Attachment choice names someone outside this snapshot");
  await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); const year = await requireYear(tx, id);
    const sent = await tx.select().from(mailingBatches).where(and(eq(mailingBatches.yearId, id), ne(mailingBatches.kind, "preview")));
    if (!year.isPractice && sent.length) throw new HttpError(409, "Sent mailings cannot be edited");
    await validateMailDocuments(id, data);
    await append(tx, actor, mailingDrafts, { yearId: id, content: data, createdBy: actor }, "MAILING_DRAFT_SAVED");
  });
  res.json({ message: "Mailing draft saved" });
});
router.post("/years/:id/mailing/send", async (req, res): Promise<void> => {
  res.json(await sendMailing(currentIdentity(req), idInput.parse(req.params.id), req.body, publicOrigin(req)));
});
router.get("/years/:id/mailing/paper.pdf", async (req, res): Promise<void> => {
  const id = idInput.parse(req.params.id), view = await mailingView(id);
  const bytes = await printPaperLetters(id, view);
  await assertAccess(currentIdentity(req).personId);
  res.type("application/pdf").attachment(`HWD_${view.isPractice ? "Practice_" : ""}Paper_Letters_${id}.pdf`).send(bytes);
});
export default router;
