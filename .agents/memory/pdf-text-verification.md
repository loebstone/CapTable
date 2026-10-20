---
name: PDF text verification
description: Chromium glyph extraction and PDF.js lifecycle quirks in export verification
---
Reconstruct PDF text using item positions before comparing required sentences.

**Why:** Chromium can encode a ligature in adjacent items such as “di”, “ff”, “er”. Joining every item with a space makes the correctly printed word “differ” fail a full-caveat check. Long filenames can also wrap at hyphens without changing their content.

**How to apply:** Distinguish visible word/line gaps from adjacent glyphs. Normalize visual line breaks appropriately for filenames, without weakening sentence/content checks. With PDF.js 6, close the loading task, not the document proxy; the document proxy no longer exposes `destroy()`.
