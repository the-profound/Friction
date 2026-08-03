---
name: Friction drizzle-kit push migration history
description: How to verify prod schema drift and journal.json gaps for the Friction project (drizzle-kit push workflow), and where to look before assuming a schema mismatch caused a 500.
---

This project manages schema via `drizzle-kit push` (direct sync), not `drizzle-kit migrate`. `drizzle/*.sql` files and `drizzle/meta/_journal.json` are historical records only — they are never auto-applied. A gap in `_journal.json` (a migration file with no journal entry) does NOT by itself prove the live DB is out of sync; it only means the history bookkeeping is incomplete.

**How to verify actual drift:** connect directly to `SUPABASE_DB_URL` (via a small `pg` script — `psql` CLI mis-parses this project's connection string, so use node `pg.Client` and manually prepend `postgresql://` if missing, matching `lib/db/drizzle.config.ts`'s logic) and query `information_schema.columns` for the tables in question, or run `pnpm push` from `lib/db` and read the diff it reports before answering yes/no.

**Why:** a 500 bug was hypothesized to be caused by missing Supabase migrations (schema drift), but direct inspection showed the production schema was already fully in sync with `lib/db/src/schema` — the journal gap was cosmetic. Don't skip live verification just because the history file looks incomplete.

**Also found:** running `pnpm push` from `lib/db` can surface *unrelated* pending diffs elsewhere (e.g. a table drift with a "truncate table?" prompt) — treat those as a separate, deliberate decision; never let an unrelated diff get applied as a side effect of investigating a different table.

**Testing transactions without a login flow:** `requireAuth` needs a real Supabase JWT (no service-role key is available as a secret here), so to validate a transactional route handler end-to-end, replicate its exact drizzle-orm calls in a throwaway script imported from `lib/db/src/index.ts` (run with `./scripts/node_modules/.bin/tsx`), wrapped in a transaction that always throws at the end to roll back the test data.
