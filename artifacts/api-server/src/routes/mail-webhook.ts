import { Router, raw, type IRouter } from "express";
import { z } from "zod/v4";
import { mailingEvents } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyMailWebhook } from "../lib/mailing-rules";
import { append, write } from "../lib/records";

const router: IRouter = Router();
const eventSchema = z.object({
  type: z.string(), created_at: z.string(),
  data: z.object({ email_id: z.string().min(1).max(200) }),
});
// Only this provider callback bypasses browser/session checks. Raw bytes and
// timestamp-tolerant Svix verification are required before ANY database write.
router.post("/", raw({ type: "application/json", limit: "256kb" }), async (req, res): Promise<void> => {
  const headers = Object.fromEntries(["svix-id", "svix-timestamp", "svix-signature"].map((name) => [name, req.get(name) ?? ""]));
  const event = eventSchema.parse(verifyMailWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), headers));
  if (!["email.delivered", "email.bounced", "email.complained"].includes(event.type)) {
    res.json({ message: "Event type ignored" }); return;
  }
  await write("resend-webhook", async (tx, actor) => {
    const [existing] = await tx.select().from(mailingEvents).where(eq(mailingEvents.webhookId, headers["svix-id"]));
    if (!existing) await append(tx, actor, mailingEvents, {
      webhookId: headers["svix-id"], messageId: event.data.email_id, event: event.type, occurredAt: event.created_at,
    }, "MAILING_DELIVERY_EVENT");
  });
  res.json({ message: "Event recorded" });
});
export default router;
