---
name: Friction native session recovery
description: Safe handling of persisted Supabase sessions on iOS and Android.
---

On native, do not allow Supabase to auto-refresh a persisted session during client initialization. Defer session restoration until `AppState` is active, explicitly resolve a near-expiry refresh, and clear local credentials for permanent refresh failures. API requests must use only the AuthProvider's validated in-memory token, never read persisted Supabase state themselves.

**Why:** A rotated or deleted refresh token can otherwise be refreshed before app-level error handling is ready, exposing an expected logged-out state as a development error overlay. Direct token reads also risk sending an expired bearer token or bypassing the foreground lifecycle boundary.

**How to apply:** Keep web on Supabase's browser-managed restore path. On iOS/Android, gate the first storage read and proactive refresher behind the active lifecycle state; treat invalid or missing replacement sessions as local sign-out, while transient network failures remain eligible for foreground retry.