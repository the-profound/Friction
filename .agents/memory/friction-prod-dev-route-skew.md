---
name: Friction production/dev API route skew
description: How to confirm a "route missing in production" claim quickly, and why a supplemental query's failure must never gate a whole screen.
---

# Verifying prod/dev route skew

Native builds call the deployed API (`friction-1.replit.app`), while the web
preview calls the local dev API server. The two can run different code: a
route can exist and be correctly ordered in the dev `src/routes/*.ts` source
(e.g. `/spaces/operator-pending-code-requests` registered before the
`/spaces/:id` catch-all) while the deployed build still has the old route
order, so the request falls through to `/spaces/:id` with the literal path
segment as the id — producing a 500 from a failed UUID query, not a 404.

**Why:** don't assume a "server bug" report is still live just because the
symptom (500 from a plausible-looking id) matches. Check the *deployment*
request/error logs (`RefreshAllLogs`, deployment log file) for the exact
failing path — if you see it 500ing there with the catch-all's query shape,
the skew is real and current; if the dev route ordering already looks correct
in source, the fix is a redeploy, not a code change.

**How to apply:** when a task says a bug is caused by version skew between
deployed and dev, grep the current route file for the specific path and its
position relative to any `:id`-style catch-all before doing anything else.
Redeploying is out of scope for most feature tasks — propose it as a
follow-up rather than running Publish yourself.

# Supplemental query failures must not gate the screen

When a screen depends on N queries but only some are "primary" (drive the
empty/error state) and one is purely supplementary (e.g. an operator-only
approval count), the supplementary query's `isLoading`/`isError` must never
appear in the screen's top-level loading/error branching — not even in a
second, separate full-screen branch gated on "no primary content yet". That
second branch is the same bug in a different shape: it still covers the
whole screen for a non-critical query. Give the supplemental query a small,
inline, non-blocking notice (with its own retry) rendered in both the list
header and the empty state, driven only by that query's own error flag.
