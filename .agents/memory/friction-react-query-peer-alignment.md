---
name: React Query peer-instance alignment
description: Prevents QueryClient context loss when pnpm resolves the shared API client against a different React peer variant.
---

React context packages must resolve to the same physical pnpm package instance in the Expo app and every source-imported workspace library. Matching package versions alone is insufficient because pnpm creates separate instances for different React peer versions.

**Why:** The shared API client and Friction app both used React Query 5.90.21, but one was paired with React 19.2.8 and the other with React 19.2.3. The provider and generated hooks therefore used different contexts, causing `No QueryClient set` during startup. Metro `extraNodeModules` did not prevent the split while the workspace library retained its own resolvable peer variant.

**How to apply:** After dependency or React upgrades, compare the real paths of React Query from the app and shared client and inspect lockfile peer variants. Keep the shared client's React development/peer resolution aligned with the Expo-compatible React version, regenerate the lockfile, clear Metro, and verify only one React Query peer variant remains.