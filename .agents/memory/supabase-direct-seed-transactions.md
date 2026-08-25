---
name: Supabase direct seed transactions
description: Safe practices for adding interconnected demo records directly to the app database.
---

When adding a space together with rounds, memberships, articles, and letters directly in Supabase, perform the entire operation in one transaction and verify aggregate relationships afterward.

**Why:** A foreign-key or enum mismatch can occur late in the insert sequence. A transaction guarantees that an unsuccessful seed leaves no partly-created space, articles, or memberships behind.

**How to apply:** Resolve and validate all required users first; keep parent and child IDs generated from one reliable source; explicitly cast dynamic PostgreSQL enum values; then query the created space for participant, round, and letter totals after commit.