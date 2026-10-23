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

The app name is HWD Cap Table. Existing technical identifiers, routes, database
tables, file paths, cookie name, and environment-variable names are unchanged.
The word “distribution” still describes a shareholder distribution, not the app.
