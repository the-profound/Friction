---
name: Friction EAS build environment isolation
description: The boundary between Replit Secrets and the two Expo EAS projects' build environments.
---

Replit workspace Secrets and EAS project environment variables are separate stores. A secret existing in Replit does not make it available inside an EAS Cloud build; the build log can explicitly report that no variables exist even while the workspace secret exists.

**Why:** The mobile bundle is compiled remotely by EAS, so it cannot assume the local Replit process environment. Replacing a missing Supabase configuration with a placeholder URL turns the useful configuration error into a misleading network error.

**How to apply:** When a value is required by a native/TestFlight bundle, register it in the EAS environment used by the build for each Expo project independently (`friction` and `friction-dev`). Verify with `eas env:list` without printing sensitive values. Do not assume the EAS build profile name selects the same-named EAS environment; inspect the build log.

When a validation command relies on dynamic Expo config to select between those projects, set `EAS_BUILD_PROFILE` before invoking EAS CLI itself. Setting it only inside the command passed to `env:exec` is too late: the CLI may resolve the other project first and produce a convincing fingerprint match against the wrong project's environment.

For mobile API calls, `EXPO_PUBLIC_DOMAIN` must point to a reachable API deployment, not merely exist in EAS. A private Replit deployment blocks native clients, and changing the EAS variable cannot update an already-built IPA; both the deployment and a new native build are required.

Local publish-script checks do not prove the Cloud-built IPA contains the values. Enforce required variables in the dynamic Expo config and inspect the emitted JavaScript/Hermes bundle in an EAS build-success hook without printing the values.