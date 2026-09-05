---
name: api-zod generated enum barrel gap
description: Generated Zod enums lose their runtime const object at the package public barrel; only the TS type survives export. Affects any orval-generated enum (ServerFeature, ThoughtStatus, future ones).
---

# api-zod generated enum barrel drops the runtime value

`writeApiZodPublicBarrel()` (`lib/api-spec/scripts/safe-codegen.mjs`) always emits
`export type { X }` for a generated enum, never the runtime const object codegen also
produces alongside it. So `import { ServerFeature } from "@workspace/api-zod"` compiles
fine as a **type**, but `ServerFeature.someValue` at runtime is `undefined` — there is no
runtime export to reference.

**Why:** discovered while adding a new generated enum (`ServerFeature`); the exact same
gap silently affects `ThoughtStatus` and will affect any future generated enum until the
barrel script itself is fixed.

**How to apply:** in consumer code, import the enum as `import type { X } from
"@workspace/api-zod"` and use raw string literals matching its values (already the
existing convention for `ThoughtStatus` elsewhere in the codebase) instead of `X.value`.
Do not "fix" this by hand-editing generated output — it gets overwritten by the next
codegen run. Fixing it for real means changing `writeApiZodPublicBarrel()` to also emit
the runtime const, which is a shared-codegen change outside a normal feature task's scope.
