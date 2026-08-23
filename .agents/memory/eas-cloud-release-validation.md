---
name: EAS Cloud release validation
description: Safe comparison of local release intent against EAS Cloud variables when app config validates release profiles.
---

When validating EAS Cloud values with `eas env:exec`, do not set `EAS_BUILD_PROFILE`
or release-only variables in the parent shell. The CLI evaluates Expo config before
it injects the selected Cloud environment, so parent profile variables can cause an
early false "missing configuration" failure. Set the profile/track only inside the
command run by `env:exec`, after clearing local public configuration values.

**Why:** `eas env:exec` needs to resolve the project before it starts its child
command; app.config release guards otherwise inspect the empty parent environment.

**How to apply:** Derive a value-free local configuration fingerprint first, then
run a clean `eas env:exec <track> "APP_RELEASE_TRACK=... EAS_BUILD_PROFILE=... node
validate-release-env.mjs ..."` command and compare fingerprints. Never substitute a
default Cloud target for a missing local intended value.