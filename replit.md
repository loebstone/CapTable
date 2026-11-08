# Roster SSO consumer

- The HWD Roster establishes identity; **this app's active access list remains the
  sole management authorization authority**. Roster `role` / `rosterAdmin` do not
  grant local permissions. No local roles were added.
- Anonymous protected-page visits render no intermediate screen: after the session
  check, the browser immediately replaces its location with the identity entry URL,
  preserving the requested path and query. Direct `/sign-in` visits show only
  **Sign in to HWD Cap Table** and one **Sign in** button. Member-facing sign-in
  and freshness wording do not name the identity provider; the unlinked back door
  is unchanged. Freshness asks **Confirm it's me** and explains that a fresh link
  will be emailed. `/api/auth/roster?to=<path>` redirects
  to `{ROSTER_BASE_URL}/sign-in?app=captable&to=<encoded path>&origin=<APP_ORIGIN>`.
  `APP_ORIGIN` must be set and registered in the Roster for development SSO too.
  `to` is a local single-leading-slash path; schemes, network paths, backslashes,
  encoded unsafe paths, controls and malformed encodings are refused.
- The registered callback is **GET `/auth/sso?ticket=...&to=...`** (also available
  under `/api/auth/sso`). The API artifact explicitly owns `/auth/sso` in both
  development and future published routing, so it is not a frontend SPA fallback.
  The server POSTs `{ticket}` to `/api/service/sso-redeem` with
  `DISTRIBUTIONS_SERVICE_KEY`, 10-second timeout and redirects forbidden. 401,
  outages and invalid responses refuse sign-in. Tickets are 60-second/single-use
  as enforced by the Roster. Query strings/credentials are never logged.
- Redeemed identity fields: `personId`, `displayName`, `goes_by`, `email`,
  `rosterAdmin`, `role`, `authenticated_at`. Only identity and authentication time
  are used. Active local membership is checked again inside the session creation
  transaction. The original never-initialized/bootstrap-person exception remains;
  a removed list cannot bootstrap again. Missing membership shows
  “You're not on the Cap Table access list. Ask Peter.” and writes a refusal
  audit. Successful session insertion is audited **Signed in via Roster**.
- SSO callback limit: **20 attempts per IP / 15 minutes**, using Express's
  existing one-hop trusted-proxy address handling. Limits are per running process,
  not a distributed cross-instance counter.
- New sessions append nullable `authenticated_at` and `sign_in_method` metadata;
  no old session is updated, deleted, extended or revoked by this feature.
  Existing missing metadata falls back to session creation time. The unchanged
  signed HttpOnly/SameSite=Lax cookie is `hwd_distributions_session`; Secure in
  production. Explicit local logout still appends a revocation.
- Every management route requires a **live session and active local access**.
  There is no entry/browsing age limit on `authenticated_at`: older Roster,
  magic-link and legacy identities may browse while their session remains live.
  SSO redemption preserves the supplied authentication time without a 12-hour
  identity-age gate. Session expiry/revocation is unchanged; no existing sessions
  are extended or modified. Ledger cash/APIC/reversal/hold writes, signed-direction confirmation,
  paper-direction ledger writes, practice reset and mailing sends/previews/
  resends/reminders/link emails additionally require age **within 15 minutes**.
  Gates run before validation, writes or provider calls. Public shareholder
  signing is not a management session and is unchanged.
- Stale authentication returns **403, `code: "reauthenticate"`** without mutation.
  The UI shows an explanation and **Confirm it's me**, returning to
  the current path/query with `fresh=1`. No write is silently retried. The Roster
  requires a new email link before minting a fresh ticket. Explicit logout still
  works when stale; **Sign out of all Farm apps** locally signs out and then
  navigates to `{ROSTER_BASE_URL}/sign-out` (desktop and mobile).
- The unlinked **`/admin/sign-in`** is labelled **For when the Roster is
  unavailable**. It is for active local access-list members, not a new admin role.
  It cannot bootstrap. Unknown/nonmember emails get the neutral response and no
  link. A previously verified session supplies the local email/person mapping so
  known members can use this route during an outage; a new address still needs
  Roster `sign-in-check` identity resolution and active local membership.
  Mailbox possession is always verified by the existing 15-minute single-use
  magic link, consumed only by the same-origin Continue POST. Membership is
  checked again at redemption and transaction time. New back-door sessions use
  their verify time and `sign_in_method: "magic-link"`.
- Deliberately anonymous additions: GET `/auth/sso` / `/api/auth/sso` (ticket
  credential), GET `/api/auth/roster` (validated navigation to identity provider),
  GET `/api/auth/farm-sign-out` (navigation only), frontend `/admin/sign-in`
  (email request form; authorization remains server-side). Existing health,
  magic-link request/Continue routes, signed webhook and restricted public signing
  exceptions remain as documented below.
- Run `pnpm --filter @workspace/api-server run verify:sso`. It uses stub tickets,
  mocked email, rollback-local tables, and covers access refusal/audit, invalid/
  expired/replayed tickets, unsafe paths, outages, rate limits, action-only
  freshness, old-identity browsing, session expiry, legacy metadata fallback and the back door. Existing foundation
  tests now bootstrap explicitly before exercising the member-only back door;
  they no longer expect a live Roster authorization call on every data request.

# Stage A and Stage B — mailings and signed directions

Development implementation. Never publish as part of verification and never write
to a production database. The supplied Stage A and revised Stage B prompts are the implemented contract;
the separately named “Mailings and Signatures v0.1” project document was not present
in this workspace. There are no scheduled jobs, roles or officer titles.

## Tax & Reinvestment Document — Stage B

- The distribution year's **Holders** table shows Email/Paper, mailing delivery, document status,
  confirmation/history and Resend/Re-issue/Record paper controls are in that row.
  Actions are at the far right. The old `/years/:id/directions` page is a
  compatibility redirect to the year's `#holders`, not another status list.
  Remind unsigned and Print paper directions are above this table.
- The Holders table is an internally scrolling region capped at 60dvh, with sticky
  column headings and the Holder name pinned at the left; it scrolls horizontally
  without losing the name on narrow screens.
- Uploading a PDF from Mailing's **Shared documents** now selects that sealed PDF
  in the local mailing draft. It does not select unrelated existing year documents
  and does not save implicitly. Save draft is required before preview/send, and
  upload/sealing disables both Save and send controls. The send summary lists the
  selected shared names/sizes, personal attachment choice and signing-link choice.
- Signing emails are multipart: the unchanged uniform plain-text message remains
  the text alternative; a fixed HTML wrapper escapes that message and supplies a
  table-based **Sign here** button plus a copyable-address fallback. No HTML
  authoring, tracking, personal figures, or name merges were added. Link-only
  reissues/reminders use the same button. The latest link opens Continue; old
  replaced/spent links still return 410 and GET never consumes a fresh token.
- Verification mail remains mocked while this Resend account has an enabled
  production callback. A real development mailbox check requires provider callback
  isolation; a missing production webhook secret is not isolation because provider
  retries could arrive after it is configured. No production callback changes are
  made by development tests.

- Each status row has **Resend**, separate from **Re-issue link** (link only) and
  **Remind unsigned**. Resend fetches current Roster contacts first; for real years
  it uses the original sent mailing's immutable subject/body, shared PDF IDs and
  reply-to, regenerates this holder's Notice and adds a fresh signing link (also
  when the original mailing predated signing links). Earlier unused/continued links
  are invalidated. The target is never supplied by the browser.
- A practice Resend uses the latest **Send to me first** envelope's original draft,
  not a subsequently edited unsent draft, and goes only to the current signed-in
  person's Roster-authorized email. It has the normal preview subject/PRACTICE
  banner. It does not mark the practice mailing sent or lock its draft.
- A Resend is an intentional second copy, allowed after Sent/Delivered as well as
  failures; it is not automatic retry. Complaints and paper preference still block
  real shareholder email, and a pending reservation with no recorded outcome
  blocks concurrent copies. Every attempt is a `resend` batch with its own
  per-recipient attachment hashes/token id/result and Write History entries.
  **Resends: N** counts these attempts, including self-addressed practice resends;
  ordinary previews and link-only reissues/reminders do not increment it.
- `pnpm --filter @workspace/api-server run verify:resend` exercises original-envelope
  preservation, current-address refresh, Notice regeneration, link replacement,
  counts, self-only practice behavior and access/Origin/pending guards using
  a local Roster stub and mocked Resend. It sends NO real email.

- The year header's **Tax & Reinvestment** link opens the per-holder direction
  status table. Signing works on the public **/sign-direction** page without a
  management sign-in, but only after a restricted signing session is established.
  The page has no navigation, shares, distribution or tax figures. Its only
  figure is the editable retention amount.
- The exact legal document text lives in `direction_templates`, with a unique
  immutable version. Source wording lives in `direction-rules.ts`; a wording
  change MUST increase `DIRECTION_VERSION`. Existing tokens/documents retain the
  version they used. Snapshot name is distinct from typed signature name.
- **Include signing link** on a new mailing permits the one per-recipient text
  exception: a plain **Sign your Tax & Reinvestment Document** URL appended to
  the otherwise uniform authored body. No name/share/amount merge fields return.
  A sent Stage A draft remains locked; existing years can use **Re-issue link**
  or an explicit **Remind** action independently.
- Signing links contain 32 random bytes, stored only as SHA-256 hashes, bound to
  one holder/year/delivery email/template version and a frozen distribution
  context. They expire after 30 days when checked; no job modifies them.
  Reissue appends invalidation events for previous unused/continued tokens.
- `GET /api/signing/open?token=...` serves only a Continue form, never a session
  or holder data. `POST /api/signing/continue` consumes the link, appends a
  Continue event and creates a distinct 30-minute restricted cookie,
  **hwd_direction_session** (HttpOnly, SameSite=Strict, Secure in production,
  path `/api/signing`). It grants NO management API access. Old, expired or
  voided links return a plain 410 message. Public POSTs use the same Origin
  checks as every other write; IP/token/session rate limits apply.
  The native Continue form uses `Referrer-Policy: strict-origin`, as the
  magic-link form does, so Chromium supplies Origin without disclosing the
  token-bearing path/query in a referrer.
- `POST /api/signing/sign` requires typed name and the exact affirmative consent
  checkbox, validates integer cents inclusively from zero to the holder's
  distribution, and refuses a changed distribution context. It records signer
  IP/browser, UTC and America/New_York times, link id, Continue time, recipient
  email, consent text, and template version. It does not trust client identity,
  dates, IP or year/holder IDs.
- The first page contains ONLY the versioned legal document (plus the practice
  watermark when applicable). The second is signature evidence. To avoid an
  impossible self-referential PDF hash, `document_hash` hashes the original
  one-page document and is printed on the evidence page; `pdf_hash` hashes the
  final sealed two-page PDF. Both the original and signed PDF are stored privately
  in the year's sealed document store and are covered by backup.
- The signature, token-spent event, document metadata, evidence and receipt intent
  commit in one database transaction, under the app's write lock. App Storage and
  Resend cannot join a PostgreSQL transaction: the files are sealed before commit
  and the receipt email is sent only after commit; its result is appended separately.
  A storage failure rolls back the signature. A database/commit failure can leave
  an unreferenced private generated file rather than risking deletion of a
  committed signature. No scheduled cleanup or automatic email retry.
- An electronic direction is **awaiting confirmation** until someone with active
  access clicks Confirm. Optional note is available but never required. Confirm
  atomically records APIC on the New York signing date and a confirmation row.
  A zero direction is valid and confirmed without an invalid zero ledger entry.
  Hold blocks confirmation/ledger changes until removed.
- A superseding confirmed direction REPLACES the prior direction's retention:
  reverse the prior active APIC entry, then append the new amount; check combined
  cash/other APIC does not exceed the distribution. Do not add the new direction
  on top of the old one. Earlier PDFs and rows remain and are linked in history.
- **Record paper direction** accepts amount, received date, optional sealed scan
  and optional note; it records paper + confirmation + APIC together, and disables
  older signing links. Paper scans and generated signature PDFs are EXCLUDED from
  shared mailing attachments both in the chooser and on the server.
- **Print paper directions** on the status page prints one blank-amount document
  with signature/date lines per paper recipient. The Mailing page's Print letters
  also includes these forms when Include signing link is selected.
- In practice years, a new/reissued link is emailed ONLY to the signed-in person's
  own address. The signed-copy receipt goes to that same token-bound address.
  Every email has a PRACTICE banner and every PDF page a PRACTICE watermark.
  Batch Send, Resend and Remind remain forbidden. Practice reset invalidates
  existing links/sessions/directions, removes its document files/ledger under the
  existing reset exception, and retains signature/audit history with a reset cutoff.
- Public signing routes are the deliberate capability-based exception to management
  access checks, alongside sign-in/health and the signature-verified Resend webhook.
  All management direction/status/print/download/confirm/paper/reminder routes
  require a fresh authenticated session and active local access, with the
  additional 15-minute gate on sends and ledger-writing actions.
- Signing is evidence of the actions taken with a bearer link, typed name and
  consent, not independent identity verification. Do not describe it as proof
  that an email link was not forwarded.
- `pnpm --filter @workspace/api-server run verify:directions` uses mocked Resend,
  a local Roster stub, isolated rollback tables and private test storage. It never
  emails Peter. The explicitly requested live receipt check is
  `pnpm --filter @workspace/api-server exec tsx tests/verify-directions.mjs --live-receipt`;
  it permits exactly ONE real signed-copy receipt to **delivered@resend.dev**,
  not any configurable human address. All other emails remain mocked.
  **Do not rerun a live-email check until provider callback routing is isolated.**
  The completed live receipt test also reached the account's existing production
  webhook and appended a delivery event there. A development database does not
  isolate an account-wide Resend webhook. Use the default mocked command meanwhile.

- A year has append-only draft revisions; the first real send reserves an immutable
  batch and locks the draft. Explicit resends target only failed/bounced email
  recipients; complaints suppress resending, including a late complaint about an
  earlier attempt. A timeout/uncertain outcome is not automatically retried.
- All holders come from the fixed year snapshot. Email addresses come from the
  latest **stored** Roster holdings fetch, matched by personId. Use “Refresh
  addresses” to fetch current contacts; absent `email` and explicit null mean no
  email. No invented addresses. The Roster service contract now additionally allows
  `email?: string | null` (first email contact); old responses remain compatible.
- `paper_preferences` is revisioned per person, independent of tax residence.
  Missing-email and prefers-paper holders appear in a separate paper list.
  “Print letters” combines their selected notice/statement PDFs, with an explicit
  page naming the holder if no per-person attachment was chosen. Shared documents
  remain downloadable from the year's private document store.
- Mailing subject/body are **uniform authored plain text**, identical for every
  real email recipient. No merge fields or per-person names, shares, distributions
  or amounts belong in them. The obsolete `{first_name}`, `{shares}`, and
  `{distribution}` fields are rejected on save and on send, including old drafts.
  Stage B's opt-in signing URL is the sole individualized body exception.
  Only the selected per-holder PDF carries that person's figures. The fixed
  subject/body live in an immutable mailing draft shared by each attempt;
  per-recipient rows contain only address/reply-to and attachment metadata
  (historical attempt-level subject/body columns remain nullable, never filled
  for new sends, so prior records are not hard-deleted).
  There is no HTML editor and only the `text` part is sent to Resend. Resend's
  documented plain-text-only behavior excludes open-tracking pixels:
  https://resend.com/docs/dashboard/domains/tracking. No open events are collected.
- Mailing sender is fixed: **Horace W. Davis Realty Corp. <horace@hwdfarm.com>**.
  Existing sign-in email still uses `RESEND_FROM_EMAIL`; mailing sender is not
  changed by that setting. Reply-to defaults to `peter@loebstone.com`, is validated,
  and can be revised by anyone with active access on the Access page.
- “Send to me first” renders one chosen holder's complete envelope to the signed-in
  session's own email, never a typed destination, with a fixed `[PREVIEW]` prefix
  that contains no holder's name or figures.
  It is the only permitted Stage A send in a practice year; Stage B also allows
  the same self-addressed link and signed-copy receipt. Practice emails have a
  **PRACTICE** body banner; report attachments retain their existing watermark.
  Actual Send AND Resend reject practice years server-side with 403, before Resend.
- Shared attachments use the existing sealed private year-document store and are
  PDF-only. Each email is validated below 40 MB including base64 with conservative
  MIME/header headroom. Sequential sends are separated by 650 ms. There is no
  Resend batch endpoint and no background/scheduled send job.
- Envelopes are preflighted into a private mode-0700 temporary directory, with
  mode-0600 payloads; temporary disk use is the sum of the email envelopes, but
  only one email's attachment bytes are held in memory at a time. Insufficient
  disk space stops preflight before any send. Temporary files are removed in `finally` on
  success/failure. A process crash may leave OS temporary files until the runtime
  is reclaimed; these files are never served or placed in public storage.
- Each reserved recipient stores its reply-to/address
  and attachment filename/size/SHA-256 list before its external send; the batch
  references its immutable authored draft for the one uniform subject/body. The exact
  preflighted bytes are sent (PDFs are not regenerated after reservation). Results
  append the Resend message ID and acceptance timestamp, or an explicit failed/
  uncertain result. Before each send, active access, practice flag, paper preference,
  address and complaint suppression are checked again. Every draft, batch,
  envelope, result, delivery event, setting and preference change is audited.
- **Peter must add `RESEND_WEBHOOK_SECRET` in Replit Secrets** using the signing
  secret for the Resend webhook configured for `/api/mail/webhook`, subscribing to
  `email.delivered`, `email.bounced`, `email.complained`. It is intentionally NOT
  configured by the agent. This is the sole mailing endpoint exempt from browser
  session/Origin checks: exact raw bytes must pass Svix signature and timestamp
  verification before a write. Unsigned/tampered events fail 401; missing secret
  fails 503. Event IDs deduplicate callbacks; out-of-order delivery cannot erase
  a bounce/complaint. All other mailing/settings/paper/print routes use the usual
  Roster, session, access-list and same-origin gates.
- Practice reset still deletes only the allowed practice-year data/files. It
  appends a fresh mailing draft to clear deleted document references, preserving
  preview and audit history.
- Code: `lib/db/src/schema/mailings.ts`; API routes `routes/mailings.ts` and
  `routes/mail-webhook.ts`; services `lib/mailing-*.ts` / `lib/mailings.ts`;
  web `/years/:id/mailing`, linked from year header; reply-to on Access.
- Tests: `pnpm --filter @workspace/api-server run verify:mailings` uses a local
  Roster stub, **mock Resend only**, rollback-isolated tables and real private test
  files. It cannot run in production and never emails Peter. No automatic or
  optional live-email test flag remains. No secret values are logged.

# HWD Cap Table

## Real-year Draft and Final

- Real-year labels are **Draft**, **Final**, or **Final — corrected**. Practice years keep their separate Practice label and watermark, not these labels. API status identifiers stay unchanged.
- Every real Draft year page/subpage has the persistent banner: “Draft — preliminary figures for board guidance. Final figures will follow the Farm's tax filing.”
- Draft figures/costs without sources show `no source document yet (draft)`. The Source figures controls can attach a sealed year document without re-entering an amount. `POST /api/years/:id/figures/documents` requires the expected latest figures revision ID, target gross/cost, cost index when applicable and document ID. It copies the exact amounts/cost labels to new append-only rows with the new source reference, audits every row, refuses stale revisions/cross-year documents, and refuses after Finalize. No stored rows are updated.
- History reads all existing figure/cost and declaration revisions, displaying values, dates and the saving person's access-list display name (original actor ID retained). No new history storage or schema is needed.
- Only the board PDF is available for real Draft years. It has a fixed diagonal **DRAFT — PRELIMINARY** watermark, a preliminary-as-of/tax-filing header, and **Draft** in its filename. Final board PDFs remove these; practice board PDFs retain their existing practice treatment.
- Statements, notices, signing, emailing, ledger writes and accountant workbooks retain their real-year Final-only gates. Practice exemptions are unchanged. Source documents remain required for financial corrections after Final.
- Run `pnpm --filter @workspace/api-server run verify:drafts` for draft entry, source blockers, document-only revisions, history, PDF watermark/header, Final lock and practice regression. Like the other suites, this uses transaction-local rollback fixtures and a local Roster stub; never production.

## Proxy trust and build identity

- `TRUSTED_PROXY_HOPS` is read at API startup: an integer `0`–`8` only. Unset keeps
  the app's previous numeric trust setting, **1**, with a startup log explaining
  that fallback. Invalid/empty values fail startup; never use “trust all”.
- **Set from the production diagnostic line, never guessed.** The production
  value is **4 as of October 29, 2026**, from the main site's observed published
  ingress: socket plus three forwarded proxies before the visitor. Peter sets
  production configuration; agents do not set production secrets/settings.
  This implementation does not silently change the existing default to 4.
- Only `GET /auth/sso` emits the info-level **SSO proxy diagnostic**: complete
  X-Forwarded-For, socket address, resolved request IP, and effective hop count.
  It omits query strings/tickets, cookies and bodies. Startup logs the hop count
  and reason once. Numeric hop trust assumes every ingress path has the measured
  topology; reassess it if ingress changes.
- `GET /api/healthz` returns `{ status, build }`. The API build script embeds
  a UTC ISO timestamp plus eight random hex characters in the server bundle,
  e.g. `2026-10-29T12:34:56.789Z-a1b2c3d4`. It stays constant across restarts of
  that bundle and is logged once at startup as **Application build**.
  Direct-source tests identify themselves as `development-unbundled`.
- Test: `pnpm --filter @workspace/api-server run verify:proxy`; existing
  `verify:sso` and `verify:security` cover their unchanged limiter behavior.

## Farm suite header

- **Peter-set setting:** `SITE_BASE_URL` is the main site's origin. In development,
  Peter sets it to the main site's development origin. For production it is
  `https://hwd-main-site.replit.app` for now, later `https://hwdfarm.com`.
  Agents never set production settings or secrets.
- The server fetches public `GET {SITE_BASE_URL}/api/suite/menu` with a 5-second
  timeout, no redirects, a 128-KB response limit, and a 5-minute in-memory cache
  (including fallback responses). Concurrent refreshes share one fetch.
- Authenticated `GET /api/suite/menu` uses the existing session/active-access gate;
  it exposes navigation only. No session, access, money or mailing changes.
- Unset/unreachable/invalid menus use built-in Home, Announcements, Scheduler,
  Family Directory, Documents, Contact, and Tools links. Site pages use the
  configured origin or `https://hwd-main-site.replit.app`. One warning is logged
  per outage, reset on a successful refresh. Fallback page paths are `/`,
  `/announcements`, `/documents`, `/contact`; Forecast uses
  `https://forecast.hwdfarm.com`, Cap Table `https://captable.hwdfarm.com`.
- Remote `logoSvg` is discarded, not rendered: the header uses a trusted local
  treeline mark. Link schemes are limited to HTTP(S), without URL credentials.
- Tools is visible only with a stored session apps list containing `forecast` or
  `captable`. Current sessions do not store apps, so Tools is hidden; this change
  deliberately does not modify sessions. Cap Table remains marked current.
  Header Sign out invokes the app's existing logout, not the remote signOutHref.
- Test: `pnpm --filter @workspace/api-server run verify:suite-menu`.

Private distribution recordkeeping for Horace W. Davis Realty Corp. (“HWD Farm”), a Massachusetts S-corporation with approximately 47 family shareholders and 400 shares: Classes A, B, C and D, each with 100 shares.

Stage 1 provides delegated passwordless sign-in, shared access management, current Roster holdings, immutable snapshots, persistent tax residence, annual capital-gains rate tables, and an append-only write audit. Stage 2 adds distribution years, private source documents, exact-cent calculations, frozen finalizations, corrections and the cash-paid/APIC ledger. Stage 3 adds shareholder statements, a board summary, the accountant ledger workbook, ZIP downloads and a signed-in home page. Shareholders do not sign in.

## Run & operate

- API workflow: `artifacts/api-server: API Server`; command `pnpm --filter @workspace/api-server run dev`.
- Web workflow: `artifacts/hwd-distributions: web`; command `pnpm --filter @workspace/hwd-distributions run dev`.
- Use the existing artifact workflows, not standalone replacement servers. They supply `PORT` and `BASE_PATH`.
- Web preview is `/`; API prefix is `/api`. Both services belong to this one app/deployment.
- `pnpm run typecheck` — library and application checks.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate the API client and validation schemas after any contract change.
- `pnpm --filter @workspace/db run push` — **development schema only**. Confirm environment and observed database identity first.
- `pnpm --filter @workspace/api-server run verify:stage1` — development-only integration checks using the supplied local Roster **STUB**. The development foundation must be uninitialized (no access entries). All test records are rolled back. PostgreSQL sequence numbers can advance despite rollback.
- `pnpm --filter @workspace/api-server run verify:stage2` — development-only Stage 2 acceptance checks against the **same STUB fixture**, with real private App Storage upload/download. Requires an uninitialized development access list. All database test records roll back; small, clearly labeled storage test files remain private (no hard deletes). Esmond and Holmes acceptance targets were corrected to the formula values with $0.05 tolerance; the original hand-spreadsheet approximations are retained below for context. The suite should exit zero.
- `pnpm --filter @workspace/api-server run verify:stage3` — development-only actual Chromium PDF, ZIP, XLSX readback and export-authorization verification. Recreates the finalized Stage 2 fixture in a rollback transaction; Roster is explicitly a **STUB**, PostgreSQL and App Storage are real development services. All four report routes are checked with anonymous and removed-access sessions. Small STUB inspection outputs are saved under ignored `generated-artifacts/stage3-verification/`.
- Optional visual inspection: after Stage 3 verification, run `uv run python artifacts/api-server/tests/render-report-previews.py` to render the two test PDFs to PNG with the development-only PyMuPDF helper. Python dependencies are managed by root `pyproject.toml`/`uv.lock`; the application and exports themselves are Node/TypeScript, not Python.
- Chromium is a configured Nix system dependency. Runtime PDF creation uses `puppeteer-core` and locates `chromium` on `PATH`; it never downloads a browser at request time. If the dependency is unavailable, PDF export fails explicitly with 503 rather than inventing a file.
- No seeds run at startup. No DDL runs at startup or in publish/build commands.
- Schema reaches the managed production database **only through Publish**. Never push schema or run data writes against production from the agent.
- Never select Publish’s overwrite-data option to copy test data into production.

## Plain secrets: standing service convention

Read outside-service configuration directly from Replit Secrets through `process.env`. Do **not** connect or propose Replit integrations/connections for outside services. Peter stores secrets manually. Do not set production secret values during development or testing.

The security update adds `APP_ORIGIN` to the original six secret names. Peter supplies its actual value through Secrets; examples are not authoritative deployment URLs. Never log its value.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | This project's own runtime-managed PostgreSQL database |
| `SESSION_SECRET` | HMAC protection for the app-specific session cookie |
| `ROSTER_BASE_URL` | Roster HTTP base URL; no direct Roster database access |
| `DISTRIBUTIONS_SERVICE_KEY` | Bearer credential for the two Roster service endpoints |
| `BOOTSTRAP_PERSON_ID` | Only Roster person allowed to initialize a never-used access list |
| `APP_ORIGIN` | Trusted app origin; mandatory HTTPS origin in production; production never infers it from forwarded headers |
| `RESEND_API_KEY` | Plain Resend HTTP API credential |
| `RESEND_FROM_EMAIL` | Verified Resend sender address (required when an API key is present) |
| `NODE_ENV` | Must equal `production` in the published API; controls development-only fallback |
| `PORT`, `BASE_PATH` | Supplied by artifact workflows |
| `LOG_LEVEL` | Optional; defaults to `info` |
| `PRIVATE_OBJECT_DIR` | Runtime-managed private App Storage directory for source documents |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Read by the standard storage helper, but no public document route is mounted |

`DEFAULT_OBJECT_STORAGE_BUCKET_ID` is runtime-managed App Storage configuration; application code does not read it directly. Source documents are private, not publicly served.

Frontend tooling also reads runtime-managed `REPL_ID` and Vite-provided `BASE_URL`. Service secrets never go into frontend code, Vite public variables, API responses, audit records, or committed files.

### Explicit DEVELOPMENT-ONLY behavior

1. **Only when `NODE_ENV !== "production"` and `RESEND_API_KEY` is absent**, the server writes the single-use magic-link URL to its server log instead of sending mail. The browser receives a clear development-only message, not the URL. In production, a missing key yields HTTP 503 and **never** logs a login URL.
2. An unset `ROSTER_BASE_URL` always fails clearly with HTTP 503, in every environment. There is no application fixture/fallback. Verification alone starts a local stub server and points its own test process at it. Test code refuses to run when `NODE_ENV === "production"` and never changes persisted secrets.
3. The exact supplied 47-holder fixture lives under `artifacts/api-server/tests/`, is not imported by application code, and is not seeded into the app. It has A/B/C/D headcounts 2/22/14/9, each Class 100.0000 shares and 400.0000 total. A separate supplemental GA probe verifies residence proposals without changing that base fixture.

## Security update: current behavior

These rules supersede the earlier auth/setup/test-harness descriptions; historical notes remain below.

- **Origin:** `APP_ORIGIN` is an origin only, with no credentials/path/query/fragment. Production requires HTTPS and refuses startup when it is absent/invalid. Magic links and write Origin comparisons use it exclusively, ignoring Host and forwarded headers. Development alone permits the old forwarded-host fallback when unset, with one startup warning that does not print values.
- **Writes:** missing Origin is refused unless `Sec-Fetch-Site` explicitly says `same-origin`. Foreign Origins and cross-site metadata are refused. Browser fetch POST/PUT requests and the native confirmation form supply Origin automatically; JavaScript must not try to set this browser-controlled header. Non-browser clients must supply the trusted Origin.
- **Confirmation:** GET `/api/auth/verify?token=...` only renders a single “Continue to HWD Cap Table” button. It never consumes a token, creates a session or bootstraps. The same-origin-checked POST `/api/auth/verify` receives the token in its body and rechecks Roster, identity, access/bootstrap, 15-minute expiry and single-use. This mitigates link scanners, **not forwarding**: anyone possessing an unused forwarded link can still press Continue. It is not independent recipient identity proof.
- The confirmation page alone uses `Referrer-Policy: strict-origin`: native Chromium form POSTs otherwise send `Origin: null` under `no-referrer` and are correctly refused by the fail-closed check. Only the origin, never the token-bearing query/path, is sent as a referrer. Other app responses retain `no-referrer`.
- Rollback verification also namespaces the advisory write lock per test process; otherwise its long-lived outer transaction would block real development writes for the full test run. The application lock and production behavior are unchanged.
- **Limits:** link requests allow 20/minute/IP plus the existing one-second per-email interval; redemption allows 10/minute/IP and 10/minute/token hash. Counters are process-local, reset on restart, and are opportunistically cleaned without scheduled jobs. They are not shared across instances.
- **Upload sealing:** verify actual metadata (1 byte–20 MiB, matching reservation) and allowed PDF/image magic bytes BEFORE copying. Validation and copying use the same immutable source generation to prevent concurrent PUT replacement. Delete ephemeral staging bytes on rejection and seal success; never delete attached documents or business/audit rows. Abandoned uploads, failed cleanup and staging recreated using a still-valid PUT URL may remain; there is no scheduled cleanup. The signed PUT itself is not byte-limited.
- **Headers:** API and web responses set CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, self-only forms, `base-uri 'none'` and `object-src 'none'`. UI CSP permits bundled scripts, inline styles, Google Fonts and direct Google Storage uploads. Development additionally permits Vite inline preambles/HMR websockets; production disallows inline scripts. Strict anti-framing intentionally blocks embedded previews: open development in a top-level browser tab.
- **Web server:** Vite supplies development headers; production serves the existing frontend build through `artifacts/hwd-distributions/server.mjs` and `security-headers.mjs`, not headerless static hosting. The server binds the artifact PORT. API and web production run configurations explicitly set NODE_ENV=production. No production secrets were set during development.
- **Verification:** the original `pnpm --filter @workspace/api-server run verify:stage1`, `verify:stage2`, `verify:stage3` commands remain; also run `pnpm --filter @workspace/api-server run verify:security` and root `pnpm run typecheck`. All use labeled local Roster stubs and send no email. The suites now shadow public tables with transaction-local temporary tables, preserving indexes/checks/foreign keys/triggers and using independent temporary sequences. They roll back without modifying the Farm's development records or sequences; an empty access list is no longer required despite older notes below.
- **Evidence:** focused oversized/wrong-type rejection probes are labeled storage mocks; Stage 2 checks actual private storage, staging cleanup and an unsigned sealed-object fetch. Sealed, labeled test documents remain private. `tests/browser-security-harness.mjs` is a development-only loopback helper using the production-built UI, temporary tables and stub Roster, never a runtime service. It captures only Origin presence/match booleans, never token values, and rolls back on SIGTERM.

## Rates CSV import and download

- Rates retains the existing manual/full-table editor and prior-year copy unchanged. The header Import CSV control can choose an existing or new tax year; each year also has Import CSV and Download CSV controls.
- CSV headers are `code,rate,source_note` (all three required). `csv-parse` parses on the server, including quoted commas, doubled quotes and multiline notes. Codes must be FEDERAL, NONE, or a recognized US state/territory code; `XX` is not valid. Source-note values are optional, as in the manual editor; keep the header even when values are blank. Duplicate codes and invalid rows reject the entire file with physical-line errors. The UTF-8 file limit is 65,536 bytes.
- Decimal fractions and explicit percentages are accepted. Conversion and half-up rounding to numeric(6,4) use integer arithmetic, not floating point; preview displays the actual four-decimal value. Rates outside 0–1 are rejected before rounding. NONE must be zero.
- Preview performs no writes. Its signed, actor/file/year/current-table-bound confirmation expires after 15 minutes. Confirm reparses the original CSV server-side, rechecks access, serializes with other writes, rejects a stale preview and applies everything in one transaction. Neither preview tokens nor file contents are logged.
- Changed/new codes (including changed source notes) each append one `rate_code_revisions` record and one audit row. A changed import appends one `rate_imports` record and one audit entry naming the filename and total/changed/unchanged row counts. An entirely identical import appends **nothing**, including no audit/import record. Codes absent from the file are never removed.
- Manual revisions remain full snapshots in the existing tables. CSV code revisions overlay the latest manual snapshot; a later manual save supersedes earlier overlays without modifying them. CSV-only new years are supported when FEDERAL is supplied. All effective-rate reads, copies and draft distribution calculations use the shared resolver. Finalized distributions keep their already-frozen inputs.
- A CSV-only year's API table ID is a negative virtual identifier, not a foreign key. Distribution finalization stores the complete effective rate input; it never relies on this virtual ID to reconstruct rates.
- Routes: POST `/api/rates/csv/preview`, POST `/api/rates/csv/confirm`, GET `/api/rates/:taxYear/csv`. All are behind active Roster/session/access checks; both POSTs use the existing same-origin check. The original upload is transient, not retained as a file; its filename, counts and changed values remain in append-only records.
- Implementation: `src/lib/rate-csv.ts` parses/signs/exports, `src/lib/rate-data.ts` resolves current rates, `src/routes/rate-csv.ts` serves the endpoints (all under `artifacts/api-server/`). `lib/db/src/schema/rate-imports.ts` defines the two additive tables; `artifacts/hwd-distributions/src/components/rates-csv-import.tsx` supplies the preview/confirm UI.
- Verify: `pnpm --filter @workspace/api-server run verify:rates-csv`, plus existing stage/security suites and root typecheck. Uses the same development-only local Roster stub, temporary tables and rollback. Includes four-row acceptance data, no-op, rejection-before-write, CSV round-trip, quoted/multiline notes, stale-preview conflicts, access refusal and a forced mid-import rollback.
- Database changes are applied to development only. Publish is the only route for these additive schema changes to reach production; no startup/build DDL or production writes are added.

## Practice years

- **Draft/practice source-document policy:** draft gross figures and cost lines may omit a document or send null in either kind of year. At Finalize, the persisted `is_practice` flag exempts practice years only; real years require every source and list missing figure/cost names. A provided document ID must belong to the year, even in practice. Missing practice sources display `no source document (practice)` in figures and `none (practice)` in board PDFs; real draft sources display `no source document yet (draft)`. Nullable practice references survive finalization/reset; corrections retain their existing document requirements. Writes remain append-only and audited. `verify:practice` covers omitted/null sources, real Finalize refusal, spoofed flags and board PDF text labels; `verify:drafts` exercises the full real-year draft-to-Final flow.

- `distribution_years.is_practice` defaults to false and is set only on creation. There is no year-update/conversion API or SQL UPDATE path for it. Neither practice nor real years can be converted. A partial unique index permits only one **real** year per calendar year; any number of practice years may coexist, including alongside that real year.
- Open a year using the Practice year checkbox. Practice uses the exact same snapshot validation, rates, tax residence, documented figures, declarations, financial calculations, finalization locks/blockers, corrections, payments and holds as real years. Snapshots, rates and residences remain shared permanent inputs; a reset never modifies them.
- Real-year API lists (`GET /api/years`) exclude practice server-side. `GET /api/practice-years` lists only practice. Home and Distribution years have separate practice sections. No existing cross-year financial aggregate exists; future real-year aggregates must explicitly filter `is_practice = false`.
- Every practice year detail is titled `<year> — Practice` and carries the persistent banner **Practice year — nothing here is a real distribution**. All year operations, documents, statements and ledger controls live on that detail page.
- Every practice statement and board PDF has the diagonal, selectable-text **PRACTICE — NOT A STATEMENT** watermark, implemented as a fixed print element for every page. Practice PDFs, ZIP and XLSX filenames include `Practice`; every statement inside a practice ZIP does too. Each XLSX sheet has a first-row **PRACTICE** banner, with headers/freeze/filter shifted down and numeric currency cells retained.
- Reset requires typing exactly `RESET`. POST `/api/years/:id/reset-practice` rechecks active access under the common write lock and loads the **persisted** practice flag; it never trusts a client flag. A real-year attempt is 403 and commits a refusal audit, even if its confirmation body is invalid. Missing/incorrect confirmation for a practice year is 400 and changes nothing.
- **Sole business-record hard-delete exception:** practice reset removes every figure revision, its cost lines, all document/upload reservations and their sealed/staging files, declaration revisions, finalization, corrections, ledger entries/reversals and explicit holds. It retains the year, immutable practice flag, original snapshot/rows, rates, residences and **all previous audit entries**. The result is a freshly-opened draft (unsettled snapshot holders still default to held).
- A successful reset appends exactly one audit entry with actor, timestamp, calendar year, snapshot ID and counts for each deleted record type and stored files. Repeating an empty reset is allowed and also audited. Real reset refusal appends one audit entry and deletes nothing.
- Storage and PostgreSQL cannot share a transaction. Files are removed first, before database deletions; a storage failure explicitly fails the reset with database records retained. Some files may already have been removed: retry reset to complete cleanup (missing objects are accepted). A rare database failure after file deletion likewise requires retry; reset must never be reported successful on an error. A still-valid abandoned PUT can recreate staging after cleanup; it cannot be attached after its reservation is reset, and there is no scheduled cleanup.
- Implementation: `artifacts/api-server/src/lib/practice-years.ts` is the only business SQL DELETE path; the private file deletion helper is used only there after the server-side guard. It never deletes the year, snapshot or audit log. The reset UI is `artifacts/hwd-distributions/src/components/practice-reset.tsx`.
- Verify: `pnpm --filter @workspace/api-server run verify:practice` plus `verify:stage1`, `verify:stage2`, `verify:stage3`, `verify:security`, `verify:rates-csv` and root `pnpm run typecheck`. Practice checks use the supplied Roster **STUB**, transaction-local temporary PostgreSQL tables, real Chromium/Excel and private App Storage. They inspect PDF text watermarks, all 47 ZIP PDFs, each workbook banner, actual file deletion, retained snapshot, audit counts and real-year refusal. Temporary DB rows roll back; only guarded practice reset removes practice files. Existing real-year verification files remain private.
- This feature's schema changes are applied to **development only**. They reach production only through Publish; no production DDL, startup migration or automatic reset is added.

## Product rules

- This is a separate Farm app: its own project database, deployment and cookie (`hwd_distributions_session`). It shares no code, cookies or database with any other Farm app. Local `lib/` packages belong only to this project.
- All business endpoints enforce a valid, fresh authenticated session **and** current local access on the server for every request. Roster identity is established at sign-in, not re-authorized on each request. Public exceptions include health, sign-in request/verification and the ticket/navigation routes listed in the SSO section; none disclose business data.
- No roles or officer titles. Every active person can add or remove another person; removal of the last active person is refused in a serialized transaction.
- Bootstrap is possible only when the access list has never been initialized and the **verified** Roster identity exactly matches `BOOTSTRAP_PERSON_ID`. Merely requesting an email does not create access.
- Money is integer cents (`bigint` database columns, signed integer strings over JSON). No floating-point money or share arithmetic: shares are four-decimal strings and `numeric(10,4)` snapshot values, with BigInt units for sums. Rates are `numeric(6,4)` and four-decimal fraction strings; display conversion is exact. No rates are baked into application data.
- No bank, card or account fields.
- No scheduled jobs, automatic year changes, date-triggered transitions or cleanup jobs. Expired links/sessions fail checks when requested; no rows change on an expiration date.
- No application hard deletes or updates, **except the explicitly confirmed, server-guarded practice reset described above**. Otherwise every stored application write is an INSERT and receives an audit INSERT in the same transaction. Access removal, tax-residence correction, rate correction, link consumption and session revocation are new rows. Audit insertion does not recursively audit itself.
- Append-only behavior is enforced by the application write surface: no edit/delete snapshot endpoints or SQL UPDATE paths; SQL DELETE is limited to practice reset. Database-owner access is privileged and must follow the same retention rule; this is not a tamper-proof ledger against the database owner.
- Snapshots and their individual rows are immutable, with the original Roster `asOf`, reported Class summaries and row values. Taking a snapshot references the exact stored fetch the person viewed, not a second fresh request.
- Each person has one **logical current** tax-residence record. History is append-only; the highest revision id for a person is the current value. Proposals come from addressState only on the first encounter; later fetches never overwrite a confirmed choice.
- US state/DC address codes propose that code. A non-US address code (including UK) proposes NONE. A null/blank addressState yields a missing state (`null`), not NONE. All proposals are unconfirmed.
- Residence confirmation stores the acting person and time. Corrections require a note. Values persist across tax years.
- One logical rate table per year, with append-only revisions and one row per entered state code in each revision. Federal and state source notes are optional. NONE is valid only at zero. Copying a prior table preserves rates and source notes exactly, creates new rows in a later year and accepts an optional new note. Copy cannot overwrite an existing destination year.
- Class headcounts are displayed plainly and are never a warning or blocking condition. Exact share totals are validated against rows and the grand total.
- Nothing private is “secured” by hiding it in React; the API withholds it.
- Every report must state **ENVIRONMENT** and the observed results of `SELECT current_database(), inet_server_addr()`. Development and production can have the same default database name. SQL NULL server address is reported as such, not guessed. The signed-in app displays this identity.

## Roster contract (HTTP only)

These service calls use `Authorization: Bearer {DISTRIBUTIONS_SERVICE_KEY}`.
SSO additionally uses the ticket redemption endpoint documented at the top of
this file. This app never writes Roster business records or queries its database.

### `POST {ROSTER_BASE_URL}/api/service/sign-in-check`

Request: `{"email":"..."}`.

Response: `{"allowed":true,"personId":"...","displayName":"..."}`. A denied response can omit or null the identity fields. Access-list additions resolve the email through this endpoint; identity fields are never trusted from the browser. The email back door uses this endpoint only when it has no previously verified local email/person mapping, and still requires active local membership. It never bootstraps. Redemption checks mailbox possession and active local membership again. Ordinary protected requests use the established session identity and current local access, not a new Roster authorization call. Roster SSO alone retains the original exact-person, never-initialized bootstrap exception.

### `GET {ROSTER_BASE_URL}/api/service/holdings`

```json
{
  "holdings": [{
    "personId": "...",
    "displayName": "...",
    "shareClass": "A",
    "shares": "50.0000",
    "isUnsettled": false,
    "note": "",
    "addressState": "CT"
  }],
  "classes": [
    {"shareClass": "A", "totalShares": "100.0000", "holderCount": 2}
  ],
  "grandTotal": "400.0000",
  "asOf": "..."
}
```

The example above illustrates field shapes, not a complete response or application data. Actual responses include all four distinct Classes A–D, four-decimal share/total strings, current holdings only, and nullable addressState. `note` can be string or null. Duplicate person/Class rows and inconsistent exact share totals are refused; reported headcounts are retained, not treated as eligibility rules. Each successful on-demand fetch is stored whole and creates missing tax-residence proposals in one transaction.

## Where things live

- `artifacts/hwd-distributions/src/` — React application, pages, forms and shared UI.
- `artifacts/api-server/src/app.ts` — Express assembly, cookie parsing, same-origin write checks, no-store responses and safe errors.
- `artifacts/api-server/src/lib/auth.ts` — signed app-specific cookie, database session validation and live authorization gate.
- `artifacts/api-server/src/lib/roster.ts` — only Roster HTTP client, strict holdings validation and BigInt share arithmetic.
- `artifacts/api-server/src/lib/records.ts` — serialized append/audit transaction helpers.
- `artifacts/api-server/src/lib/distribution-math.ts` — exact rational calculations and Class-total checks.
- `artifacts/api-server/src/lib/distribution-years.ts` — draft/frozen year read models, explicit corrections and history.
- `artifacts/api-server/src/lib/year-document-store.ts` — private staging uploads, immutable sealed copies and PDF/image signature verification.
- `artifacts/api-server/src/lib/reports/` — consistent read-only report context, HTML templates, Chromium rendering, exact formatting and numeric workbook generation.
- `artifacts/api-server/src/routes/reports.ts` — private individual statements, statement ZIP, board summary and ledger downloads.
- `artifacts/hwd-distributions/src/pages/home.tsx` — signed-in home page; no automatic Roster fetch.
- `artifacts/hwd-distributions/src/components/year-exports.tsx` — year-page export controls; `download-button.tsx` handles binary downloads, server errors and revoked-session cache clearing.
- `artifacts/api-server/src/routes/` — auth, access, holdings/snapshots, residences, rates and recent audit endpoints.
- `lib/db/src/schema/` — Drizzle source of truth; decimal precision, unique row constraints and foreign keys.
- `lib/api-spec/openapi.yaml` — API contract; generated hooks and Zod schemas in `lib/api-client-react` and `lib/api-zod`.
- `artifacts/api-server/tests/` — **STUB-only** fixture and rollback verification; never an app data source.

## Authentication details

Resend is called directly over HTTPS. Magic links use cryptographically random tokens; only token hashes are stored, expire after 15 minutes, and can be consumed once. Bootstrap occurs only at successful redemption. Session tokens are random, signed with SESSION_SECRET and hashed in the database; sessions last 12 hours and logout appends a revocation. Cookies are HttpOnly, SameSite=Lax, path `/`, and Secure in production. All private API responses are no-store. Cross-origin browser writes are refused. The API rate-limits sign-in attempts; it never logs credentials, cookies or login URLs in production.

## Verification status

The Stage 1 suite exercises the actual Express routes, Roster HTTP client and development PostgreSQL writes using a labeled local Roster stub. It verifies requested checks (a)–(f), missing configuration, last-person protection, live Roster revocation, link reuse rejection, UK/missing residence handling, append-only corrections, snapshot permanence, per-record audit coverage, zero-only NONE, logout and the forbidden production mail-log fallback. All test-domain records are rolled back. Real Roster integration and Resend delivery require Peter's development secrets and remain separate live-service checks.

## Stage 2: distribution-year and ledger rules

- One `distribution_years` record per calendar year. Opening fixes the selected snapshot permanently; each of A/B/C/D must total exactly 100.0000 and all rows 400.0000. An incorrect Class is named with its exact shortfall/excess. Holder counts never block opening.
- A rate table must already exist for the year. Opening offers a prior-year copy in the UI. Draft calculations use that year's latest rate revision and each snapshot holder's latest residence, including unconfirmed proposals. Missing residence/rates make the proposal unavailable rather than silently assuming zero.
- Gross figures and cost lines may be entered without source documents while drafting. Real years require every source document at Finalize, not at entry; practice years remain exempt. Draft revisions append new figure and cost rows; old rows remain. Documents are PDF/PNG/JPEG/GIF/WebP, at most 20 MB, with filename, upload date and uploader.
- Documents upload directly to a private staging URL. Attachment copies the bytes to a fresh, server-only object key and verifies size/file signature. Reusing the staging URL cannot modify the sealed document. Files are stored in App Storage, metadata in PostgreSQL; there is no public object/file route. Download requires a fresh authenticated session and active local access and is `private, no-store`. Multiple documents per year are allowed. No automatic object cleanup or hard deletes.
- Exact formula: proposed cents = `net cents × (federal rate + highest holder state rate) ÷ 400`, rounded to integer cents. Highest rate considers only the holders of this fixed snapshot, using their current confirmed or proposed residence. All intermediate arithmetic is BigInt rational arithmetic. Rounding is half away from zero.
- The proposed amount is advisory. A person must explicitly record the declared integer cents per share and declaration date; that declared amount governs nominal distributions. Calendar dates are validated, but no dates trigger state changes.
- For each distinct person, shares across Classes are aggregated exactly before rounding: nominal = declared cents × shares; gain = net cents × shares / 400; estimated tax = exact unrounded gain × (federal + own state rate); surplus = rounded nominal minus rounded estimated tax. Gain display alone rounds to cents, not the intermediate tax input. No per-person distribution amount is editable.
- Reconciliation shows sum of rounded nominal amounts, declared per-share cents × 400, and residual (sum minus expected). Rounding residual is displayed, not silently allocated to someone.
- Finalization requires figures, a declaration, every snapshot holder's confirmed nonmissing residence with a matching rate row, and (real years only) a source document for gross and every cost line. Missing sources are listed together as `Source document missing for: <names>` alongside the other blockers. The UI shows these reasons. Finalization stores immutable copies of the exact snapshot rows, rates and their revision id, residences and their revision ids, figure/cost values, declaration amount/date and original snapshot `asOf`.
- Later Roster fetches, snapshots, rate revisions and residence revisions do not alter a finalized year. Draft figures/declarations and repeated finalization are refused after the lock.
- **Correction interpretation:** corrections append to a finalized year, never replace the frozen inputs. Note-only corrections are allowed. Monetary corrections are explicit signed **deltas** to gross, total cost, or declared cents per share; gross/cost corrections need an attached source document and declaration adjustments need a declaration date. Correction notes are optional, including note-only entries. The original calculation stays visible; effective figures use only the frozen snapshot/rates/residences plus those explicit deltas. Status becomes `corrected`. Negative effective gross/cost totals/declarations and corrections reducing nominal below already-paid-plus-retained are refused.
- Cash and APIC entries are permitted only after finalization. Cash records positive cents, payment date and free-text method/check number. APIC records positive cents, the **direction-letter-received date**, and an optional note. There are no financial account identifiers.
- Remaining = nominal − cash − APIC. Any entry exceeding remaining is refused under the same serialized transaction lock used for every write. A positive entry can be reversed once by a new exact negative entry linked to it, with an optional note and required reversal date. Arbitrary negative payments and reversal-of-reversal are refused; original entries remain visible.
- Status is `complete` whenever remaining is zero; otherwise `held` for a manually noted hold (or the default from an unsettled snapshot row); otherwise `open`. Holds/releases are append-only and noted. Held is a status marker, not an extra authorization rule; recording a valid paid/retained entry does not require silently altering the hold.
- All new database records are appended and audited inside the same transaction. Year and payment writes recheck local access inside the serialized transaction; the shared middleware checks live sessions and active local access on every request, including all source-document routes. Only sensitive actions apply the 15-minute authentication freshness gate.

### Stage 2 acceptance-figure resolution

The specified acceptance inputs yield exactly 7,782.5 cents proposed, rounded to **7,783 cents ($77.83)** declared per share. With that declaration and the specified CT/NONE rates:

| Holder | Exact nominal | Rounded estimated tax | Corrected acceptance surplus | Original approximate example |
| --- | ---: | ---: | ---: | ---: |
| Esmond Robert III | $3,891.50 | $3,023.63 | **$867.87** | $866 ± $1 |
| Holmes Brette Kameny | $1,245.28 | $660.00 | **$585.28** | $584 ± $1 |

The user confirmed that the formula was correct and the original two examples were approximate, reverse-engineered from a hand spreadsheet. The acceptance figures for Esmond and Holmes were therefore corrected to **$867.87 and $585.28**, each with **$0.05 tolerance**, computed from the declared amount. Rates, declaration and calculation code were not changed to force a pass. The remaining requested surplus examples retain their original $1 tolerance. CA near-zero surpluses and both unsettled holds are checked separately. Signed-in UI rendering is not verified by an anonymous screenshot; authenticated route tests verify the underlying behavior without weakening authentication.

## Stage 3: statements, summary, accountant export and home

- The signed-in root `/` is a plain home page showing the latest **stored** holdings Class summaries, shares and headcounts; distribution years with status; and links to Holdings, Tax residence, Annual rates, Access list and Audit log. It does not invent holdings or automatically call the Roster. `/holdings` remains available.
- Reports are reached from each year page. Real-year individual shareholder statements, the ZIP and accountant workbooks require a finalized/corrected year (draft requests are refused with 409). Board summaries are also available for open real years. Practice years allow all four export types at any stage, including before figures/declaration. Missing draft declarations are shown as missing/blank or “not yet declared”, not silently treated as a declaration of zero.
- Every report endpoint is behind the same live Roster-plus-local-access server gate as other business routes. Local access is checked again before releasing generated bytes, including after a longer ZIP generation. No role, officer name or officer title is introduced. No bank/card/account fields are introduced. All downloads are `private, no-store`, with attachment filenames.
- Generation is **read-only and on demand**: a repeatable-read database transaction captures one consistent year/ledger context, the observed `SELECT current_database(), inet_server_addr()` results and generation time. Rendering happens after that transaction closes. All 47 ZIP statements share the same captured context and UTC generation date. No year, ledger, audit or financial record is changed by reading/exporting; there are no scheduled jobs or date-triggered changes.
- Export bytes are generated in memory and downloaded; no PDF/ZIP/XLSX bytes are stored in PostgreSQL or as persistent deployed local files. Existing source documents remain private in App Storage. This stage does **not** add an archive of past generated statement versions; the permanent input, correction and ledger histories remain append-only.
- PDFs are actual HTML templates rendered by **headless Chromium**, never a substitute PDF renderer. Both statement and board summary are one-page US Letter documents. Print scaling fits the complete content; if content would require scaling below the readability floor, the route explicitly refuses with 409 rather than truncating or silently creating multiple pages. Two simultaneous PDF batches are allowed; further requests receive a clear 429. A batch closes its browser in `finally`.
- Each shareholder statement is issued by **Horace W. Davis Realty Corp.**, names only that shareholder, and includes the year, Class/shares, net timbering profit, declared amount/date, nominal distribution, federal/state estimated tax with both rates and state, dated cash/APIC/reversal entries, paid/retained totals and remaining amount. It renders no free-text methods, internal notes, hold notes or correction notes that could mention a different shareholder. Federal and state components round independently; any cent difference from the recorded combined-tax total is displayed explicitly as a rounding adjustment.
- Every statement contains this caveat **in full**: “This is an estimate at the highest rates the Corporation plans on. Your own return may differ, and the Corporation does not give tax advice.”
- Use **“time frame”**, not “window”, when describing a span of time in product/report copy.
- The board summary shows the figures with source filenames; proposed worked arithmetic; declaration/date; reconciliation/residual; nominal/paid/retained/remaining totals and status counts; and all shareholder rows (name, Class, state, shares, nominal, estimated tax, surplus, status). Class headcounts appear plainly and are never flagged.
- The workbook has `Ledger` (one row per cash/APIC/reversal entry), `Shareholder summary` (one row per holder plus numeric totals) and `Report information` (environment, observed identity, status, snapshot, date semantics and generation time). Monetary/share arithmetic remains exact BigInt arithmetic. **Required Excel numeric-cell serialization is the only floating-point conversion boundary**, after calculation; currency cells are numeric dollars with two-decimal formatting, shares have four decimals. Values exceeding Excel's 15-digit precision or failing exact display round-trip are refused, not silently rounded. Dates are real Excel date cells. Reversed APIC rows keep the original letter-received date alongside the reversal's entry date.
- Every PDF and the workbook metadata state **ENVIRONMENT** and observed database/server identity. SQL NULL remains “SQL NULL”, never an inferred hostname.
- Filenames use the UTC generation date (not the declaration/payment date):
  - `HWD_Distribution_<year>_Statement_<LastName>_<FirstName>_<yyyy-mm-dd>.pdf`
  - `HWD_Distribution_<year>_Board_Summary_<yyyy-mm-dd>.pdf`
  - `HWD_Distribution_<year>_Ledger_<yyyy-mm-dd>.xlsx`
  - ZIP: `HWD_Distribution_<year>_Statements_<yyyy-mm-dd>.zip`
- **Explicit filename inference:** the Roster contract provides only `displayName`, not structured first/last names. Matching the supplied surname-first fixture, the first token is inferred as LastName and the second as FirstName; the full name remains unchanged inside the PDF. Filename components are sanitized. If two inferred filenames collide, ZIP generation refuses instead of replacing a statement. This inference should be revisited if the Roster starts supplying structured names or changes its naming convention.
- The distinct app cookie remains **`hwd_distributions_session`**. This app does not share another Farm app's cookie, database, code or deployment. All six manually managed service/session secret names remain documented above: `ROSTER_BASE_URL`, `DISTRIBUTIONS_SERVICE_KEY`, `BOOTSTRAP_PERSON_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SESSION_SECRET`.

### Stage 3 verification coverage

The Stage 3 suite reconstructs the exact 47-holder Stage 2 fixture, including Natalie GA, confirmed residences, specified rates, $110,000 net profit, $77.83 declaration, Forster's cash/APIC/full cash reversal, and a note-only correction. It confirms:

- Forster's PDF has one page, nominal $1,556.60, estimated federal $825.00 and MA tax $275.00 (combined $1,100.00), the complete caveat, relevant dates/balances and no other shareholder name—even when her internal ledger notes/method contain other names.
- Open and finalized board PDFs have one page; the final summary includes 47 shareholder names/rows, source filename, all totals, Class headcounts and the −$0.02 residual.
- The XLSX reopens successfully; every entry's amount/date/note/id and every holder's paid/retained sums match database rows; numeric summary totals match the recorded calculation.
- The ZIP contains 47 distinct PDFs, all one page, each naming only its own shareholder and carrying the full caveat.
- Every report route returns 401 anonymously and 403 to a Roster-allowed but locally removed person. Real draft statement/ZIP/workbook generation is refused; practice draft previews are allowed. The year/ledger record is identical before and after all exports.
- All fixture database writes roll back, never hard-delete. Generated visual-inspection files are test-only and excluded from Git and Publish; small labeled storage source fixtures remain private. Real Roster/Resend verification remains separate.

## On-demand backup

New downloads use `HWD_CapTable_<environment>_Backup_<timestamp>.zip`; the SQL
member uses `HWD_CapTable_<environment>_<timestamp>.sql`. Timestamp formatting
is unchanged. Only newly generated backup filenames use this prefix; existing
backups and all other paths, identifiers and configuration names are untouched.


- **Write history header → Download backup** opens an access-checked confirmation page.
  GET never exports or writes. Its origin-preserving referrer policy lets the
  native confirmation form send a same-origin POST to `/api/backup`. Both routes
  require the usual valid fresh session and active local
  access. Foreign or missing origin metadata is rejected by the existing CSRF
  middleware. No raw token or configuration is put into the link.
- The browser downloads directly, without a JavaScript Blob. The server streams
  an uncompressed ZIP; neither an archive nor a temporary dump is stored.
  `backup.ts` coordinates it; `backup-postgres.ts` handles the logical SQL.
- Contents: environment/timestamp-named plain SQL, every attached sealed source
  document as `documents/<yearId>/<documentId>_<safe original filename>`,
  `manifest.json`, and `RESTORE.md`. The manifest records observed database
  identity, every physical table count, document bytes and original private
  object-path mapping, optional Git commit, and exact SQL/archive byte counts.
  The latter counts are fixed-width decimal strings to preserve ZIP length
  between passes. Upload reservations are database rows; abandoned staging
  objects are not attached source documents and are not included.
- A dedicated repeatable-read transaction exports a PostgreSQL snapshot.
  `pg_dump` uses it, including schema/data, constraints, indexes and sequences
  while omitting ownership/grants. Its connection credentials are passed only
  in child-process environment, never argv, output, or logs. If unavailable,
  the catalog-based exporter preserves this app's ordinary tables, enums,
  serials, defaults, nullability, constraints and indexes, with text-preserving
  cursor batches. It refuses unsupported views, routines, user triggers,
  partitions/inheritance and identity/generated columns rather than silently
  producing an incomplete backup. The configured PostgreSQL 16 tools are
  available in this development runtime.
- The common application advisory write lock is held for the export so practice
  reset cannot remove a source file during download. Object generations are
  pinned. An audit connection is reserved before locking to avoid pool
  starvation. Writes may wait during a backup; reads remain permitted.
- A counting/credential-check pass is streamed to a discard sink before any ZIP
  response headers. It rejects archives above **500,000,000 bytes (500 MB)**,
  then regenerates from the same snapshot/files and streams with backpressure.
  The delivered stream is checked again. Memory is bounded by stream buffers
  and directory/manifest metadata, not SQL/document contents. There is at most
  one backup per server process, a ten-minute request deadline and a safe
  100,000-document directory limit, each failing explicitly.
- No runtime configuration, raw email/session tokens, service credentials or
  environment variables are serialized. Hashed authentication records and
  ordinary business identity IDs/email addresses ARE part of the complete
  database and remain private. Configuration names and raw authentication
  credentials are checked in the output; a match rejects the backup rather
  than modifying its data. SQL `PRIMARY KEY`/`FOREIGN KEY` are necessary schema
  syntax, not leaked keys. Backups must be handled as private family records.
- Exactly one `BACKUP_DOWNLOAD` audit event records actor, timestamp, bytes,
  environment and document count after successful streaming. Its own event is
  necessarily later than the exported snapshot; the live audit table gains
  that one row after the manifest's point-in-time count. Failed/aborted
  downloads are not completed backups. No scheduled task was added.
- Verification: `pnpm --filter @workspace/api-server run verify:backup`.
  Uses the development database read-only for the full-data dump; authentication
  and audit writes use temporary test tables that roll back. It creates only
  randomly named scratch databases, restores the unchanged SQL with `psql`
  and checks every table against both manifest and source. A separate scratch
  fixture uses the local Roster stub and a real private practice source image;
  its ZIP bytes must equal the stored object. The catalog engine, Unicode/
  quoting round-trip, size-cap rejection, audit count, and anonymous/inactive/
  cross-origin refusals are exercised. Scratch databases are dropped, and the
  practice fixture's file is removed only through the guarded practice reset.
  No real Roster call or email is needed. This test requires development
  `CREATEDB` permission and PostgreSQL client tools; never run it in production.

## Tax-residence confirmation

- Tax-residence notes are always optional, including confirmation and correction.
  There is no required reason field. A proposed state can be confirmed directly
  with one click; Review retains the optional note and state editing controls.
- Unconfirmed residences sort first, then alphabetically. Confirm all unconfirmed
  shows the number and per-state counts before submission. It appends one
  confirmed revision per current proposal with a state in one transaction,
  preserving notes and recording actor/time/state in each audit event, plus one
  batch summary audit. Missing states are skipped and named in the result.
- The preview submits immutable revision IDs; a concurrent change returns 409
  with no writes, prompting a fresh review rather than confirming unseen states.
  Direct UI confirmations/corrections also pass their expected revision ID.
  An empty eligible set is a no-op with no audit entry. No schema changes or
  hard deletes; existing access and same-origin checks remain enforced.
- Verify: `pnpm --filter @workspace/api-server run verify:residences`. The local
  Roster stub supplies 47 rows, 45 proposed states and 2 missing states. Fixture
  writes roll back; no real Roster call or email is sent.

### Distribution display vocabulary and Hold instruction

The year shareholder grid uses exactly: Holder | Class | State | Shares | Allocated Profit | Distribution | Estimated Tax | Surplus/Deficit | APIC | Paid | Instruction. Remaining is not a shareholder-grid column; it remains available in the ledger/payment records. Reports and workbook summaries use Allocated profit, Distribution, Estimated tax, Surplus/Deficit, APIC retained and Paid. Negative amounts use a minus sign, not parentheses. Financial formulas, integer-cent arithmetic, frozen inputs and historical rows are unchanged.

Instruction is Pay by default, Hold while an explicit or snapshot-unsettled hold is active, or ✓ once Paid plus APIC retained equals Distribution. Completion takes precedence for the displayed instruction; the independent hold flag still prevents new cash/APIC entries. Hold changes accept optional notes and append a new audited row; an unsettled snapshot flag is clearable only through such an explicit remove-hold entry. Reversals remain available to correct existing entries. Legacy internal status and amount field names remain for compatibility but are not display labels.

The server rejects a new cash/APIC entry on Hold with “This holder is on hold — remove the hold first.” A Hold statement omits payment rows, dates and amounts, and instead uses exactly: “Your distribution is being held pending resolution; the Corporation will be in touch.” That required sentence is the sole intentional exception to the no-obsolete-“held”-wording scan; stored free-text history is never rewritten. Board counts read “on hold: n, paid in full: n, to pay: n”; APIC/Paid total cells are blank until a ledger entry exists.

### Practice previews and ledger before finalization

The immutable practice flag is loaded from the database, never trusted from a request. Practice statements (individual/ZIP), board PDFs and ledger XLSX are available at any stage, even immediately after opening/reset. The PDFs retain their per-page PRACTICE watermark; every workbook sheet retains its PRACTICE banner. Missing data stays “Not recorded”/blank, never invented zeroes.

An undeclared practice statement says “not yet declared”, separately shows the proposed per-share/distribution amounts when calculable, and labels its tax estimate as proposed. The existing tax formula remains net profit × shares ÷ 400 × the holder's rates; a proposed distribution does not become taxable profit. Real-year finalization requirements and statement refusal text remain unchanged; real workbooks are also guarded server-side.

Practice cash/APIC entries, reversals and holds may be recorded while draft. Cash/APIC requires a declared per-share amount so its existing cap has a defined basis; Hold, positive-entry, reversal-date and append-only/audit checks remain enforced. A draft declaration that would undercut existing Paid plus APIC is rejected atomically. Corrections still require finalization, and practice finalization still requires the ordinary residence/rate/input checks. Verify with `verify:practice`, `verify:stage3` and the workspace typecheck.

### Standing rule: no mandatory explanatory text

No action may require a reason, note or comment to be typed. Notes remain available but optional for snapshots, opening years, figures, declarations, finalization, corrections, hold/remove-hold, reversals, tax residence, access addition/removal, and rate saves/copies. Federal/state source notes (manual and CSV), cash method/check number, and cost descriptions are also optional; an undescribed cost uses the neutral label “Direct cost”. Omitted explanatory text is saved as an empty string (cash method as null), without changing historical rows. Every write remains audited with actor, time and operation.

The sole typed confirmation phrase is exact uppercase RESET for practice reset. Structured business inputs such as email identity, year, amounts, dates, state/rate codes and required real-year documents remain validated. A disabled action must explain why beside it in plain words, not only through a tooltip; missing declarations/residences/rates still block finalization with named reasons. Notes must never gate a button. This rule supersedes older required-note descriptions.

Run `pnpm --filter @workspace/api-server run verify:notes` for blank/omitted notes across the endpoints, plus `verify:stage2`, `verify:practice` and root `pnpm run typecheck`. Tests use a local Roster STUB and temporary tables rolled back afterward; they never contact the live Roster or send email.
