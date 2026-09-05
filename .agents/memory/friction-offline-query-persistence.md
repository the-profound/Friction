---
name: Friction offline-first React Query persistence
description: How the disk-persisted/offline-aware React Query layer is wired in the Friction app, and pitfalls hit building it.
---

The Friction app persists only an allowlisted subset of React Query's cache to
AsyncStorage (via `@tanstack/react-query-persist-client` +
`@tanstack/query-async-storage-persister`), wired through
`PersistQueryClientProvider` in `app/_layout.tsx`. Everything not allowlisted
stays memory-only, exactly as before.

**Allowlist technique:** match `queryKey[0]` (the URL path orval bakes into
every generated hook's query key) against an exact-string set for list
endpoints, e.g. `/api/articles`. Detail endpoints always append a path
segment (`/api/articles/<id>`), so exact-string matching excludes them
automatically — no need to enumerate hook call sites or maintain a
per-screen registry. A regex only was needed for `/api/users/<id>` (dynamic
id segment) to admit the profile fetch while still rejecting nested
sub-resources like `/api/users/<id>/space-letters`.

**Why:** the same generated hook (e.g. `useListArticles`) is called all over
the app with different params for non-allowlisted purposes; allowlisting by
hook name or call site would have been fragile and easy to under/over-match.
URL-path matching is mechanical and stays correct as new call sites appear.

**Version pinning gotcha:** `pnpm add @tanstack/react-query-persist-client`
without an exact version resolves the latest release, which can be newer
than the pinned `@tanstack/react-query` catalog version and trips a peer
warning (`unmet peer @tanstack/react-query`). Pin the persist-client package
to the *exact* same version string as the installed react-query version.

**Native network detection:** React Native has no browser-style
`navigator.onLine` / `online`/`offline` window events, so React Query's
default `onlineManager` never fires natively. Must explicitly wire
`@react-native-community/netinfo`'s `addEventListener` into
`onlineManager.setEventListener` (module scope, once) — this is the
documented recipe, not a Friction-specific workaround. NetInfo has its own
web fallback, so this same wiring also covers the web build; no
`Platform.OS` branch needed.

**Cold-start gate:** `PersistQueryClientProvider`'s `onSuccess`/`onError`
props both fire exactly once after restore settles (errors are caught
internally by the library and logged, not thrown to the render tree) — use
either to flip a `cacheRestored` state flag. Combine that flag with the
existing font-loading readiness flag into one `startupReady` condition so
the splash screen and the pre-auth loading view both wait for both signals,
without adding a second sequential wait: mount `PersistQueryClientProvider`
unconditionally (wrapping even the loading view) so AsyncStorage restore
runs in parallel with font loading instead of after it.
