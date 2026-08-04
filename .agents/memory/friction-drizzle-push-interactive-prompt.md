---
name: Drizzle push interactive truncate prompt hangs post-merge
description: Why `drizzle-kit push --force` can still hang non-interactively when adding a unique constraint to a non-empty table, and how it's worked around.
---

`drizzle-kit push --force` does NOT auto-approve every prompt. Adding a new
unique constraint to a non-empty table always shows an interactive
"Do you want to truncate <table>?" select prompt, regardless of `--force`
and regardless of whether real duplicate data exists.

**Why this matters:** the prompt library reads raw keypresses, which requires
an actual pty. Piped/non-TTY stdin (closed stdin, `echo | cmd`, etc.) does
NOT satisfy it — the process just hangs until killed, which is what caused
a post-merge setup timeout.

**How to apply:** the post-merge script now runs the push through
`scripts/db-push-auto.py <drizzle-package-dir>`, which allocates a pty via
Python's stdlib `pty` module and auto-sends Enter to accept the default
("No, add the constraint without truncating") whenever that prompt text
appears. Before trusting "truncate" as safe, verify no real duplicate rows
exist for the new unique key (e.g. via a `GROUP BY ... HAVING COUNT(*) > 1`
query against `SUPABASE_DB_URL`, not local `DATABASE_URL` — see
friction-two-database.md). If duplicates exist, choosing "No" will make the
migration fail loudly, which is preferable to silent data loss from
truncating.

`script` (util-linux) was tried first and failed silently: when its own
stdout isn't a tty it falls back to block-buffered, non-interactive mode
(look for "<not executed on terminal>" in its log), so grep-polling its
output never sees the prompt in time. Python's `pty.openpty()` works
because it allocates a fresh pty pair from the kernel without needing an
existing controlling terminal. The merge/post-merge execution environment
only guarantees the modules declared in `.replit` (e.g. `nodejs-24`,
`javascript`, `postgresql-16` — no Python by default), so a helper script
that needs Python must have a `python-3.x` module added via
package-management, or it fails with `python3: command not found` in that
environment even though it works fine in the interactive workspace shell.
