---
name: Same-name CHECK constraint changes
description: Development Drizzle push can miss a changed CHECK expression when its name is unchanged.
---

Verify the actual database CHECK expression after changing an existing constraint; do not treat a successful Drizzle push as proof that it changed.

**Why:** With drizzle-kit 0.31.10, push reported “No changes detected” after the same-named reversal constraint's expression was relaxed. The live constraint still rejected requests that passed API validation.

**How to apply:** Inspect pg_get_constraintdef in development. If the normal dev push misses the change, apply the precise constraint replacement atomically in development and keep the schema source consistent. Production changes must still go through Publish; never add startup/deployment DDL or directly alter production.
