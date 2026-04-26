# `@workspace/scripts`

Operational scripts (seeders, one-shot data migrations, etc.) for the Friction
backend. All scripts run via `tsx` and connect to whatever database
`SUPABASE_DB_URL` / `DATABASE_URL` points to, so make sure the env is correct
before running.

## Available scripts

### `pnpm --filter @workspace/scripts run seed-test-accounts`

Creates the standard set of test accounts in Supabase Auth and the matching
rows in `public.users`, then seeds related sample data (articles, inbox,
neighbors, collections, …). Idempotent — safe to re-run.

### `pnpm --filter @workspace/scripts run backfill-public-users`

One-shot backfill that ensures every row in `auth.users` has a corresponding
row in `public.users`.

Why this exists: users created directly in the Supabase Auth dashboard never
hit `POST /api/users/sync`, so they end up with no `public.users` row and are
invisible to neighbor / team-collection invites until they next log in. This
script copies them over in one pass, deriving the nickname from the email
local-part using the **same** rule as the server (`deriveNicknameFromEmail` in
`artifacts/api-server/src/routes/users.ts`):

- keep `A-Z a-z 0-9 . _ - 가-힣`
- strip everything else
- fall back to `"user"` if nothing is left
- truncate to 20 characters

Behavior:

- **Idempotent.** Safe to re-run; only inserts rows that are still missing.
  Rows already present are reported as `already_present`.
- **Email collisions are skipped, not overwritten.** If an `auth.users` row's
  email is already in use by a *different* `public.users` id, the script logs
  the conflict and exits with a non-zero status code so an operator can
  resolve it manually.
- **Auth users without an email** are ignored.

How to run:

```bash
# Make sure SUPABASE_DB_URL (or DATABASE_URL) points at the target database.
pnpm --filter @workspace/scripts run backfill-public-users
```

Sample output:

```
🔍 Looking up auth.users without a matching public.users row...
  Found 3 missing row(s).
  ✓ alice@example.com → nickname="alice" (id=…)
  ✓ bob+ops@example.com → nickname="bobops" (id=…)
  ✓ 한글@example.com → nickname="한글" (id=…)

📊 Summary: inserted=3, already_present=0, skipped_email_collisions=0

✅ Backfill complete.
```
