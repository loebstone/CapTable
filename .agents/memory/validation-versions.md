---
name: Validator version compatibility
description: Generated and handwritten validators can use different Zod error classes.
---

Do not assume unversioned Zod and `zod/v4` share an `instanceof ZodError` identity.

**Why:** Generated validators used the unversioned package while the error handler checked the v4 class. Malformed input was therefore reported as a generic 500 rather than a validation 400.

**How to apply:** When regenerating validators or upgrading Zod, align the validator/error-handler versions or preserve explicit compatibility. Include a malformed-input request in verification, not just valid requests.
