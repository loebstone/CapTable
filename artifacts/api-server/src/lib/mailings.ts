import {
  db, holdingFetches, mailSettings, paperPreferences, mailingDrafts, mailingBatches,
  mailingAttempts, mailingResults, mailingEvents, yearDocuments, type MailingDraft,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { reportContext } from "./reports/context";
import { latestBy } from "./records";
import { recipientChannel } from "./mailing-rules";
import { HttpError } from "./errors";

export const defaultMailing: MailingDraft = { subject: "", body: "", documentIds: [], attachment: "notice", choices: {} };
export async function replyToSetting() {
  return (await db.select().from(mailSettings).orderBy(desc(mailSettings.id)).limit(1))[0]?.replyTo ?? "peter@loebstone.com";
}
export async function mailingView(yearId: number) {
  const context = await reportContext(yearId);
  const [draft] = await db.select().from(mailingDrafts).where(eq(mailingDrafts.yearId, yearId)).orderBy(desc(mailingDrafts.id)).limit(1);
  const [fetch] = await db.select().from(holdingFetches).orderBy(desc(holdingFetches.id)).limit(1);
  const emails = new Map(fetch?.payload.holdings.map((h) => [h.personId, h.email ?? null]));
  const preferences = new Map(latestBy(await db.select().from(paperPreferences).orderBy(desc(paperPreferences.id)), (r) => r.personId).map((r) => [r.personId, r.prefersPaper]));
  const batches = await db.select().from(mailingBatches).where(eq(mailingBatches.yearId, yearId));
  const liveBatches = batches.filter((b) => b.kind !== "preview").map((b) => b.id);
  const attempts = liveBatches.length ? await db.select().from(mailingAttempts).where(inArray(mailingAttempts.batchId, liveBatches)).orderBy(desc(mailingAttempts.id)) : [];
  const results = attempts.length ? await db.select().from(mailingResults).where(inArray(mailingResults.attemptId, attempts.map((a) => a.id))) : [];
  const messages = results.flatMap((r) => r.messageId ? [r.messageId] : []);
  const events = messages.length ? await db.select().from(mailingEvents).where(inArray(mailingEvents.messageId, messages)) : [];
  const content = draft?.content ?? defaultMailing;
  const recipients = context.year.holders.map((holder) => {
    const email = emails.get(holder.personId) ?? null, prefersPaper = preferences.get(holder.personId) ?? false;
    const channel = recipientChannel(email, prefersPaper);
    const attempt = attempts.find((a) => a.personId === holder.personId);
    const result = results.find((r) => r.attemptId === attempt?.id);
    const deliveredEvents = events.filter((e) => e.messageId === result?.messageId).map((e) => e.event);
    const personAttempts = attempts.filter((a) => a.personId === holder.personId).map((a) => a.id);
    const personMessages = results.filter((r) => personAttempts.includes(r.attemptId)).map((r) => r.messageId);
    const complained = events.some((e) => personMessages.includes(e.messageId) && e.event === "email.complained");
    // Complaints/bounces must not be overwritten by a delayed delivered event.
    const status = complained ? "Complained" :
      deliveredEvents.includes("email.bounced") ? "Bounced" : deliveredEvents.includes("email.delivered") ? "Delivered" :
      result?.result === "sent" ? "Sent" : result?.result === "failed" ? "Failed" : attempt ? "Unknown — check Resend before retrying" :
      channel === "Email" ? "Draft" : channel;
    return { personId: holder.personId, displayName: holder.displayName, email, prefersPaper, channel, status,
      attachment: content.choices[holder.personId] ?? content.attachment,
      canResend: channel === "Email" && (status === "Failed" || status === "Bounced"),
      messageId: result?.messageId ?? null, sentAt: result?.result === "sent" ? result.createdAt : null,
      detail: status === "Bounced" ? "Fix address in the Roster before resending." : result?.detail ?? null,
    };
  });
  return { calendarYear: context.year.calendarYear, draftId: draft?.id ?? null, content, status: liveBatches.length ? "sent" as const : "draft" as const,
    replyTo: await replyToSetting(), isPractice: context.year.isPractice, recipients,
    documents: (await db.select().from(yearDocuments).where(eq(yearDocuments.yearId, yearId))).map(({ id, filename, contentType, size }) => ({ id, filename, contentType, size })),
  };
}
export async function validateMailDocuments(yearId: number, content: MailingDraft) {
  if (new Set(content.documentIds).size !== content.documentIds.length) throw new HttpError(400, "Duplicate attachment");
  for (const id of content.documentIds) {
    const [doc] = await db.select().from(yearDocuments).where(and(eq(yearDocuments.id, id), eq(yearDocuments.yearId, yearId)));
    if (!doc || doc.contentType !== "application/pdf") throw new HttpError(400, "Shared attachments must be sealed PDFs attached to this year");
  }
}
