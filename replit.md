# HWD Distributions

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
- CSV headers are `code,rate,source_note` (all three required). `csv-parse` parses on the server, including quoted commas, doubled quotes and multiline notes. Codes must be FEDERAL, NONE, or a recognized US state/territory code; `XX` is not valid. Source notes remain required, as in the manual editor. Duplicate codes and invalid rows reject the entire file with physical-line errors. The UTF-8 file limit is 65,536 bytes.
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

- **Practice-only source-document exception:** draft gross figures and cost lines may omit a document or send null. The server checks the persisted `is_practice` flag; real years still require an attached document for every figure/cost and reject missing sources with the existing message. A provided document ID must still belong to the year, even in practice. Missing practice sources display `no source document (practice)` in figures and `none (practice)` in board PDFs. Nullable references survive finalization/reset; corrections retain their existing document requirements. Writes remain append-only and audited. `verify:practice` covers omitted/null sources, real gross/cost rejection, spoofed flags and board PDF text labels.

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
- All business endpoints enforce both current Roster permission **and** current local access on the server for every request. Public exceptions are health and the sign-in request/verification endpoints, which disclose no holdings or residence/rate/access data.
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
- One logical rate table per year, with append-only revisions and one row per entered state code in each revision. Federal and state rates require free-text source notes. NONE is valid only at zero. Copying a prior table preserves rates and source notes exactly, creates new rows in a later year and requires a new note. Copy cannot overwrite an existing destination year.
- Class headcounts are displayed plainly and are never a warning or blocking condition. Exact share totals are validated against rows and the grand total.
- Nothing private is “secured” by hiding it in React; the API withholds it.
- Every report must state **ENVIRONMENT** and the observed results of `SELECT current_database(), inet_server_addr()`. Development and production can have the same default database name. SQL NULL server address is reported as such, not guessed. The signed-in app displays this identity.

## Roster contract (HTTP only)

Both calls use `Authorization: Bearer {DISTRIBUTIONS_SERVICE_KEY}`. Only these read/delegation calls are made; this app never writes to the Roster or queries its database.

### `POST {ROSTER_BASE_URL}/api/service/sign-in-check`

Request: `{"email":"..."}`.

Response: `{"allowed":true,"personId":"...","displayName":"..."}`. A denied response can omit or null the identity fields. Only an allowed email with a complete identity may receive a magic link, and only if locally active or the exact eligible bootstrap identity. Permission is rechecked at link redemption and on every protected API call. Access-list additions also resolve the email through this endpoint; identity fields are never trusted from the browser.

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
- Every gross figure and labeled cost line references a source document attached to that year. Draft revisions append new figure and cost rows; old rows remain. Documents are PDF/PNG/JPEG/GIF/WebP, at most 20 MB, with filename, upload date and uploader.
- Documents upload directly to a private staging URL. Attachment copies the bytes to a fresh, server-only object key and verifies size/file signature. Reusing the staging URL cannot modify the sealed document. Files are stored in App Storage, metadata in PostgreSQL; there is no public object/file route. Download requires both live Roster and local access and is `private, no-store`. Multiple documents per year are allowed. No automatic object cleanup or hard deletes.
- Exact formula: proposed cents = `net cents × (federal rate + highest holder state rate) ÷ 400`, rounded to integer cents. Highest rate considers only the holders of this fixed snapshot, using their current confirmed or proposed residence. All intermediate arithmetic is BigInt rational arithmetic. Rounding is half away from zero.
- The proposed amount is advisory. A person must explicitly record the declared integer cents per share and declaration date; that declared amount governs nominal distributions. Calendar dates are validated, but no dates trigger state changes.
- For each distinct person, shares across Classes are aggregated exactly before rounding: nominal = declared cents × shares; gain = net cents × shares / 400; estimated tax = exact unrounded gain × (federal + own state rate); surplus = rounded nominal minus rounded estimated tax. Gain display alone rounds to cents, not the intermediate tax input. No per-person distribution amount is editable.
- Reconciliation shows sum of rounded nominal amounts, declared per-share cents × 400, and residual (sum minus expected). Rounding residual is displayed, not silently allocated to someone.
- Finalization requires figures, a declaration, and every snapshot holder's confirmed nonmissing residence with a matching rate row. The UI and refusal list names/reasons. Finalization stores immutable copies of the exact snapshot rows, rates and their revision id, residences and their revision ids, figure/cost values, declaration amount/date and original snapshot `asOf`.
- Later Roster fetches, snapshots, rate revisions and residence revisions do not alter a finalized year. Draft figures/declarations and repeated finalization are refused after the lock.
- **Correction interpretation:** corrections append to a finalized year, never replace the frozen inputs. Note-only corrections are allowed. Monetary corrections are explicit signed **deltas** to gross, total cost, or declared cents per share; gross/cost corrections need an attached source document and declaration adjustments need a declaration date. Every correction requires a nonblank note. The original calculation stays visible; effective figures use only the frozen snapshot/rates/residences plus those explicit deltas. Status becomes `corrected`. Negative effective gross/cost totals/declarations and corrections reducing nominal below already-paid-plus-retained are refused.
- Cash and APIC entries are permitted only after finalization. Cash records positive cents, payment date and free-text method/check number. APIC records positive cents, the **direction-letter-received date**, and an optional note. There are no financial account identifiers.
- Remaining = nominal − cash − APIC. Any entry exceeding remaining is refused under the same serialized transaction lock used for every write. A positive entry can be reversed once by a new exact negative entry linked to it, with a required note and reversal date. Arbitrary negative payments and reversal-of-reversal are refused; original entries remain visible.
- Status is `complete` whenever remaining is zero; otherwise `held` for a manually noted hold (or the default from an unsettled snapshot row); otherwise `open`. Holds/releases are append-only and noted. Held is a status marker, not an extra authorization rule; recording a valid paid/retained entry does not require silently altering the hold.
- All new database records are appended and audited inside the same transaction. Year and payment writes recheck local access inside the serialized transaction; the shared middleware also checks live Roster permission on every request, including all source-document routes.

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


- **Access list → Download backup** opens an access-checked confirmation page.
  GET never exports or writes. Its origin-preserving referrer policy lets the
  native confirmation form send a same-origin POST to `/api/backup`. Both routes
  require the usual valid session, current Roster allowance and active local
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

Instruction is Pay by default, Hold while an explicit or snapshot-unsettled hold is active, or ✓ once Paid plus APIC retained equals Distribution. Completion takes precedence for the displayed instruction; the independent hold flag still prevents new cash/APIC entries. Hold changes require a note and append a new audited row; an unsettled snapshot flag is clearable only through such an explicit remove-hold entry. Reversals remain available to correct existing entries. Legacy internal status and amount field names remain for compatibility but are not display labels.

The server rejects a new cash/APIC entry on Hold with “This holder is on hold — remove the hold first.” A Hold statement omits payment rows, dates and amounts, and instead uses exactly: “Your distribution is being held pending resolution; the Corporation will be in touch.” That required sentence is the sole intentional exception to the no-obsolete-“held”-wording scan; stored free-text history is never rewritten. Board counts read “on hold: n, paid in full: n, to pay: n”; APIC/Paid total cells are blank until a ledger entry exists.

### Practice previews and ledger before finalization

The immutable practice flag is loaded from the database, never trusted from a request. Practice statements (individual/ZIP), board PDFs and ledger XLSX are available at any stage, even immediately after opening/reset. The PDFs retain their per-page PRACTICE watermark; every workbook sheet retains its PRACTICE banner. Missing data stays “Not recorded”/blank, never invented zeroes.

An undeclared practice statement says “not yet declared”, separately shows the proposed per-share/distribution amounts when calculable, and labels its tax estimate as proposed. The existing tax formula remains net profit × shares ÷ 400 × the holder's rates; a proposed distribution does not become taxable profit. Real-year finalization requirements and statement refusal text remain unchanged; real workbooks are also guarded server-side.

Practice cash/APIC entries, reversals and holds may be recorded while draft. Cash/APIC requires a declared per-share amount so its existing cap has a defined basis; Hold, positive-entry, reversal-note and append-only/audit checks remain enforced. A draft declaration that would undercut existing Paid plus APIC is rejected atomically. Corrections still require finalization, and practice finalization still requires the ordinary residence/rate/input checks. Verify with `verify:practice`, `verify:stage3` and the workspace typecheck.
