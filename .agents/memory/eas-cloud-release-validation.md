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
map the build profile independently to both its semantic release track and configured
EAS Cloud environment, then run a clean `eas env:exec <environment>
"APP_RELEASE_TRACK=<track> EAS_BUILD_PROFILE=<profile> node validate-release-env.mjs
..."` command. These names may differ: a test profile can intentionally retain
production runtime semantics and consume production variables. Never substitute a
default Cloud target for a missing local intended value.