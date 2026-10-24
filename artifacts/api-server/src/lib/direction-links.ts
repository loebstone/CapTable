import { db, directionTemplates, directionTokens, directionTokenEvents, directionResets } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { hash, randomToken } from "./auth";
import { append, type Tx } from "./records";
import { requireLedgerYear, yearDetail } from "./distribution-years";
import { DIRECTION_TEXT, DIRECTION_VERSION } from "./direction-rules";
import { HttpError } from "./errors";

export async function ensureDirectionTemplate(tx: Tx, actor: string) {
  const [existing] = await tx.select().from(directionTemplates).where(eq(directionTemplates.version, DIRECTION_VERSION));
  if (existing) {
    if (existing.text !== DIRECTION_TEXT) throw new HttpError(409, "Direction wording changed without a new template version");
    return existing;
  }
  return append(tx, actor, directionTemplates, { version: DIRECTION_VERSION, text: DIRECTION_TEXT }, "DIRECTION_TEMPLATE_CREATED");
}
export async function directionCutoff(tx: Tx | typeof db, yearId: number) {
  return (await tx.select().from(directionResets).where(eq(directionResets.yearId, yearId)).orderBy(desc(directionResets.id)).limit(1))[0];
}
export async function tokenState(tx: Tx | typeof db, token: typeof directionTokens.$inferSelect) {
  const reset = await directionCutoff(tx, token.yearId);
  if (reset && token.id <= reset.lastTokenId) return "voided";
  const events = await tx.select().from(directionTokenEvents).where(eq(directionTokenEvents.tokenId, token.id));
  if (events.some((e) => e.kind === "voided")) return "voided";
  if (events.some((e) => e.kind === "spent" || e.kind === "continued")) return "spent";
  if (Date.parse(token.expiresAt) <= Date.now()) return "expired";
  return "ready";
}
export async function issueSigningToken(tx: Tx, actor: string, yearId: number, personId: string, email: string, origin: string) {
  await requireLedgerYear(tx, yearId);
  const detail = await yearDetail(tx, yearId);
  const holder = detail.holders.find((h) => h.personId === personId);
  if (!holder) throw new HttpError(404, "Holder is not in this year's snapshot");
  if (!detail.declarationDate || holder.nominalCents === null) throw new HttpError(409, "Set a distribution amount and approval date before issuing signing links.");
  const template = await ensureDirectionTemplate(tx, actor);
  const prior = await tx.select().from(directionTokens).where(and(eq(directionTokens.yearId, yearId), eq(directionTokens.personId, personId)));
  for (const token of prior) {
    const events = await tx.select().from(directionTokenEvents).where(eq(directionTokenEvents.tokenId, token.id));
    if (!events.some((e) => e.kind === "voided" || e.kind === "spent")) {
      await append(tx, actor, directionTokenEvents, { tokenId: token.id, kind: "voided", createdBy: actor }, "DIRECTION_LINK_VOIDED");
    }
  }
  const raw = randomToken(), expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const row = await append(tx, actor, directionTokens, {
    yearId, personId, email, tokenHash: hash(raw), expiresAt, templateId: template.id,
    context: { holderName: holder.displayName, calendarYear: detail.calendarYear, boardApprovalDate: detail.declarationDate,
      maxAmountCents: holder.nominalCents, suggestedAmountCents: BigInt(holder.surplusCents ?? "0") > 0n ? holder.surplusCents! : "0", isPractice: detail.isPractice },
    createdBy: actor,
  }, "DIRECTION_LINK_ISSUED");
  return { token: row, url: `${origin}/api/signing/open?token=${raw}` };
}
export function signingLinkText(body: string, url: string) {
  return `${body}\n\nSign your Tax & Reinvestment Document:\n${url}`;
}
