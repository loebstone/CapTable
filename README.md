# Mailing

Stage A mailing is available from a distribution year's **Mailing** link.
Set the reply-to on **Access**. Practice years permit **Send to me first** only.
Every recipient receives the same authored, plain-text subject and message;
personal figures belong only in the chosen PDF attachment. Merge fields are
disabled. Automated verification uses a mock sender and never emails Peter.
Delivery callbacks require Peter to configure `RESEND_WEBHOOK_SECRET` in Replit
Secrets; see `replit.md` for the callback contract, sender, privacy rules, and
development-only verification commands. No scheduling is included.

Stage B is available from a year's **Tax & Reinvestment** link. A mailing can opt
into signing links; signatures stay awaiting confirmation until an active user
confirms APIC. Paper directions and private signed-PDF history use the same status
page. Practice links/receipts go only to the signed-in previewer.

`pnpm --filter @workspace/api-server run verify:directions` runs the development
stub/mocked-email signing checks. See `replit.md` for the exact document, token,
privacy, hash, confirmation and supersession rules and the explicitly requested
Resend-test-address-only receipt verification.

# HWD Cap Table

Private management tool for Horace W. Davis Realty Corp. (HWD Farm): holdings,
tax residence, annual rates, shareholder distributions, reports, and backups.

See [replit.md](replit.md) for run instructions, the Roster contract, manually
managed secret names, development-only test behaviors, and all operating rules.
The configured workflows run the API server and web application separately.

- Typecheck: `pnpm run typecheck`
- Acceptance suites: `pnpm --filter @workspace/api-server run verify:<suite>`
  (`stage1`, `stage2`, `stage3`, `practice`, `security`, `rates-csv`, `backup`,
  `residences`, `notes`).
- Download backup: the **Write history** page header.
  New ZIPs: `HWD_CapTable_<environment>_Backup_<timestamp>.zip`; SQL inside:
  `HWD_CapTable_<environment>_<timestamp>.sql`. Existing backups are unchanged.

The app name is HWD Cap Table. Existing technical identifiers, routes, database
tables, file paths, cookie name, and environment-variable names are unchanged.
The word “distribution” still describes a shareholder distribution, not the app.
