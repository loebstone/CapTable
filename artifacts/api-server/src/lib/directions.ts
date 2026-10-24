import { db, signedDirections, directionConfirmations, directionTokens, directionTokenEvents, distributionEntries, yearDocuments, mailingDrafts } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { append, write, type Tx } from "./records";
import { assertAccess } from "./access";
import { calendarDate, requireLedgerYear, yearDetail } from "./distribution-years";
import { directionCutoff, ensureDirectionTemplate, tokenState } from "./direction-links";
import { assertDirectionAmount, money, paperInput } from "./direction-rules";
import { mailingView, originalMailing } from "./mailings";
import { HttpError } from "./errors";

export async function directionView(yearId: number) {
  const mail = await mailingView(yearId), detail = await yearDetail(db, yearId);
  const cutoff = await directionCutoff(db, yearId);
  const directions = (await db.select().from(signedDirections).where(eq(signedDirections.yearId, yearId)).orderBy(desc(signedDirections.id)))
    .filter((d) => d.id > (cutoff?.lastDirectionId ?? 0));
  const tokens = (await db.select().from(directionTokens).where(eq(directionTokens.yearId, yearId)).orderBy(desc(directionTokens.id)))
    .filter((t) => t.id > (cutoff?.lastTokenId ?? 0));
  const confirmations = await db.select().from(directionConfirmations);
  const resendSource = await originalMailing(yearId, detail.isPractice);
  return { yearId, calendarYear: detail.calendarYear, isPractice: detail.isPractice, rows: await Promise.all(detail.holders.map(async (holder) => {
    const recipient = mail.recipients.find((r) => r.personId === holder.personId)!;
    const direction = directions.find((d) => d.personId === holder.personId);
    const token = tokens.find((t) => t.personId === holder.personId);
    const confirmed = direction && confirmations.some((c) => c.directionId === direction.id);
    const expired = token && (await tokenState(db, token)) === "expired";
    const documentStatus = direction ? direction.kind === "paper" && confirmed ? `Paper ${money(direction.amountCents)}` :
      confirmed ? `Confirmed ${money(direction.amountCents)}` : `Signed ${money(direction.amountCents)} — awaiting confirmation` : expired ? "Link expired" : "Not yet";
    const confirmationBlocked = holder.isOnHold ? "This holder is on hold — remove the hold first." : null;
    const resendBlocked = !resendSource ? (detail.isPractice ? "Send to me first before resending." : "Send the year's mailing first.") :
      holder.nominalCents === null || !detail.declarationDate ? "Set the distribution amount and approval date first." :
      !detail.isPractice && (recipient.prefersPaper || recipient.status === "Complained") ? "Paper preference or complaint prevents email." : null;
    return { personId: holder.personId, displayName: holder.displayName, channel: recipient.channel === "Email" ? "Email" : "Paper",
      email: recipient.email, mailingStatus: recipient.status, documentStatus, instruction: holder.instruction, maxAmountCents: holder.nominalCents,
      resendCount: recipient.resendCount, canResendEnvelope: !resendBlocked, resendBlocked,
      directionId: direction?.id ?? null, amountCents: direction?.amountCents.toString() ?? null,
      canConfirm: !!direction && !confirmed && !confirmationBlocked,
      confirmationBlocked: direction && !confirmed ? confirmationBlocked : null,
      canRemind: documentStatus === "Not yet" && recipient.channel === "Email" && recipient.status !== "Complained",
      canIssue: !!holder.nominalCents && (detail.isPractice || recipient.channel === "Email") && recipient.status !== "Complained",
      pdfUrl: direction?.documentId ? `/api/years/${yearId}/directions/${direction.id}/pdf` : null, expiresAt: token?.expiresAt ?? null,
      history: directions.filter((d) => d.personId === holder.personId).map((d) => ({
        id: d.id, kind: d.kind, amountCents: d.amountCents.toString(), confirmed: confirmations.some((c) => c.directionId === d.id),
        createdAt: d.createdAt, pdfUrl: d.documentId ? `/api/years/${yearId}/directions/${d.id}/pdf` : null,
      })) };
  })) };
}
export async function confirmInTransaction(tx: Tx, actor: string, yearId: number, directionId: number, note = "") {
  await assertAccess(actor, tx); await requireLedgerYear(tx, yearId);
  const [direction] = await tx.select().from(signedDirections).where(and(eq(signedDirections.id, directionId), eq(signedDirections.yearId, yearId)));
  const cutoff = await directionCutoff(tx, yearId);
  if (!direction || direction.id <= (cutoff?.lastDirectionId ?? 0)) throw new HttpError(404, "Direction not found");
  const [existing] = await tx.select().from(directionConfirmations).where(eq(directionConfirmations.directionId, directionId));
  if (existing) throw new HttpError(409, "This direction is already confirmed");
  const personDirections = (await tx.select().from(signedDirections).where(and(eq(signedDirections.yearId, yearId), eq(signedDirections.personId, direction.personId))).orderBy(desc(signedDirections.id)))
    .filter((d) => d.id > (cutoff?.lastDirectionId ?? 0));
  if (personDirections[0]?.id !== directionId) throw new HttpError(409, "A newer direction supersedes this one; confirm the newest direction.");
  const detail = await yearDetail(tx, yearId), holder = detail.holders.find((h) => h.personId === direction.personId)!;
  if (holder.isOnHold) throw new HttpError(409, "This holder is on hold — remove the hold first.");
  assertDirectionAmount(direction.amountCents.toString(), holder.nominalCents);
  const confirmations = await tx.select().from(directionConfirmations).orderBy(desc(directionConfirmations.id));
  const prior = confirmations.find((c) => personDirections.some((d) => d.id === c.directionId));
  const [priorEntry] = prior?.entryId ? await tx.select().from(distributionEntries).where(eq(distributionEntries.id, prior.entryId)) : [];
  const [reversal] = priorEntry ? await tx.select().from(distributionEntries).where(eq(distributionEntries.reversesEntryId, priorEntry.id)) : [];
  const restore = priorEntry && !reversal ? priorEntry.amountCents : 0n;
  if (direction.amountCents > BigInt(holder.remainingCents ?? "0") + restore) throw new HttpError(409, "This direction would exceed the remaining distribution after cash and other APIC entries.");
  if (restore > 0n) {
    await append(tx, actor, distributionEntries, { yearId, personId: direction.personId, kind: "apic", amountCents: -restore,
      date: direction.receivedDate, note: note.trim() || `Superseded by direction #${directionId}`, reversesEntryId: priorEntry!.id, createdBy: actor }, "DIRECTION_APIC_CORRECTION");
  }
  const entry = direction.amountCents > 0n ? await append(tx, actor, distributionEntries, {
    yearId, personId: direction.personId, kind: "apic", amountCents: direction.amountCents, date: direction.receivedDate,
    note: note.trim(), createdBy: actor,
  }, "DIRECTION_APIC_RECORDED") : null;
  return append(tx, actor, directionConfirmations, { directionId, entryId: entry?.id ?? null, supersedesId: prior?.directionId ?? null, note: note.trim(), createdBy: actor }, "DIRECTION_CONFIRMED");
}
export async function confirmSignedDirection(actor: string, yearId: number, directionId: number, note = "") {
  await write(actor, (tx) => confirmInTransaction(tx, actor, yearId, directionId, note));
  return directionView(yearId);
}
export async function recordPaperDirection(actor: string, yearId: number, input: unknown) {
  const data = paperInput.parse(input);
  await write(actor, async (tx) => {
    await assertAccess(actor, tx); await requireLedgerYear(tx, yearId);
    const detail = await yearDetail(tx, yearId), holder = detail.holders.find((h) => h.personId === data.personId);
    if (!holder) throw new HttpError(404, "Holder not in snapshot");
    assertDirectionAmount(data.amountCents, holder.nominalCents);
    if (data.documentId) {
      const [doc] = await tx.select().from(yearDocuments).where(and(eq(yearDocuments.id, data.documentId), eq(yearDocuments.yearId, yearId)));
      if (!doc) throw new HttpError(400, "The scan must be a sealed document in this year");
      const drafts = await tx.select().from(mailingDrafts).where(eq(mailingDrafts.yearId, yearId));
      if (drafts.some((draft) => draft.content.documentIds.includes(data.documentId!))) throw new HttpError(400, "This file is a shared mailing attachment. Upload a separate private paper scan.");
    }
    const template = await ensureDirectionTemplate(tx, actor);
    const row = await append(tx, actor, signedDirections, { yearId, personId: data.personId, kind: "paper", templateId: template.id,
      amountCents: BigInt(data.amountCents), receivedDate: calendarDate(data.receivedDate), documentId: data.documentId ?? null, createdBy: actor }, "DIRECTION_PAPER_RECORDED");
    // A paper direction is a superseding instruction too: disable outstanding links.
    const tokens = await tx.select().from(directionTokens).where(and(eq(directionTokens.yearId, yearId), eq(directionTokens.personId, data.personId)));
    for (const token of tokens) {
      if (await tokenState(tx, token) === "ready" || await tokenState(tx, token) === "spent") {
        await append(tx, actor, directionTokenEvents, { tokenId: token.id, kind: "voided", createdBy: actor }, "DIRECTION_LINK_VOIDED");
      }
    }
    await confirmInTransaction(tx, actor, yearId, row.id, data.note);
  });
  return directionView(yearId);
}
