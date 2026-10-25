---
name: Sticky table mobile sizing
description: Why mobile hit testing matters even when declared frozen-column widths appear to fit.
---

Do not infer mobile column bounds from `min-width`/`max-width` classes on an
auto-layout table. The browser can distribute spare table width and enlarge
those columns beyond the intended sizes.

**Why:** Mobile checks found the frozen name covering/intercepting Actions even
after the nominal name/action widths appeared to fit. A separate implicit grid
track had also widened the outer page; fixing that did not fix the table overlap.

**How to apply:** Check outer-page overflow separately from intentional internal
scrolling. Measure actual frozen-name and far-right Actions rectangles and
hit-test controls after horizontal scrolling; CSS class values alone are not
acceptance evidence.
