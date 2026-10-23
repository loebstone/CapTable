---
name: Express request trace paths
description: Avoid false route-verification failures from mutable Express request paths.
---

Capture the request method and original pathname at request entry, rather than reading `req.path` later in a response-finish callback. Strip query strings from diagnostic evidence.

**Why:** Mounted Express routers can expose a local path at response finish: a successful `/api/backup` request was recorded as `/backup`, producing a false route-check failure despite a valid ZIP, matching Origin and audit entry.

**How to apply:** Snapshot immutable request metadata before asynchronous middleware when collecting route evidence. A local trace path alone does not prove the browser used a different endpoint. Never include magic-link query tokens in traces.
