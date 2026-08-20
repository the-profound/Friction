---
name: Friction signup auto-confirm auth race
description: Why Supabase auto-confirm signup can strand users mid-signup, and the fix pattern used in AuthContext.
---

Supabase's `supabase.auth.signUp()` fires `onAuthStateChange` (setting a real
session) **synchronously inside the call, before the `signUp()` promise even
resolves back to the caller** — this happens whenever auto-confirm is on (no
email verification required). If the app's auth guard treats a truthy session
as "fully signed in" and redirects away from the signup screen, it will do so
**before** any post-signup profile-sync call (e.g. `/api/users/sync`) has run,
because that sync only starts after `signUp()` returns. The user lands on the
authenticated app with no backend profile row yet — screens that assume a
synced profile throw/crash.

The initial `supabase.auth.getSession()` restore must be treated as part of the
same gate. On a slow native startup it can resolve after signup has begun and
publish the newly-created session before the profile sync, or reject/hang and
leave the auth guard rendering its full-screen loading state forever.

**Why:** the redirect-eligibility signal (`session` in `AuthContext`) and the
one-time signup side effect (profile sync) are two independent async flows
racing on the same `onAuthStateChange` event; nothing serializes them.

**How to apply:** in `AuthContext.signUp()`, set a ref flag before calling
`supabase.auth.signUp()` that makes the `onAuthStateChange` listener drop
events while true. Run the profile sync manually inside `signUp()`, and only
call `setSession(data.session)` yourself once the sync has actually
succeeded. If the sync fails after an auto-confirmed session was created,
sign the user back out and return an error, rather than leaving a
half-synced authenticated session for the guard to redirect on; the later password sign-in path must retry the idempotent profile sync. After any authoritative null decision, delayed `SIGNED_IN` and `TOKEN_REFRESHED` events must be ignored until a new explicit auth operation starts; explicit sign-out must clear React state immediately before those events are blocked. This same
suppress-until-side-effect-completes pattern generalizes to any other
Supabase auth flow that has a required post-auth side effect (e.g. OAuth
sign-in that also needs an out-of-band backend sync).

Bound the initial session restore and clear the loading state on both resolve
and reject; if the restore is still in flight during signup, discard its
observed session and let the signup flow make the authoritative decision.
