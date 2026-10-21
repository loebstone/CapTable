---
name: Export test response formats
description: Distinguish successful binary downloads from JSON refusal responses in export verification.
---

An export URL can return a binary success or a JSON error. Interpret test responses by their actual content type and status, not just the requested filename extension.

**Why:** A binary parser chosen from the URL suffix also buffers JSON refusals. Query parameters may accidentally choose a different parser. Comparing an undecoded buffer's properties produces false failures, and serializing a failed binary assertion can dump the entire PDF into logs.

**How to apply:** Decode buffered JSON before checking refusal messages; retain raw bytes for successful PDF/ZIP/XLSX verification. Keep binary failure evidence bounded to status, content type and byte count.
