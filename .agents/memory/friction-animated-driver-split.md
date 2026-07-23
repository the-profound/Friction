---
name: RN Animated native/non-native driver split
description: How to handle Animated.View when you need both native-driver and non-native-driver animated props simultaneously.
---

## The rule

You cannot mix `useNativeDriver: true` (e.g. `transform: [{ translateY }]`) and `useNativeDriver: false` (e.g. `bottom: animValue`) on the **same** `Animated.View`. React Native will error at runtime.

## Solution: two nested wrappers

- **Outer `Animated.View`**: holds only non-native props (e.g. `bottom`, `height`, `opacity` when layout-driven). Uses `useNativeDriver: false`.
- **Inner `Animated.View`**: holds only native props (`transform`, `opacity` when not layout-driven). Uses `useNativeDriver: true`.

```tsx
// Outer: non-native driver — `bottom` tracks keyboard offset
<Animated.View style={[outerStyle, { bottom: keyboardBottomAnim }]}>
  // Inner: native driver — `translateY` handles slide animation
  <Animated.View style={[innerStyle, { transform: [{ translateY }] }]}>
    ...
  </Animated.View>
</Animated.View>
```

**Why:** The native driver offloads animations to the UI thread for 60fps smoothness. But it only supports transform and opacity — not layout properties like `bottom`, `height`, or `padding`. When keyboard tracking must move a panel's `bottom` position, that animation must stay on the JS thread.

**How to apply:** Any time a bottom sheet or floating panel needs both a slide open/close (native) and a keyboard-push offset (non-native), use the two-wrapper pattern above.
