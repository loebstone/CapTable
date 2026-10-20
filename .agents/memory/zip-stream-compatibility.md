---
name: ZIP stream compatibility
description: JSZip output can be a legacy stream despite accepting a Node Readable type assertion.
---

Treat JSZip's generated Node stream as a legacy stream unless its runtime
interfaces have been checked; use Node's pipeline for consumption.

**Why:** The installed JSZip output worked with pipeline/backpressure but lacked
an async iterator. A TypeScript assertion to native Readable compiled and still
failed at runtime with "not async iterable".

**How to apply:** When consuming ZIP streams in new exports or tests, do not
assume for-await support from the apparent TypeScript type. Adapt explicitly
when a native readable is needed.
