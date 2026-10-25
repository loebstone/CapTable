import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, mailingAttempts, mailingBatches, mailingDrafts, mailingResults, holdingFetches } from "@workspace/db";
import { and, eq, ne, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { append, write } from "./records";
import { assertAccess } from "./access";
import type { Identity } from "./auth";
import { requireYear } from "./distribution-years";
import { HttpError } from "./errors";
import { assertPracticeSend } from "./mailing-rules";
import { mailingView, validateMailDocuments, originalMailing } from "./mailings";
import { fetchRosterHoldings } from "./roster";
import { proposeHoldingResidences } from "./holding-residences";
import { mailingEnvelope } from "./mailing-envelope";
import { issueSigningToken, signingLinkHtml, signingLinkText } from "./direction-links";

const sendInput = z.object({ kind: z.enum(["send", "resend", "preview"]), draftId: z.number().int().positive(), personId: z.string().optional() });
// Deliberate, explicit sends only; no background jobs and no automatic retries.
export async function sendMailing(identity: Identity, yearId: number, input: unknown, origin: string) {
  const directory = await mkdtemp(join(tmpdir(), "hwd-mail-"));
  try { return await sendWithSpool(identity, yearId, input, directory, origin); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
export async function resendHolderEnvelope(identity: Identity, yearId: number, personId: string, origin: string) {
  const year = await requireYear(db, yearId), source = await originalMailing(yearId, year.isPractice);
  if (!source) throw new HttpError(409, year.isPractice ? "Send to me first before resending a practice envelope." : "Send this year's mailing before resending an envelope.");
  const payload = await fetchRosterHoldings();
  await write(identity.personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    await append(tx, actor, holdingFetches, { payload, fetchedBy: actor }, "MAILING_RESEND_ROSTER_REFRESH");
    await proposeHoldingResidences(tx, actor, payload);
  });
  const directory = await mkdtemp(join(tmpdir(), "hwd-mail-"));
  try { return await sendWithSpool(identity, yearId, { kind: "resend", draftId: source.draftId, personId }, directory, origin, source); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function sendWithSpool(identity: Identity, yearId: number, input: unknown, directory: string, origin: string,
  source?: NonNullable<Awaited<ReturnType<typeof originalMailing>>>) {
  const data = sendInput.parse(input);
  const year = await requireYear(db, yearId);
  const preview = data.kind === "preview" || (!!source && year.isPractice);
  assertPracticeSend(year.isPractice, preview); // Before any external request.
  if (!process.env.RESEND_API_KEY) throw new HttpError(503, "RESEND_API_KEY is unset; no mailing was sent");
  const view = await mailingView(yearId);
  if (!source && view.draftId !== data.draftId) throw new HttpError(409, "The mailing changed. Reload and review it before sending.");
  const content = source ? { ...source.content, choices: { ...source.content.choices, [data.personId!]: "notice" as const }, includeSigningLink: true } : view.content;
  const replyTo = source?.replyTo ?? view.replyTo;
  if (data.kind === "send" && view.status === "sent") throw new HttpError(409, "This mailing was already sent. Use Resend to failed/bounced.");
  await validateMailDocuments(yearId, content);
  const recipients = preview ? view.recipients.filter((r) => r.personId === data.personId) :
    view.recipients.filter((r) => r.channel === "Email" && (source ? r.personId === data.personId && r.status !== "Complained" :
      data.kind === "resend" ? r.canResend && (!data.personId || r.personId === data.personId) : r.status === "Draft"));
  if (!recipients.length) throw new HttpError(400, preview ? "Choose a holder for the preview" : "No eligible recipients");
  // Render/validate every envelope before reserving the send. Only one envelope's
  // bytes are retained at a time; attachments are generated again for delivery.
  const reservations: {
    recipient: typeof recipients[number]; spoolFile: string;
    attachments: Awaited<ReturnType<typeof mailingEnvelope>>["records"];
  }[] = [];
  for (const recipient of recipients) {
    const envelope = await mailingEnvelope(yearId, content, recipient.personId, preview ? identity.email : recipient.email!, replyTo, preview);
    const spoolFile = join(directory, `${reservations.length}.json`);
    await writeFile(spoolFile, JSON.stringify(envelope.payload), { mode: 0o600 });
    reservations.push({ recipient, spoolFile, attachments: envelope.records });
  }
  const batch = await write(identity.personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    assertPracticeSend((await requireYear(tx, yearId)).isPractice, preview);
    const drafts = await tx.select().from(mailingDrafts).where(eq(mailingDrafts.yearId, yearId));
    if (!drafts.length || (!source && Math.max(...drafts.map((d) => d.id)) !== data.draftId)) throw new HttpError(409, "The mailing changed. Reload it.");
    const existing = await tx.select().from(mailingBatches).where(and(eq(mailingBatches.yearId, yearId), ne(mailingBatches.kind, "preview")));
    if (!preview && data.kind === "send" && existing.length) throw new HttpError(409, "This mailing was already sent. Use Resend to failed/bounced.");
    await validateMailDocuments(yearId, content);
    if (source) {
      const pending = await tx.select({ id: mailingAttempts.id }).from(mailingAttempts)
        .innerJoin(mailingBatches, eq(mailingBatches.id, mailingAttempts.batchId))
        .leftJoin(mailingResults, eq(mailingResults.attemptId, mailingAttempts.id))
        .where(and(eq(mailingBatches.yearId, yearId), eq(mailingAttempts.personId, data.personId!),
          isNull(mailingResults.id), ...(preview ? [] : [ne(mailingBatches.kind, "preview")])));
      // Check results explicitly; a reserved envelope with no recorded outcome
      // must not be sent concurrently or silently retried after a process crash.
      if (pending.length) throw new HttpError(409, "An earlier envelope is still pending. Check Resend before another resend.");
    }
    // Reserve against simultaneous resend attempts as well as first sends.
    const currentView = await mailingView(yearId);
    for (const { recipient } of reservations) {
      const current = currentView.recipients.find((r) => r.personId === recipient.personId);
      if (!preview && (current?.channel !== "Email" || current.email !== recipient.email)) throw new HttpError(409, "Recipient addresses or paper preferences changed; reload the mailing.");
      if (!preview && data.kind === "resend") {
        if (source ? current?.status === "Complained" : !current?.canResend) throw new HttpError(409, "Recipient eligibility changed; reload the mailing.");
      }
    }
    const row = await append(tx, actor, mailingBatches, { yearId, draftId: data.draftId, kind: data.kind, createdBy: actor }, source ? "MAILING_PERSON_RESEND" : `MAILING_${data.kind.toUpperCase()}`);
    const attempts = [];
    for (const reservation of reservations) {
      const link = content.includeSigningLink ? await issueSigningToken(tx, actor, yearId, reservation.recipient.personId, preview ? identity.email : reservation.recipient.email!, origin) : null;
      if (link) {
        const payload = JSON.parse(await readFile(reservation.spoolFile, "utf8"));
        payload.html = signingLinkHtml(payload.text, link.url);
        payload.text = signingLinkText(payload.text, link.url);
        const { assertEnvelopeSize } = await import("./mailing-rules");
        assertEnvelopeSize(payload);
        await writeFile(reservation.spoolFile, JSON.stringify(payload), { mode: 0o600 });
      }
      attempts.push(await append(tx, actor, mailingAttempts, {
        batchId: row.id, personId: reservation.recipient.personId,
        to: preview ? identity.email : reservation.recipient.email!, replyTo,
        attachments: reservation.attachments, signingTokenId: link?.token.id ?? null, createdBy: actor,
      }, "MAILING_ENVELOPE_RESERVED"));
    }
    return { id: row.id, attempts };
  });
  const results = [];
  for (const attempt of batch.attempts) {
    let messageId: string | null = null, result: "sent" | "failed" | "unknown" = "failed", detail = "";
    try {
      await assertAccess(identity.personId);
      assertPracticeSend((await requireYear(db, yearId)).isPractice, preview);
      if (!preview) {
        const recipient = (await mailingView(yearId)).recipients.find((r) => r.personId === attempt.personId);
        if (!recipient || recipient.channel !== "Email" || recipient.email !== attempt.to || recipient.status === "Complained") {
          throw new HttpError(409, "Recipient address, paper preference or complaint status changed; no email sent. Review the Roster and mailing.");
        }
      }
      const reservation = reservations.find((r) => r.recipient.personId === attempt.personId)!;
      const payload = await readFile(reservation.spoolFile, "utf8");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
          "Idempotency-Key": `hwd-mail-${batch.id}-${attempt.id}` },
        body: payload, signal: AbortSignal.timeout(30000), redirect: "error",
      });
      const answer = await response.json().catch(() => null);
      if (response.ok && typeof answer?.id === "string") { messageId = answer.id; result = "sent"; detail = "Accepted by Resend"; }
      else { result = response.status >= 500 || response.ok ? "unknown" : "failed"; detail = `Resend returned HTTP ${response.status}; no automatic retry`; }
    } catch (error) {
      result = error instanceof HttpError ? "failed" : "unknown";
      detail = error instanceof HttpError ? error.message : "Send outcome is uncertain. Check Resend before taking further action; no automatic retry.";
    }
    await write(identity.personId, (tx, actor) => append(tx, actor, mailingResults, { attemptId: attempt.id, messageId, result, detail }, "MAILING_SEND_RESULT"));
    results.push({ personId: attempt.personId, result, messageId, detail });
    if (attempt.id !== batch.attempts.at(-1)?.id) await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return { results };
}
