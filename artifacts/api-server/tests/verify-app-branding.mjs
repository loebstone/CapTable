/**
 * DEVELOPMENT ONLY. Local Roster stub and mocked Resend transport.
 * The real auth route renders the email; no external email is sent.
 * All test database writes are rolled back by the existing harness.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stage2Harness } from "./stage2-harness.mjs";

const h = await stage2Harness();
const originalFetch = globalThis.fetch;
try {
  const cookie = await h.login();
  const anonymous = await h.call("get", "/api/backup/confirm");
  h.expect(anonymous, 401);
  assert.equal(anonymous.body.error, "Sign in to HWD Cap Table");
  const confirmation = await h.call("get", "/api/backup/confirm", cookie);
  h.expect(confirmation, 200);
  assert.match(confirmation.text, /<title>Download HWD Cap Table backup<\/title>/);
  assert.match(confirmation.text, /action="\/api\/backup"/);

  let email;
  // Process-local test values only, not Replit Secrets or production settings.
  process.env.RESEND_API_KEY = "development-only-mocked-email-transport";
  process.env.RESEND_FROM_EMAIL = "test@example.test";
  globalThis.fetch = async (input, options) => {
    if (String(input) !== "https://api.resend.com/emails") return originalFetch(input, options);
    email = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "mocked-development-email" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  // Preserve the existing one-second repeat-request guard.
  await new Promise((done) => setTimeout(done, 1100));
  h.expect(await h.call("post", "/api/auth/link", null, { email: "bootstrap@example.test" }), 200);
  assert.equal(email.subject, "Sign in to HWD Cap Table");
  assert.match(email.text, /^Sign in to HWD Cap Table:\n/);
  assert.match(email.text, /This single-use link expires in 15 minutes/);
  assert.doesNotMatch(email.subject + email.text, /HWD Distributions/i);
  const redactedBody = email.text.replace(/https?:\/\/\S+/g, "[single-use sign-in link omitted]");
  const output = resolve("../../generated-artifacts/branding");
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "magic-link-email.txt"), `Subject: ${email.subject}\n\n${redactedBody}\n`);
  h.record("Renamed email rendered by actual sign-in route", {
    roster: "LOCAL STUB", resend: "MOCKED TRANSPORT; no external email",
    subject: email.subject, text: redactedBody,
  });
  h.record("Backup confirmation and access", {
    signedInHTTP: confirmation.status, anonymousHTTP: anonymous.status,
    title: "Download HWD Cap Table backup", postRouteUnchanged: "/api/backup",
  });
} finally {
  globalThis.fetch = originalFetch;
  await h.finish();
}
