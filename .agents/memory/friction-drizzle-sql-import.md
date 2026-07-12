---
name: Drizzle sql import in lib/db
description: sql template tag must be imported from drizzle-orm, not drizzle-orm/pg-core — causes esbuild build failure if wrong.
---

The `sql` helper tag must come from `drizzle-orm` (the root package), not from `drizzle-orm/pg-core`.

```ts
// CORRECT
import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// WRONG — esbuild build error: "No matching export for import 'sql'"
import { pgTable, sql, text } from "drizzle-orm/pg-core";
```

**Why:** `drizzle-orm/pg-core` only exports pg-specific primitives (column types, pgTable, pgEnum, etc.). The `sql` tag is a core utility in the root `drizzle-orm` package.

**How to apply:** Any time `sql` is used in a schema file under `lib/db/src/schema/`, ensure it is imported from `"drizzle-orm"` on a separate line, separate from the `drizzle-orm/pg-core` import.
