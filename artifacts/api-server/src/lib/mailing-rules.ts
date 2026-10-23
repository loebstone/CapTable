import { z } from "zod/v4";
import { HttpError } from "./errors";
import { Webhook } from "svix";

const choice = z.enum(["notice", "statement", "none"]);
export const draftInput = z.object({
  subject: z.string().trim().min(1).max(300).refine((s) => !/[\r\n]/.test(s), "Subject must be one line"),
  body: z.string().min(1).max(30000),
  documentIds: z.array(z.number().int().positive()).max(30).default([]),
  attachment: choice.default("notice"),
  choices: z.record(z.string(), choice).default({}),
}).superRefine(({ subject, body }, ctx) => {
  for (const [field, value] of [["subject", subject], ["body", body]] as const) {
    if (/\{\s*(first_name|shares|distribution)\s*\}/i.test(value)) {
      ctx.addIssue({ code: "custom", path: [field], message: "Merge fields are no longer supported. Write one fixed message for every recipient." });
    }
  }
});
export const emailInput = z.string().trim().email().max(254);
export function uniformMailText(content: { subject: string; body: string }, isPractice: boolean, preview: boolean) {
  // Revalidate old drafts too: an obsolete template must never be sent or resent.
  const { subject, body } = draftInput.pick({ subject: true, body: true }).parse(content);
  for (const value of [subject, body]) {
    if (/\{\s*(first_name|shares|distribution)\s*\}/i.test(value)) {
      throw new HttpError(409, "This mailing contains obsolete merge fields. Remove them before sending.");
    }
  }
  return {
    subject: `${preview ? "[PREVIEW] " : ""}${subject}`,
    body: `${isPractice ? "PRACTICE — nothing here is a real distribution\n\n" : ""}${body}`,
  };
}
export function recipientChannel(email: string | null | undefined, paper: boolean) {
  return paper ? "Paper" : email ? "Email" : "No email";
}
export function assertPracticeSend(isPractice: boolean, preview: boolean) {
  if (isPractice && !preview) throw new HttpError(403, "Practice years cannot send mailings. Use Send to me first.");
}
export function assertEnvelopeSize(payload: unknown) {
  // JSON includes base64 expansion; also reserve MIME line wrapping and headers.
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (Math.ceil(size * 1.04) + 65536 >= 40_000_000) throw new HttpError(400, "Email exceeds the 40 MB limit; remove shared attachments.");
  return size;
}
export function verifyMailWebhook(raw: Buffer, headers: Record<string, string>, secret = process.env.RESEND_WEBHOOK_SECRET) {
  if (!secret) throw new HttpError(503, "RESEND_WEBHOOK_SECRET is unset; delivery events are not configured");
  try {
    // Svix 2 verifies only (returns undefined); parse AFTER verification.
    new Webhook(secret).verify(raw, headers);
    return JSON.parse(raw.toString("utf8")) as unknown;
  }
  catch { throw new HttpError(401, "Invalid webhook signature"); }
}
