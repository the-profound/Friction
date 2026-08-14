---
name: Friction EAS build environment isolation
description: The boundary between Replit Secrets and the two Expo EAS projects' build environments.
---

Replit workspace Secrets and EAS project environment variables are separate stores. A secret existing in Replit does not make it available inside an EAS Cloud build; the build log can explicitly report that no variables exist even while the workspace secret exists.

**Why:** The mobile bundle is compiled remotely by EAS, so it cannot assume the local Replit process environment. Replacing a missing Supabase configuration with a placeholder URL turns the useful configuration error into a misleading network error.

**How to apply:** When a value is required by a native/TestFlight bundle, register it in the EAS environment used by the build for each Expo project independently (`friction` and `friction-dev`). Verify with `eas env:list` without printing sensitive values. Do not assume the EAS build profile name selects the same-named EAS environment; inspect the build log.

For mobile API calls, `EXPO_PUBLIC_DOMAIN` must point to a reachable API deployment, not merely exist in EAS. A private Replit deployment blocks native clients, and changing the EAS variable cannot update an already-built IPA; both the deployment and a new native build are required.