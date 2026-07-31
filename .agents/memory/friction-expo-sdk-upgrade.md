---
name: Friction Expo SDK / React Native upgrade playbook
description: How to safely bump Expo SDK / React Native in artifacts/friction (managed workflow, no native dirs) — version research, dependency graph, and known breaking changes to expect.
---

## Process that worked
- artifacts/friction is a **managed** Expo workflow (no `ios/`/`android/` dirs) — native upgrade work is entirely `package.json`/`app.json`, the actual native binary is produced by cloud **EAS Build** (`scripts/publish-ios.sh` / `submit-ios.sh`).
- Since the project date is far past any model's training cutoff, don't trust memorized Expo/RN version numbers — check the npm registry directly for the current SDK line and its `bundledNativeModules.json` equivalent (or `expo-doctor`'s compatibility table) to get the real version matrix.
- Iterate with `npx expo-doctor` as the source of truth for correct dependency versions and `app.json` schema; keep re-running until only trivial/unrelated mismatches remain.
- The workspace's `minimumReleaseAge` (24h) firewall policy can block the very latest patch of an Expo-ecosystem package. Step back one patch version (confirmed >24h old) rather than adding firewall exemptions — keeps versions mutually consistent with expo-doctor's table anyway.
- pnpm catalog entries (e.g. `react`/`react-dom` in `pnpm-workspace.yaml`) are shared — check every consumer (`grep "catalog:"`) before bumping, since one catalog bump touches every artifact using it.

## Known breaking changes across SDK 54→56 lines
- `StyleSheet.absoluteFillObject` was removed; use `StyleSheet.absoluteFill` (same shape, drop-in for both spread and array usage) — confirmed by reading RN's own `StyleSheetExports.js` source, not docs.
- Top-level `app.json` keys `newArchEnabled` and `jsEngine` were removed (New Arch + Hermes are the only supported options, no longer configurable) — remove them, don't set them to `true`.
- Top-level `splash` object moved to the `expo-splash-screen` config plugin (`image`/`resizeMode`/`backgroundColor` become plugin options).
- `android.softwareKeyboardLayoutMode` only accepts `"resize"` (not `"adjustResize"`).
- `babel-preset-expo` auto-includes the reanimated/worklets babel plugins based on installed packages — no manual `babel.config.js` plugin entries needed even after reanimated v4 split `react-native-worklets` into its own package.
- A custom native module that legitimately imports from `expo-modules-core` (e.g. `requireNativeModule`) needs it as a **direct** dependency even though expo-doctor warns against installing it directly — that warning is a false positive for this case.

## Why
Confirmed via a real upgrade (SDK ~54/RN 0.81 → SDK 56/RN 0.85.3) done to fix an iOS 26 TurboModule threading crash; these are the exact failure modes hit along the way.

## How to apply
Any future Expo SDK/React Native bump in artifacts/friction — repeat this loop (registry research → expo-doctor iterate → grep for `absoluteFillObject` and other removed APIs → check app.json schema diffs) rather than guessing versions from memory.
