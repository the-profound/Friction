---
name: Driving an interactive drizzle-kit push manually from the shell
description: How to script answers to drizzle-kit push's raw-terminal select menus when running it ad hoc (not via the post-merge wrapper).
---

Running `drizzle-kit push` directly from a shell tool (not through the project's post-merge pty wrapper) still hits the same raw-terminal select menus for column rename/create disambiguation and destructive-change confirmations. Plain piped stdin (`printf ... | pnpm ... push`) does not work: the prompt library reads raw keypresses, and each process invocation restarts the whole "pull schema from database" step from scratch, so a piped answer that arrives before the relevant prompt is simply lost.

**Why:** The "pull schema" step's duration varies significantly run to run (single-digit seconds to 40+ seconds observed), so a fixed sleep-then-send schedule keyed off wall-clock time from process start is unreliable — it either fires while the spinner is still running (input dropped) or misses a later prompt entirely once total run time exceeds the schedule.

**How to apply:** Drive the process through a real pty (Python's `pty.openpty()` + `subprocess.Popen` with `stdin=stdout=stderr=slave`) and use a small content-based state machine: watch the streamed output for a short literal substring unique to each expected prompt, then write the needed key bytes (arrow keys, `\r`) to the master fd only after that substring appears. This is robust to run-to-run timing variance because it reacts to actual prompt appearance instead of guessing when it will appear. An unrelated prompt can surface from schema drift another already-merged change introduced — confirm it's pre-existing (grep the current schema) before accepting its non-destructive default, rather than assuming this push caused it.
