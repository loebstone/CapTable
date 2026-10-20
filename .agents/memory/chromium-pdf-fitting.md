---
name: Chromium PDF fitting
description: Non-obvious print-layout behavior affecting one-page tabular exports
---
Use Chromium's PDF print scaling rather than CSS zoom when fitting a measured document to one page.

**Why:** CSS zoom re-rounds table-row dimensions and can change the measured height after fitting, pushing an environment/footer onto a second page even when the original height calculation fitted.

**How to apply:** When changing report layouts, verify actual PDF page counts and footer presence, not just HTML element measurements. Keep layout fitting and a readable-content refusal explicit; never truncate overflow.
