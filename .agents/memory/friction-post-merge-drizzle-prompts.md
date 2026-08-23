---
name: Post-merge Drizzle prompts
description: Non-interactive schema pushes can still stop at Drizzle's raw-terminal menus.
---

`drizzle-kit push --force` does not eliminate every interactive prompt. In post-merge automation, use the existing pseudo-terminal wrapper and select only verified safe defaults instead of piping stdin.

**Why:** The post-merge runner closes stdin, while Drizzle's prompt library requires raw terminal keypresses. A schema push can otherwise wait until timeout even with `--force`. Inferred rename prompts carry data-model meaning, so blindly picking a rename risks mapping unrelated legacy data into a new field.

**How to apply:** When a merge setup hangs at a Drizzle menu, inspect the intended migration first. Add a precise wrapper marker only when its default action matches that migration's intended schema change, then rerun the full post-merge setup to verify both schema sync and workflow reconciliation.