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

## Node Vitest and React Native imports

When unit testing UI-state logic, keep the tested helper free of imports from
`react-native` or token modules that import it. The Node Vitest transform cannot
parse React Native's Flow `import typeof` entrypoint.

**Why:** importing a seemingly small UI utility that reaches `react-native`
causes Rollup to fail before any test runs, even though Metro can bundle it.

**How to apply:** extract platform-neutral decisions into a small `lib/` helper
with primitive inputs (for example, values and colors), test that helper, and
let the React Native component supply token values.

## Development shortcut accounts

The seeded Minji profile does not currently have a matching Supabase Auth user,
so its login shortcut must not silently attempt a password sign-in. Direct the
simulator user to a provisioned development shortcut instead.

**Why:** database seed rows alone are insufficient for Supabase password
authentication; a failed shortcut previously looked like an unresponsive tap.

**How to apply:** preserve a clear in-app message for the unavailable profile.
Use a provisioned development shortcut when authentication-gated web or native
flows need verification, and do not assume seed identities can sign in.
