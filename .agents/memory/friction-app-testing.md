---
name: Friction app testing / preview
description: Why screenshots of friction (tabs) routes render blank, and what gates them.
---

# Friction mobile app — preview is auth-gated

The friction Expo app (`artifacts/friction`) gates all `(tabs)` routes behind
Supabase auth (`contexts/AuthContext.tsx`, `signInWithPassword`). Visiting any
tab route (e.g. `/to`, `/on`, `/of`) while logged out renders a blank white
screen; the root `/` shows the login form instead.

**Why:** screenshots of tab screens look "broken" (blank) but are actually just
unauthenticated. Don't chase a non-bug.

**How to apply:** to visually verify a logged-in tab screen you need real
Supabase credentials. The dev DB seed (`artifacts/api-server/src/seed.ts`)
inserts `users` rows but NOT matching Supabase auth accounts, so seeded users
can't log in. Lean on pattern parity with sibling screens for confidence when
auth login isn't available.

**tsc is NOT a clean gate here:** `npx tsc --noEmit` reports many *pre-existing*
errors the codebase tolerates — `Article` lacks `authorNickname`/`isNotice`,
`SendRecordWithDetails` lacks `collectionName`/`collectionId`, and `ApiError` is
a class in `custom-fetch.d.ts` but is NOT re-exported from
`@workspace/api-client-react`'s index (so importing it errors). Metro bundles
fine regardless. To verify a new screen compiles, check the **Metro web bundle**
("Web Bundled … N modules" with no error) rather than tsc. Match sibling-file
patterns (e.g. `(slot.article as any).authorNickname`) instead of "fixing" these.
