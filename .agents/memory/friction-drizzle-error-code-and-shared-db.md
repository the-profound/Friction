---
name: Friction drizzle-orm pg error codes & shared Supabase DB across concurrent tasks
description: Where to find the real Postgres error code when catching a drizzle-orm insert/update failure, and why a newly-added index/constraint can vanish mid-task.
---

**drizzle-orm wraps pg errors — `err.code` is NOT the Postgres error code.** `db.insert(...)` throwing a constraint violation surfaces a `_DrizzleQueryError` whose own `.code` is `undefined`. The real Postgres error (with `.code`, e.g. `23505` for `unique_violation`, and `.constraint`) is at `err.cause`. Always check `(err as any)?.cause?.code`, not `(err as any)?.code`, when branching on a specific SQLSTATE in a catch block. Verified empirically — don't trust `"code" in err` type guards without checking `.cause` first.

**The Supabase dev DB (`SUPABASE_DB_URL`) is shared across concurrently-running task agents in this project.** A schema change (e.g. a new unique index) that exists only in your uncommitted `lib/db/src/schema` can be silently dropped mid-task: another task's merge runs the post-merge script (`pnpm --filter @workspace/db run push-force`), which syncs the *live* Supabase schema to whatever `schema.ts` is on `main` at that moment — if your index isn't merged yet, it gets dropped to match.

**How to apply:** for any new DB constraint/index you need to guarantee is live before finishing your task, (1) create it via a raw-SQL migration script (`CREATE ... IF NOT EXISTS`) so it's trivially re-runnable, not just a one-time interactive `drizzle-kit push`, and (2) re-verify with a direct query immediately before your final validation step — don't trust an index you created earlier in the same session is still there. Never run plain interactive `pnpm push`/`drizzle-kit push` yourself — it prompts about *unrelated* tables too (destructive prompts like "truncate?") and can block waiting on stdin; use a scripted `CREATE INDEX IF NOT EXISTS` instead.
