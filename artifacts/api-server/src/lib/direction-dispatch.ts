import { db, directionDispatches } from "@workspace/db";
import { append, write } from "./records";
import { assertAccess } from "./access";
import type { Identity } from "./auth";
import { requireYear } from "./distribution-years";
import { mailingView, replyToSetting } from "./mailings";
import { issueSigningToken, signingLinkText } from "./direction-links";
import { MAIL_SENDER } from "./mailing-envelope";
import { HttpError } from "./errors";
import { directionView } from "./directions";

export async function dispatchDirection(identity: Identity, yearId: number, personId: string, origin: string, reminder = false) {
  if (!process.env.RESEND_API_KEY) throw new HttpError(503, "RESEND_API_KEY is unset; no link was sent");
  const reservation = await write(identity.personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const year = await requireYear(tx, yearId);
    if (year.isPractice && reminder) throw new HttpError(403, "Practice years cannot send reminders. Use a self-preview link.");
    const recipient = (await mailingView(yearId)).recipients.find((r) => r.personId === personId);
    if (!recipient) throw new HttpError(404, "Holder not in snapshot");
    if (!year.isPractice && (recipient.channel !== "Email" || recipient.status === "Complained")) throw new HttpError(409, "This holder is on the paper list or cannot receive email.");
    if (reminder && !(await directionView(yearId)).rows.find((r) => r.personId === personId)?.canRemind) throw new HttpError(409, "This holder is no longer eligible for a reminder.");
    const email = year.isPractice ? identity.email : recipient.email!;
    return issueSigningToken(tx, actor, yearId, personId, email, origin);
  });
  let result = "unknown", messageId: string | null = null;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
        "Idempotency-Key": `hwd-direction-link-${reservation.token.id}` },
      body: JSON.stringify({ from: MAIL_SENDER, to: [reservation.token.email], reply_to: await replyToSetting(),
        subject: `${reservation.token.context.isPractice ? "[PREVIEW] " : ""}${reminder ? "Reminder: " : ""}Tax & Reinvestment Document`,
        text: signingLinkText(`${reservation.token.context.isPractice ? "PRACTICE — nothing here is a real distribution\n\n" : ""}Please review and sign your Tax & Reinvestment Document using the link below.`, reservation.url) }),
      signal: AbortSignal.timeout(30000), redirect: "error",
    });
    const answer = await response.json().catch(() => null);
    if (response.ok && typeof answer?.id === "string") { result = "sent"; messageId = answer.id; }
    else result = response.status >= 500 || response.ok ? "unknown" : "failed";
  } catch { /* unknown: the provider may have accepted it; never retry silently */ }
  await write(identity.personId, (tx, actor) => append(tx, actor, directionDispatches, { tokenId: reservation.token.id, result, messageId }, reminder ? "DIRECTION_REMINDER_RESULT" : "DIRECTION_LINK_EMAIL_RESULT"));
  return { linkId: reservation.token.id, expiresAt: reservation.token.expiresAt, result, messageId };
}
export async function remindUnsigned(identity: Identity, yearId: number, origin: string) {
  if ((await requireYear(db, yearId)).isPractice) throw new HttpError(403, "Practice years cannot send reminders. Use a self-preview link.");
  const recipients = (await directionView(yearId)).rows.filter((r) => r.canRemind);
  const results = [];
  for (const row of recipients) {
    results.push(await dispatchDirection(identity, yearId, row.personId, origin, true));
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return { count: recipients.length, sentCount: results.filter((r) => r.result === "sent").length,
    failedCount: results.filter((r) => r.result === "failed").length, unknownCount: results.filter((r) => r.result === "unknown").length };
}
