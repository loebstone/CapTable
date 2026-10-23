import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, mailingAttempts, mailingBatches, mailingDrafts, mailingResults } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { append, write } from "./records";
import { assertAccess } from "./access";
import type { Identity } from "./auth";
import { requireYear } from "./distribution-years";
import { HttpError } from "./errors";
import { assertPracticeSend } from "./mailing-rules";
import { mailingView, validateMailDocuments } from "./mailings";
import { mailingEnvelope } from "./mailing-envelope";

const sendInput = z.object({ kind: z.enum(["send", "resend", "preview"]), draftId: z.number().int().positive(), personId: z.string().optional() });
// Deliberate, explicit sends only; no background jobs and no automatic retries.
export async function sendMailing(identity: Identity, yearId: number, input: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "hwd-mail-"));
  try { return await sendWithSpool(identity, yearId, input, directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function sendWithSpool(identity: Identity, yearId: number, input: unknown, directory: string) {
  const data = sendInput.parse(input), preview = data.kind === "preview";
  const year = await requireYear(db, yearId);
  assertPracticeSend(year.isPractice, preview); // Before any external request.
  if (!process.env.RESEND_API_KEY) throw new HttpError(503, "RESEND_API_KEY is unset; no mailing was sent");
  const view = await mailingView(yearId);
  if (view.draftId !== data.draftId) throw new HttpError(409, "The mailing changed. Reload and review it before sending.");
  if (data.kind === "send" && view.status === "sent") throw new HttpError(409, "This mailing was already sent. Use Resend to failed/bounced.");
  await validateMailDocuments(yearId, view.content);
  const recipients = preview ? view.recipients.filter((r) => r.personId === data.personId) :
    view.recipients.filter((r) => r.channel === "Email" && (data.kind === "resend" ? r.canResend && (!data.personId || r.personId === data.personId) : r.status === "Draft"));
  if (!recipients.length) throw new HttpError(400, preview ? "Choose a holder for the preview" : "No eligible recipients");
  // Render/validate every envelope before reserving the send. Only one envelope's
  // bytes are retained at a time; attachments are generated again for delivery.
  const reservations: {
    recipient: typeof recipients[number]; spoolFile: string;
    attachments: Awaited<ReturnType<typeof mailingEnvelope>>["records"];
  }[] = [];
  for (const recipient of recipients) {
    const envelope = await mailingEnvelope(yearId, view.content, recipient.personId, preview ? identity.email : recipient.email!, view.replyTo, preview);
    const spoolFile = join(directory, `${reservations.length}.json`);
    await writeFile(spoolFile, JSON.stringify(envelope.payload), { mode: 0o600 });
    reservations.push({ recipient, spoolFile, attachments: envelope.records });
  }
  const batch = await write(identity.personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    assertPracticeSend((await requireYear(tx, yearId)).isPractice, preview);
    const drafts = await tx.select().from(mailingDrafts).where(eq(mailingDrafts.yearId, yearId));
    if (!drafts.length || Math.max(...drafts.map((d) => d.id)) !== data.draftId) throw new HttpError(409, "The mailing changed. Reload it.");
    const existing = await tx.select().from(mailingBatches).where(and(eq(mailingBatches.yearId, yearId), ne(mailingBatches.kind, "preview")));
    if (!preview && data.kind === "send" && existing.length) throw new HttpError(409, "This mailing was already sent. Use Resend to failed/bounced.");
    // Reserve against simultaneous resend attempts as well as first sends.
    const currentView = await mailingView(yearId);
    for (const { recipient } of reservations) {
      const current = currentView.recipients.find((r) => r.personId === recipient.personId);
      if (!preview && (current?.channel !== "Email" || current.email !== recipient.email)) throw new HttpError(409, "Recipient addresses or paper preferences changed; reload the mailing.");
      if (!preview && data.kind === "resend") {
        if (!current?.canResend) throw new HttpError(409, "Recipient eligibility changed; reload the mailing.");
      }
    }
    const row = await append(tx, actor, mailingBatches, { yearId, draftId: data.draftId, kind: data.kind, createdBy: actor }, `MAILING_${data.kind.toUpperCase()}`);
    const attempts = [];
    for (const reservation of reservations) {
      attempts.push(await append(tx, actor, mailingAttempts, {
        batchId: row.id, personId: reservation.recipient.personId,
        to: preview ? identity.email : reservation.recipient.email!, replyTo: view.replyTo,
        attachments: reservation.attachments, createdBy: actor,
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
