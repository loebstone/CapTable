---
name: Mailing safety and provider verification
description: Why practice mail is self-preview only, uncertain sends stay manual, and Svix verification must precede JSON parsing.
---

Practice years must never send to shareholders. Only an explicitly chosen holder's
envelope may be sent to the signed-in person's own Roster-authorized email, with a
practice banner. The user confirmed Stage A worked before authorizing Stage B.
Practice signing links and their receipts must retain the same self-addressed
boundary; shareholder batch sends, resends and reminders remain blocked.

**Why:** The user requires a safe rehearsal path before distribution/APIC mailings;
an accidental shareholder mailing cannot be undone. After seeing the first
preview, the user also decided that email text should not carry individual
figures: the attached PDF is the privacy boundary, and a message preview must
not disclose a shareholder's personal numbers.

**How to apply:** Preserve the server-side practice block on both first sends and
resends, regardless of frontend controls. Keep recipient identity server-owned and
render only that holder's private attachment. An opt-in signing URL is the sole
per-recipient body exception; names, shares and amounts still belong in PDFs,
not merged into email text.

Uncertain provider outcomes are not failed deliveries and must never silently
retry. Reserve exact envelopes before sending, preserve their audit history, and
require manual provider investigation when acceptance is unknown.

**Why:** Network timeouts can occur after Resend accepted an email; treating these
as retryable failures can send duplicates.

**How to apply:** The original failed/bounced batch action stays restricted.
The user also requested an intentional per-holder complete-envelope Resend for
lost/spam-folder mail, including Sent/Delivered mail; do not confuse that explicit
second-copy request with automatic retry. Complaints still suppress real sending,
including late events for an earlier attempt.

Svix 2's verifier validates a signature but returns undefined, unlike older
examples that return parsed JSON.

**Why:** The first signed-event check exposed this version difference. Parsing the
verifier return loses valid events; parsing before verification would trust
unauthenticated provider input.

**How to apply:** Verify the exact raw request bytes and timestamp first, then parse
those same bytes as JSON. Keep tamper/unsigned/replay tests when changing providers
or SDK versions.

A real Resend send from development can invoke the existing production webhook.

**Why:** A development signed-copy test produced a production delivery-event
record through the account's already-configured callback, despite no direct
production write by the test process. A different development database/API
process does not isolate an account-wide provider webhook.

**How to apply:** Default to mocked email. Before another real-email test, isolate
provider callback routing (or add verified environment tagging/filtering). Do not
claim production was untouched merely because all explicit app requests used
development. Preserve any already-recorded event under the append-only rule.
