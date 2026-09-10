---
name: One-time forced-redirect guard pattern
description: How to gate a "force this route once per session" navigation effect so it doesn't re-fire on a later deliberate navigation to the same route.
---

`ActiveReadingGuard` in `artifacts/friction/app/_layout.tsx` forces native cold start onto the record tab even when the URL happens to resolve to the inbox tab first. A naive one-shot ref (set to `true` only inside the branch that actually redirects) breaks when the app happens to *not* need the forced redirect on that first check (e.g. it already starts on the record tab): the ref stays `false` forever, so the very first time the user later taps the inbox tab for real, the guard mistakes it for the still-pending cold-start case and bounces them back.

**Fix:** flip the "done" ref in a `useEffect` keyed only on the hydration/readiness signal (e.g. `[isHydrated]`), not on the decision outcome. That marks the initial check as consumed exactly once, regardless of which way it went, so every subsequent navigation to the same route is treated as a deliberate user action.

**Why:** the guard's job is "this decision only applies to the very first check after mount," not "this decision only applies until it fires once" — those are different conditions and only the former survives the case where the forced branch never actually triggers on that first check.

**How to apply:** any similar "redirect once at startup, then respect user navigation" guard elsewhere in the app should use the same shape: a ref that becomes permanently true after the first post-hydration render, set from an effect whose dependency array contains only the hydration/readiness flag.
