---
name: Mailing safety and provider verification
description: Why practice mail is self-preview only, uncertain sends stay manual, and Svix verification must precede JSON parsing.
---

Practice years must never send to shareholders. Only an explicitly chosen holder's
envelope may be sent to the signed-in person's own Roster-authorized email, with a
practice banner. Stage A excludes signatures, scheduling, and open tracking.

**Why:** The user requires a safe rehearsal path before distribution/APIC mailings;
an accidental shareholder mailing cannot be undone. After seeing the first
preview, the user also decided that email text should not carry individual
figures: the attached PDF is the privacy boundary, and a message preview must
not disclose a shareholder's personal numbers.

**How to apply:** Preserve the server-side practice block on both first sends and
resends, regardless of frontend controls. Keep recipient identity server-owned and
render only that holder's private attachment. Do not add signing until requested.

Uncertain provider outcomes are not failed deliveries and must never silently
retry. Reserve exact envelopes before sending, preserve their audit history, and
require manual provider investigation when acceptance is unknown.

**Why:** Network timeouts can occur after Resend accepted an email; treating these
as retryable failures can send duplicates.

**How to apply:** Only definite failures or bounces are eligible for the explicit
resend action. Complaints suppress resending, including late events for an earlier
attempt.

Svix 2's verifier validates a signature but returns undefined, unlike older
examples that return parsed JSON.

**Why:** The first signed-event check exposed this version difference. Parsing the
verifier return loses valid events; parsing before verification would trust
unauthenticated provider input.

**How to apply:** Verify the exact raw request bytes and timestamp first, then parse
those same bytes as JSON. Keep tamper/unsigned/replay tests when changing providers
or SDK versions.
