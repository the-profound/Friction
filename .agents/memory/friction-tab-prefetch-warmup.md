---
name: Friction tab first-render data prefetch
description: How to safely background-prefetch other tabs' layer-1 data on app entry without duplicating requests or leaking across users, and a userId-prop trigger pitfall to avoid.
---

Friction's tab screens only fetch their own first-render data once actually
focused/mounted (lazy tab mount), so switching tabs cold shows a spinner. The
fix is a plain (non-hook) async function triggered once per confirmed
session from the provider that scopes data to the user — not a hook, not a
navigator change.

**Trigger-point pitfall:** a provider component that accepts an optional
explicit id prop "for tests" is not reliably test-only — check every real call
site before treating that prop's presence as a test/production signal. Here,
the one real caller always passes the id prop explicitly (mirroring its own
session state), so gating on "prop is set" silently disabled the feature in
every real session; the correct signal was comparing the auth session's own
user id against the resolved id, not whether an id prop existed at all.

**Query identity, not custom caching:** prefetch with the *exact* same query
key + fetcher a screen's own data-fetching hook already uses. This gets three
properties for free, with no extra code:
- Already-fresh or in-flight queries are automatically deduped, including
  ones another currently-visible screen already started.
- No cross-user leakage, since the key already embeds the user id (or an
  existing custom user-scoped key wrapper for endpoints without one).
- Failures never surface to the user: swallow each prefetch's rejection so
  the destination screen's own loading/error/retry logic is untouched.

**Scope discipline:** only prefetch the first list/screen a tab renders on
mount ("layer 1"); never data that only loads once a user drills into a
specific item ("layer 2") — that should stay load-on-demand.
