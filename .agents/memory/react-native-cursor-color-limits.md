---
name: React Native cursor color limits
description: Platform limits for changing TextInput caret color without changing selection UI.
---

React Native 0.86 exposes `cursorColor` only to Android. React Native Web needs CSS `caret-color`; iOS maps `selectionColor` to the backed input view's tint, coupling the caret and selection handles.

**Why:** A cross-platform caret-color change must preserve existing selection backgrounds and handles. Using `selectionColor` as an iOS fallback violates that constraint, and is especially incompatible with editors that intentionally keep selection transparent.

**How to apply:** Use `cursorColor` on Android and CSS `caret-color` on web. If iOS must independently tint only the caret, verify a native implementation or upstream React Native support rather than silently changing `selectionColor`.