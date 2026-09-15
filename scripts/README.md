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

### `pnpm --filter @workspace/scripts run user-activity-report`

Creates the Task #2272 activity report as Markdown on stdout. It uses only
`SUPABASE_DB_URL` (never `DATABASE_URL`) and opens a repeatable-read,
read-only transaction. Every report query is checked by a SQL guard before it
is sent to PostgreSQL.

The default cohort is accounts whose last sign-in is at or after
`2026-09-01T00:00:00+09:00` and before the report end time (the current
instant by default). The cutoff is inclusive and the end is exclusive:

```bash
SUPABASE_DB_URL='postgresql://...' \
  pnpm --silent --filter @workspace/scripts run user-activity-report > activity-report.md
```

Supported environment configuration:

- `REPORT_CUTOFF` — an ISO timestamp; defaults to
  `2026-09-01T00:00:00+09:00`.
- `REPORT_END_AT` — an ISO timestamp; defaults to now.
- `REPORT_TEST_USERS` — `exclude` (default) or `separate`.
  Test/development accounts are classified from non-output account metadata.
  `separate` retains a distinct test/dev segment; `exclude` removes those
  accounts from user, overall, and weekly results.

The Markdown contains aggregate overall counts, deterministic report-local ordinal
per-user
counts, Monday-start KST weekly counts, cohort linkage quality, no-activity
counts, metric definitions, exclusions, limitations, and per-visible-segment
reconciliation of overall totals against weekly sums. It never emits account
attributes, direct identifiers, or authored payloads. Neighbor edges are
deduplicated by edge identity, and every source is aggregated by user before
being combined to prevent join multiplication. Byte-stable reruns require the
same source snapshot, cutoff, end timestamp, and test-user policy.

Metric time bases are: article creation; `LETTER` plus `letter_at`; send
record `sent_at`; inbox visibility/opening timestamps; completed-read
timestamp; thought creation; sentence creation; neighbor `accepted_at`; and
approved participation creation. The report deliberately cannot infer login
counts, reading sessions, approval transition time, or deleted-history events.
The last-sign-in value is mutable, so a historical end can exclude an account
whose later sign-in moved beyond that end; current deletion and status values
can also cause historical rerun drift. Test/development classification is a
heuristic based on maintained metadata and marker patterns and may
misclassify accounts when those markers are absent or stale.

Run focused tests with:

```bash
pnpm --filter @workspace/scripts run test:user-activity-report
```

The test command also runs the documented silent CLI invocation and checks the
entire stdout as a Markdown report when `SUPABASE_DB_URL` is available.
