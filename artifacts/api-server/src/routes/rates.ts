import { Router, type IRouter } from "express";
import { db, rateTables, stateRates } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListRatesResponse, SaveRatesBody, SaveRatesResponse, CopyRatesBody, CopyRatesResponse,
} from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { append, write, type Tx } from "../lib/records";
import { currentRates, allCurrentRates } from "../lib/rate-data";
import { assertAccess } from "../lib/access";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
type RateData = typeof SaveRatesBody._output;
async function fullTable(row: typeof rateTables.$inferSelect, database: Tx | typeof db = db) {
  const states = await database.select({
    stateCode: stateRates.stateCode, rate: stateRates.rate, sourceNote: stateRates.sourceNote,
  }).from(stateRates).where(eq(stateRates.tableId, row.id)).orderBy(stateRates.stateCode);
  return { ...row, states };
}
async function appendRates(tx: Tx, actor: string, data: RateData) {
  if (new Set(data.states.map((s) => s.stateCode)).size !== data.states.length) throw new HttpError(400, "Use only one row per state code");
  if (data.states.some((s) => s.stateCode === "NONE" && s.rate !== "0.0000")) throw new HttpError(400, "NONE must have a zero rate");
  const { states, ...annual } = data;
  const row = await append(tx, actor, rateTables, { ...annual, createdBy: actor });
  for (const state of states) await append(tx, actor, stateRates, { tableId: row.id, ...state });
  return fullTable(row, tx);
}
router.get("/rates", async (_req, res): Promise<void> => {
  const full = await db.transaction((tx) => allCurrentRates(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(ListRatesResponse.parse(full));
});
router.post("/rates", async (req, res): Promise<void> => {
  const data = SaveRatesBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    return appendRates(tx, actor, data);
  });
  res.status(201).json(SaveRatesResponse.parse(result));
});
router.post("/rates/copy", async (req, res): Promise<void> => {
  const data = CopyRatesBody.parse(req.body);
  if (data.toYear <= data.fromYear) throw new HttpError(400, "Copy to a later tax year");
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const exists = await currentRates(tx, data.toYear);
    if (exists) throw new HttpError(409, "Destination tax year already exists; record a correction instead");
    const previous = await currentRates(tx, data.fromYear);
    if (!previous) throw new HttpError(404, "Prior-year rate table not found");
    const full = previous;
    return appendRates(tx, actor, {
      taxYear: data.toYear, federalRate: full.federalRate, federalSourceNote: full.federalSourceNote,
      states: full.states, note: data.note,
    });
  });
  res.status(201).json(CopyRatesResponse.parse(result));
});
export default router;
