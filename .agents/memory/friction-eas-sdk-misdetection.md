---
name: EAS pnpm-monorepo SDK misdetection (RN forced upgrade)
description: Why EAS iOS builds tried to install RN 0.86 despite package.json pinning 0.85.3, and the two-layer guard that blocks it.
---

# EAS SDK misdetection forces RN upgrade in prebuild

In this pnpm monorepo, EAS misdetects the Expo SDK (`Detected expo=57.0.9` from hoisted deps) and prebuild's "Updating package.json" step rewrites `react-native` to the SDK-57 template version (0.86.0). The subsequent `pnpm install --no-frozen-lockfile` then installs 0.86.0, breaking pod install with a Reanimated peer mismatch — even though the first `pnpm install --frozen-lockfile` correctly installed 0.85.3.

**Guard (two layers, keep both):**
1. `artifacts/friction/eas.json` — every build profile sets `"prebuildCommand": "prebuild --skip-dependency-update react-native,react,expo"` so prebuild cannot rewrite versions.
2. Root `package.json` — `pnpm.overrides` pins `react-native` to the app's version, so even if package.json is rewritten, re-resolution can't pick up a different RN.

Also keep `EXPO_USE_PRECOMPILED_MODULES=0` in the env of each profile (separate misdetection symptom on the pods side).

**Why:** two consecutive EAS build failures came from this misdetection at different pipeline stages; fixing only one layer was not enough.

**How to apply:** when bumping Expo SDK / RN for real, update the pnpm override in the root package.json in lockstep with `artifacts/friction/package.json`, or installs will silently pin the old RN.
