# HWD Distributions

Private distribution recordkeeping for Horace W. Davis Realty Corp. (“HWD Farm”), a Massachusetts S-corporation with approximately 47 family shareholders and 400 shares: Classes A, B, C and D, each with 100 shares.

Stage 1 provides delegated passwordless sign-in, shared access management, current Roster holdings, immutable snapshots, persistent tax residence, annual capital-gains rate tables, and an append-only write audit. Stage 2 adds distribution years, private source documents, exact-cent calculations, frozen finalizations, corrections and the cash-paid/APIC ledger. Stage 3 will add statements. Shareholders do not sign in.

## Run & operate

- API workflow: `artifacts/api-server: API Server`; command `pnpm --filter @workspace/api-server run dev`.
- Web workflow: `artifacts/hwd-distributions: web`; command `pnpm --filter @workspace/hwd-distributions run dev`.
- Use the existing artifact workflows, not standalone replacement servers. They supply `PORT` and `BASE_PATH`.
- Web preview is `/`; API prefix is `/api`. Both services belong to this one app/deployment.
- `pnpm run typecheck` — library and application checks.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate the API client and validation schemas after any contract change.
- `pnpm --filter @workspace/db run push` — **development schema only**. Confirm environment and observed database identity first.
- `pnpm --filter @workspace/api-server run verify:stage1` — development-only integration checks using the supplied local Roster **STUB**. The development foundation must be uninitialized (no access entries). All test records are rolled back. PostgreSQL sequence numbers can advance despite rollback.
- `pnpm --filter @workspace/api-server run verify:stage2` — development-only Stage 2 acceptance checks against the **same STUB fixture**, with real private App Storage upload/download. Requires an uninitialized development access list. All database test records roll back; small, clearly labeled storage test files remain private (no hard deletes). The suite exits nonzero if the requested approximate surplus examples conflict with the specified arithmetic; see verification notes below.
- No seeds run at startup. No DDL runs at startup or in publish/build commands.
- Schema reaches the managed production database **only through Publish**. Never push schema or run data writes against production from the agent.
- Never select Publish’s overwrite-data option to copy test data into production.

## Plain secrets: standing service convention

Read outside-service configuration directly from Replit Secrets through `process.env`. Do **not** connect or propose Replit integrations/connections for outside services. Peter stores secrets manually. Do not set production secret values during development or testing.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | This project's own runtime-managed PostgreSQL database |
| `SESSION_SECRET` | HMAC protection for the app-specific session cookie |
| `ROSTER_BASE_URL` | Roster HTTP base URL; no direct Roster database access |
| `DISTRIBUTIONS_SERVICE_KEY` | Bearer credential for the two Roster service endpoints |
| `BOOTSTRAP_PERSON_ID` | Only Roster person allowed to initialize a never-used access list |
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

## Product rules

- This is a separate Farm app: its own project database, deployment and cookie (`hwd_distributions_session`). It shares no code, cookies or database with any other Farm app. Local `lib/` packages belong only to this project.
- All business endpoints enforce both current Roster permission **and** current local access on the server for every request. Public exceptions are health and the sign-in request/verification endpoints, which disclose no holdings or residence/rate/access data.
- No roles or officer titles. Every active person can add or remove another person; removal of the last active person is refused in a serialized transaction.
- Bootstrap is possible only when the access list has never been initialized and the **verified** Roster identity exactly matches `BOOTSTRAP_PERSON_ID`. Merely requesting an email does not create access.
- Money is integer cents (`bigint` database columns, signed integer strings over JSON). No floating-point money or share arithmetic: shares are four-decimal strings and `numeric(10,4)` snapshot values, with BigInt units for sums. Rates are `numeric(6,4)` and four-decimal fraction strings; display conversion is exact. No rates are baked into application data.
- No bank, card or account fields.
- No scheduled jobs, automatic year changes, date-triggered transitions or cleanup jobs. Expired links/sessions fail checks when requested; no rows change on an expiration date.
- No application hard deletes or updates. Every stored application write is an INSERT and receives an audit INSERT in the same transaction. Access removal, tax-residence correction, rate correction, link consumption and session revocation are new rows. Audit insertion does not recursively audit itself.
- Append-only behavior is enforced by the application write surface: no edit/delete snapshot endpoints, no SQL UPDATE/DELETE paths. Database-owner access is privileged and must follow the same retention rule; this is not a tamper-proof ledger against the database owner.
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

### Stage 2 verification arithmetic caveat

The specified acceptance inputs yield exactly 7,782.5 cents proposed, rounded to **7,783 cents ($77.83)** declared per share. With that declaration and the specified CT/NONE rates:

| Holder | Exact nominal | Rounded estimated tax | Calculated surplus | Requested approximate example |
| --- | ---: | ---: | ---: | ---: |
| Esmond Robert III | $3,891.50 | $3,023.63 | **$867.87** | $866 ± $1 |
| Holmes Brette Kameny | $1,245.28 | $660.00 | **$585.28** | $584 ± $1 |

Those two requested approximate examples are outside their $1 tolerance. The suite reports this as a partial acceptance result and exits nonzero; it does not change the specified rates, declared amount, or formula to force a pass. The remaining requested surplus examples, CA near-zero surpluses and both unsettled holds are checked separately. Signed-in UI rendering is not verified by an anonymous screenshot; authenticated route tests verify the underlying behavior without weakening authentication.
