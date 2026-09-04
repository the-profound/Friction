---
name: Focus-effect query recovery
description: Preventing React Navigation focus recovery requests from retriggering themselves as query state changes.
---

When a focus effect starts a React Query refetch, keep its callback identity independent of `isLoading` and `isFetching`. Read those volatile flags and the current refetch function through a render-updated ref, while limiting callback dependencies to real lifecycle boundaries such as authenticated user identity.

**Why:** A focused effect is cleaned up and re-run whenever its callback changes. Depending on fetching flags makes request start/completion recreate the callback, which can continuously refetch while the screen remains focused.

**How to apply:** For focus-time recovery on mounted tab screens, gate on authentication, active reads, and active mutations using ref-backed current state. Keep tab reselection and focus recovery behind the same guard.