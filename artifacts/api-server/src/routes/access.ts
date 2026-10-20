import { Router, type IRouter } from "express";
import { accessEntries } from "@workspace/db";
import { AddAccessBody, AddAccessResponse, RemoveAccessBody, RemoveAccessResponse, ListAccessResponse } from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { effectiveAccess, activeEntry, assertAccess } from "../lib/access";
import { signInCheck } from "../lib/roster";
import { append, write } from "../lib/records";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.get("/access", async (_req, res): Promise<void> => {
  res.json(ListAccessResponse.parse(await effectiveAccess()));
});
router.post("/access", async (req, res): Promise<void> => {
  const data = AddAccessBody.parse(req.body);
  const person = await signInCheck(data.email.trim().toLowerCase());
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    if (await activeEntry(person.personId, tx)) throw new HttpError(409, "This person already has access");
    return append(tx, actor, accessEntries, { ...person, addedBy: actor, note: data.note });
  });
  res.status(201).json(AddAccessResponse.parse(result));
});
router.post("/access/remove", async (req, res): Promise<void> => {
  const data = RemoveAccessBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const entry = await activeEntry(data.personId, tx);
    if (!entry) throw new HttpError(404, "Active access entry not found");
    const active = (await effectiveAccess(tx)).filter((e) => !e.removedAt);
    if (active.length <= 1) throw new HttpError(409, "Cannot remove the last remaining person");
    return append(tx, actor, accessEntries, {
      personId: entry.personId, displayName: entry.displayName, addedBy: entry.addedBy,
      addedAt: entry.addedAt, removedAt: new Date().toISOString(), note: data.note,
    });
  });
  res.status(201).json(RemoveAccessResponse.parse(result));
});
export default router;
