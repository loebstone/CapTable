---
name: Verification timestamps
description: Two clock pitfalls when checking expiries inside long rollback fixtures.
---

Compare expiry against issuance wall-clock bounds, not the fixture row's default
creation timestamp. Preserve milliseconds with Date.valueOf()/getTime(), rather
than passing a Date object to Date.parse().

**Why:** PostgreSQL CURRENT_TIMESTAMP stays fixed at the outer test transaction's
start across savepoints. Separately, Date.parse(Date) stringifies the Date and
drops milliseconds. Both produced false expiry failures despite correct links.

**How to apply:** Use this when verifying token lifetimes in long, isolated
rollback transactions. Keep strict expiry checks; do not widen tolerances to
hide a mismatch between clocks or date types.
