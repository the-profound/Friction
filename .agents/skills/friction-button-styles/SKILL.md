---
name: friction-button-styles
description: >
  Button/Pressable/ScalePressable/animated-view creation and styling rules in the
  Friction app (Expo RN + Reanimated on web/iOS/Android). Read this BEFORE creating
  or editing any button, including content-sized rows, icon/check controls, pills,
  and full-width submit buttons.
---

# Friction: Button creation and style guide

Apply this guide before creating or editing a `Button`, `Pressable`,
`ScalePressable`, icon/check control, pill/capsule, toolbar action, submit action,
or animated view used as a button. Five distinct visual bugs have each been hit
**more than once** in this codebase because of React Native / Reanimated / iOS
layout quirks. This skill is the consolidated reference for their prevention and
for the size, state, accessibility, and platform checks every new button needs.

Reference implementations:

- [`ScalePressable.tsx`](../../../artifacts/friction/components/shared/ScalePressable.tsx)
  — the shared outer `Pressable` and inner animated-content contract.
- [`PillButton.tsx`](../../../artifacts/friction/components/shared/PillButton.tsx)
  — the current fixed-height pill and style-merge reference.

The signup step-two “이전 단계로” row in
[`login.tsx`](../../../artifacts/friction/app/login.tsx) is the regression example
for a compact, content-sized button inside a parent that may offer extra height.
This documentation task does not change that screen or any existing component.

## Pre-ship checklist

Run through this list for every new or edited button before testing the individual
button type. The first five items are the minimum size contract and apply even
to buttons that are not pills:

- [ ] Identify the intended type: content-sized text row, icon/check control,
      pill/capsule, or full-width submit button. Write down its intended width,
      height, and whether the visual size is also the touch target.
- [ ] Give the outer `Pressable`/`ScalePressable` an explicit size contract:
      `height` for content-sized controls, `width` when fixed, and `width: "100%"`
      only when the button is intentionally full-width. Set `flexGrow: 0` and
      `flexShrink: 0` when it must not absorb a flex parent’s spare height.
- [ ] Give the inner `Animated.View` an equally explicit contract through
      `contentStyle`: use the same fixed height (or `height: "100%"` only when the
      outer height is already fixed), plus `flexGrow: 0` and `flexShrink: 0`.
      Never rely on `alignSelf` or `alignItems` alone.
- [ ] Do not use `paddingVertical` as the only way to determine a button’s
      height. Padding may change text metrics and can leave native controls
      stretched or unstable; use padding for horizontal breathing room after the
      layout height is defined.
- [ ] Inspect the actual style-array order before relying on a shared component’s
      guard. `PillButton` currently restores its final `height` after caller
      styles, but its base flex guards can still be overridden by a caller. For
      a new shared component, use base style → caller/state/variant styles →
      final non-negotiable `height`/`width`/flex guards; otherwise require each
      caller to preserve the needed flex values explicitly.
- [ ] Treat `hitSlop` as extra touch area, not layout size. It must not be used
      to make a visually tiny control appear to occupy space in a row, and it
      must not overlap an adjacent action unexpectedly.
- [ ] If it performs async work: block repeated activation while pending, keep
      the button’s dimensions stable while loading, and leave a retryable
      in-screen error after failure. An `Alert` or toast may supplement this
      message, but must not be the only explanation.
- [ ] Set the appropriate accessibility role, a useful label, and state
      (`disabled`, `busy`, or `checked`) where applicable. Do not use visible
      placeholder text as the only accessible name for an icon control.
- [ ] If the style has `borderWidth`: does it also have `overflow: "hidden"`? If
      so, remove `overflow: "hidden"` unless a filled background genuinely needs
      clipping.
- [ ] If a view is being **scaled down via `transform`** (Reanimated
      `useAnimatedStyle` or RN `Animated`): do any of its **ancestors** have
      `overflow: "hidden"`? If yes, that ancestor will rasterize content at the
      shrunk size, causing blur when the scale animates back up — remove/relocate
      the clip.
- [ ] If an `Animated.View` (RN `Animated`, not Reanimated) needs both a
      transform-based animation (e.g. `translateY` slide) and a layout-based one
      (e.g. `bottom`, `height`) at the same time: are they split into an
      **outer (non-native) + inner (native)** wrapper pair, not combined on one
      `Animated.View`?
- [ ] If a Reanimated `withTiming`/`withSpring` completion callback does cleanup
      (clearing an "isAnimating" flag, hiding a preview layer, resetting a guard
      ref): does it run **unconditionally**, not gated behind `if (finished)`?
- [ ] If a Reanimated worklet (gesture handler without `.runOnJS(true)`, or a
      `withTiming` callback) needs to persist derived JS state: is every ref/state
      write funneled through **one `runOnJS(commitFn)()`** JS-thread function,
      instead of assigning to a `ref.current` directly inside the worklet?
- [ ] Check the button in a row, a `ScrollView`, and a keyboard-open state on
      web, iOS, and Android. Confirm the row height, label/icon visibility,
      actual touch target, disabled/loading state, and scroll placement.
- [ ] Read the platform-specific checks in
      [expo-web-compat](../expo-web-compat/SKILL.md) when the button or its
      containing screen is new or edited.

---

## 1. The outer/inner size contract

**Rule:** A button has two layout layers that must agree: the outer
`Pressable`/`ScalePressable` participates in the parent layout, while the inner
`Animated.View` renders the content and scale transform. Define the intended
dimensions and `flexGrow: 0` / `flexShrink: 0` on both layers whenever the
control is content-sized or must not stretch.

**Why it fails:** `ScalePressable`'s inner `Animated.View` (`styles.inner` in
`ScalePressable.tsx`) is `flexGrow: 1, alignSelf: "stretch"` by design, so it
fills whatever height its parent gives it. On web this is often invisible because
the parent is already content-sized, but on native a loose row or centered form
can make the button silently expand. This affected filter pills and the compact
signup step-two back row; it remains a risk for any inline-styled button using
only vertical padding.

**Correct content-sized pattern:**

```tsx
const ROW_HEIGHT = 32;

const styles = StyleSheet.create({
  rowButton: {
    height: ROW_HEIGHT,       // outer layout contract
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
  },
  rowContent: {
    height: ROW_HEIGHT,       // inner Animated.View contract
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
});

<ScalePressable style={styles.rowButton} contentStyle={styles.rowContent}>
  <ArrowLeft />
  <Text>이전 단계로</Text>
</ScalePressable>
```

For a full-width control, the outer layer owns `width: "100%"` and a fixed
height; the inner layer uses `height: "100%"` and the same flex guards. A
content-sized row should not receive `flex: 1` merely because its parent is a
form or a `ScrollView`.

For React Native’s built-in `Button`, which has no `contentStyle`, put the
control in a wrapper with the intended width/height and flex guards, then verify
the platform-rendered label and touch area. Do not assume its native internals
follow the `ScalePressable` contract or accept arbitrary padding.

### Style merge order

`ScalePressable` applies `contentStyle` after its default inner style, so
`contentStyle` is the intended escape hatch for overriding the default
`flexGrow: 1` / `alignSelf: "stretch"` behavior. Do not assume every shared
component makes every safety constraint non-overridable; inspect its final style
array before treating it as a guarantee.

`PillButton` currently applies caller and variant styles before its final
**height-only** guard:

```tsx
style={[
  styles.pill,
  typeof style === "function" ? style(state) : style,
  { height },
]}

contentStyle={[
  styles.pillContent,
  { height, paddingHorizontal: paddingH },
  variantPillStyles[variant],
  contentStyle,
  // PillButton restores height here, but callers can still override
  // flexGrow/flexShrink from the base style above.
  { height },
]}
```

Therefore, callers of the existing `PillButton` must keep
`flexGrow: 0` / `flexShrink: 0` in their own overrides whenever the button is in
a loose flex parent. When creating or revising a shared component, use this
stronger merge order for constraints that callers must never undo:

```tsx
contentStyle={[
  baseContentStyle,
  callerContentStyle,
  variantStyle,
  { height, width, flexGrow: 0, flexShrink: 0 },
]}
```

Make an intentional API decision about which dimensions callers may change. Do
not rely on accidental array order, and do not claim a current component enforces
a constraint unless its final style object actually does so.

---

## 2. Button types and short examples

Use the matching contract below before reviewing the shared animation rules in
sections 4–7.

### Content-sized text row

Use an explicit row height and content-sized width. This is the pattern for
navigation/back actions such as the signup step-two “이전 단계로” control.

```tsx
// GOOD: the parent may be tall, but the row remains 32px tall.
<ScalePressable
  style={{ height: 32, alignSelf: "flex-start", flexGrow: 0, flexShrink: 0 }}
  contentStyle={{
    height: 32, alignSelf: "flex-start", flexGrow: 0, flexShrink: 0,
    flexDirection: "row", alignItems: "center",
  }}
>
  <Text>이전 단계로</Text>
</ScalePressable>

// BAD: paddingVertical is the only size rule; the inner view can fill the row.
<ScalePressable contentStyle={{ paddingVertical: 10 }}>
  <Text>이전 단계로</Text>
</ScalePressable>
```

### Icon or checkbox control

Choose whether the visual box and the actual touch target are the same. For a
small visual checkbox, prefer a 44px layout target containing a 22px visual box;
`hitSlop` can add a little extra reach but does not replace the 44px contract.
Set `accessibilityRole="checkbox"` and `accessibilityState.checked`.

```tsx
// GOOD: stable touch layout, separate visual size, explicit inner contract.
<ScalePressable
  style={{ width: 44, height: 44, flexGrow: 0, flexShrink: 0 }}
  contentStyle={{
    width: 44, height: 44, flexGrow: 0, flexShrink: 0,
    alignItems: "center", justifyContent: "center",
  }}
  hitSlop={4}
  accessibilityRole="checkbox"
  accessibilityLabel="서비스 이용약관 동의"
  accessibilityState={{ checked: agreed }}
>
  <View style={{ width: 22, height: 22 }} />
</ScalePressable>

// BAD: no outer or inner size; hitSlop does not prevent native flex stretching.
<ScalePressable hitSlop={12} accessibilityRole="checkbox">
  <View style={{ width: 22, height: 22 }} />
</ScalePressable>
```

### Pill/capsule button

Give every layer the fixed pill height, keep flex growth off, and use horizontal
padding for label breathing room. See [`PillButton.tsx`](../../../artifacts/friction/components/shared/PillButton.tsx)
for the complete `sm`/`md`/`lg` and variant implementation. The existing
`ScalePressable` stretch rule is retained here as the pill-specific consequence,
not as a replacement for the general contract.

```tsx
const PILL_HEIGHT = 40;

<ScalePressable
  style={{ height: PILL_HEIGHT, alignSelf: "flex-start", flexGrow: 0, flexShrink: 0 }}
  contentStyle={{
    height: PILL_HEIGHT, flexGrow: 0, flexShrink: 0,
    paddingHorizontal: 16, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
  }}
>
  <Text>필터</Text>
</ScalePressable>
```

### Full-width submit button

The full-width type may fill horizontally, but it still needs a fixed vertical
contract. Keep the loading indicator and label in the same centered content box
so the button does not change size or shift surrounding fields.

```tsx
<ScalePressable
  style={{ width: "100%", height: 52, flexGrow: 0, flexShrink: 0 }}
  contentStyle={{
    width: "100%", height: 52, flexGrow: 0, flexShrink: 0,
    alignItems: "center", justifyContent: "center",
  }}
  disabled={isLoading || !canSubmit}
  accessibilityRole="button"
  accessibilityLabel="가입 완료"
  accessibilityState={{ disabled: isLoading || !canSubmit, busy: isLoading }}
>
  {isLoading ? <ActivityIndicator /> : <Text>가입 완료</Text>}
</ScalePressable>
```

---

## 3. Signup step-two regression: compact back row

The “이전 단계로” action in
[`login.tsx`](../../../artifacts/friction/app/login.tsx) is the canonical
content-sized regression case. It sits in a form whose parent can provide more
vertical space, so its intended 32px row height must be declared on both the
outer `ScalePressable` and its `backRowContent`. Both layers also need
`flexGrow: 0` and `flexShrink: 0`; `alignSelf: "flex-start"` is useful for
horizontal placement but is not sufficient to stop native vertical stretching.

When applying this pattern to another screen, verify that the back icon and label
remain visible, the row does not become a full-height blank area, and tapping it
does not resize or move the adjacent form fields. The actual screen fix and its
error-handling behavior are out of scope for this guide task.

---

## 4. `borderWidth` + `overflow: "hidden"` on the same view

**Rule:** Never combine `borderWidth` and `overflow: "hidden"` on the same RN
style object, especially for outline-style circle/pill buttons. Drop
`overflow: "hidden"` — plain `borderRadius` is enough to round corners without
clipping.

**Why it fails:** On iOS, `overflow: "hidden"` clips the border itself (making
an "active" outline invisible), and in more severe cases clips inner content
like icons/text entirely. This was hit twice in `MemoToolbar` (B/I/U/quote
active-state red outline: first the border vanished, then the icons vanished)
before `overflow: "hidden"` was removed from `expandBtn` / `expandBtnLast`. See
the in-code comment in `MemoToolbar.tsx`:
`// overflow:"hidden" 사용 금지 — active border가 clip되고 아이콘이 가려짐`.

**Correct pattern:**

```tsx
// BAD — border/icon can vanish on iOS
const badStyle = {
  width: 36, height: 36, borderRadius: 18,
  borderWidth: 1, borderColor: "red",
  overflow: "hidden",
};

// GOOD — no overflow:hidden needed for an outline-only button
const goodStyle = {
  width: 36, height: 36, borderRadius: 18,
  borderWidth: 1, borderColor: "red",
};
```

Only keep `overflow: "hidden"` when a **filled background image or content
must be visually clipped** to the border radius — and in that case, do not add
`borderWidth` to the same view; put the border on a separate wrapping view if
both are truly needed.

**Known fragile locations (not yet fixed, on the radar):**
- `artifacts/friction/app/of-space-start.tsx` — `calendarCard` (~line 2456) and
  `sendCalCard` (~line 2675): both have `borderWidth: 1` + `overflow: "hidden"`
  together. (Tracked for fix under the calendarCard-focused task, e.g. #1296 —
  not in scope here.)

---

## 5. `overflow: "hidden"` on ancestors of scale-transform views

**Rule:** Before applying a `transform: [{ scale }]` animation (Reanimated or
RN `Animated`) to shrink a card/panel, check every ancestor view for
`overflow: "hidden"`. Remove it (or move the clip to a different layer) if the
scaled content needs to render at full visual fidelity once it returns to
`scale: 1`.

**Why it fails:** iOS composites a subtree that has `overflow: "hidden"` set on
an ancestor at the **currently visible (shrunk) pixel size**, not the view's
natural full size. When the scale animates back up, the content — especially
WebViews — looks blurry/pixelated because it was rasterized small and then
stretched, instead of being re-rendered at full resolution. This was hit and
fixed in `read.tsx`'s reader card scale-down-for-bottom-sheet animation; the
fix combines removing the offending ancestor clip with `shouldRasterize`
timing (see `isRasterizingRef` / `setShouldRasterize` in `read.tsx`, which
force iOS to snapshot the view at full resolution *before* the scale-down
starts).

**Correct pattern:**

```tsx
// Enable rasterization at native resolution BEFORE the scale-down animation
// begins, and disable it once fully back at scale 1 — see read.tsx for the
// full listener-driven implementation.
const [shouldRasterize, setShouldRasterize] = useState(false);

// ... when a scale-affecting value starts moving away from 1:
setShouldRasterize(true);
// ... when it returns to 1:
setShouldRasterize(false);

<Animated.View
  needsOffscreenAlphaCompositing={shouldRasterize}
  renderToHardwareTextureAndroid={shouldRasterize}
  style={[layoutStyle, scaleAnimatedStyle]} // no overflow:"hidden" on this or any ancestor of the scaled subtree
>
  {children}
</Animated.View>
```

At minimum: audit ancestors of any scaled view for `overflow: "hidden"` and
remove it if not strictly required for a different, unrelated clip.

---

## 6. Reanimated native vs. non-native driver mix (RN `Animated`)

**Rule:** Never put a native-driver prop (`transform`) and a non-native-driver
prop (`bottom`, `height`, `padding`, etc.) on the **same** RN `Animated.View`.
Split into two nested wrappers: an **outer** `Animated.View` carrying only
non-native props, and an **inner** `Animated.View` carrying only native props.

**Why it fails:** The native driver offloads animation to the UI thread and
only supports `transform`/`opacity`. Layout properties like `bottom` or
`height` must run on the JS thread. Mixing both driver types on one
`Animated.View` throws at runtime.

**Correct pattern:**

```tsx
// Outer: non-native driver — tracks keyboard offset via `bottom`
<Animated.View style={[outerStyle, { bottom: keyboardBottomAnim }]}>
  {/* Inner: native driver — handles the open/close slide via transform */}
  <Animated.View style={[innerStyle, { transform: [{ translateY }] }]}>
    {children}
  </Animated.View>
</Animated.View>
```

Any bottom sheet or floating panel that needs both a slide animation and a
keyboard-push offset needs this two-wrapper split.

---

## 7. `withTiming`/`withSpring` cleanup gated on `finished`

**Rule:** Never gate essential cleanup logic (clearing an "isAnimating" flag,
hiding a preview/placeholder layer, resetting an interaction-blocking ref)
behind `if (finished) { ...cleanup... }` inside a Reanimated completion
callback. Run cleanup unconditionally.

**Why it fails:** `finished` is `false` whenever the shared value is
reassigned again before the current animation completes — very common with
interruptible gestures (a new drag starts, or another effect re-sets the same
shared value mid-flight). If cleanup only runs on `finished === true`, a
cancelled animation leaves the UI stuck permanently in its "animating" state.
In `read.tsx` this produced a stuck "blank page" bug: the memo card froze
edge-on (rotated ±90°) with its real WebView hidden at `opacity: 0`, because
the flip's cleanup callback only ran `if (finished)`.

**Correct pattern:**

```tsx
scale.value = withTiming(target, { duration: 200 }, (finished) => {
  // Cleanup/idle-state logic runs unconditionally — cancellation must still converge to idle.
  runOnJS(setIsAnimating)(false);

  // Only gate logic that is specifically invalid on cancellation, e.g. "did we
  // actually arrive at the new page" — and ensure some other path still
  // converges the UI back to idle when finished === false.
  if (finished) {
    runOnJS(advancePageIndex)();
  }
});
```

---

## 8. Button state, async actions, and accessibility

Treat loading, disabled, and failure behavior as part of the button design, not
as an afterthought to its styling.

### Loading and duplicate activation

- Disable the control as soon as the async action starts, and guard the handler
  itself (`if (isLoading) return`) because two events can arrive before a
  render reflects `disabled`.
- Keep the same outer and inner dimensions while loading. Replace the label
  with an `ActivityIndicator` inside the same centered content box, or reserve
  the indicator space in advance; do not let the button resize or move adjacent
  fields.
- Restore an actionable state in `finally`, including when the request throws.
  A failed request must not leave the button permanently disabled.
- For a checkbox or toggle, expose the current `checked` state rather than
  describing only the action.

### Disabled and failure feedback

- Apply a clear disabled visual state and set `disabled` on the actual
  `Pressable`; visual opacity alone does not prevent activation.
- Keep validation and request failures in the current screen as an inline,
  readable message with a retry path. `Alert.alert` or a toast can provide
  immediate attention, but must not be the only place where the failure reason
  survives.
- The signup flow in `login.tsx` is the reference for this distinction: its
  signup failure is shown inline and may also be shown in a diagnostic alert,
  so closing the popup leaves the form retryable and understandable.
- Use `accessibilityRole="button"` for actions, `"checkbox"` for agreement
  controls, and a specific `accessibilityLabel` for icon-only controls.
  Keep `accessibilityState={{ disabled, busy, checked }}` synchronized with
  the rendered state; do not announce an unavailable button as actionable.

---

## 9. Platform and interaction verification

After static review, verify the rendered button on all three targets. A button
that looks correct on web can still stretch on native because the inner
`Animated.View` receives the parent’s available height.

### Web

- Open the actual Expo web preview and test mouse click, keyboard focus, and
  Enter/Space activation where supported.
- Confirm the visual row height, text/icon visibility, focus indication, and
  that `hitSlop` did not create an unexpected overlap in the DOM layout.
- Confirm scale feedback does not hide content. Reanimated layout animations
  may be unsupported on web; do not make essential state changes depend on
  them.

### iOS

- Test inside a loose flex row and a centered/keyboard-open form. Confirm
  content-sized buttons do not fill the available height.
- Check outline borders and icons with `borderRadius`; follow section 4 and do
  not combine `borderWidth` with `overflow: "hidden"` on the same view.
- Confirm the scale press animation returns crisp text and icons. Check all
  ancestors for clipping before diagnosing a blur as a font or WebView issue.

### Android

- Test the same loose-row and keyboard-open cases, including the system back
  navigation around the button.
- Check the actual touch target and Android ripple/elevation behavior without
  changing the declared layout size. Do not use Android-only toast feedback as
  the only error message.
- If the animation also moves a panel with `bottom`/`height`, verify the
  outer non-native and inner native driver split from section 6.

### Shared interaction pass

- Test at the smallest and largest supported text/content lengths.
- Test disabled → enabled → loading → success and failure → retry transitions.
- Test a fast double tap, a tap while the keyboard opens, and a tap near an
  adjacent control. Confirm only one async request starts and the error remains
  visible after any alert closes.
- Test in both a `ScrollView` and a non-scrolling parent. Record the outer
  layout size separately from the `hitSlop`-expanded touch area.

---

## Related: worklet ref mutation (adjacent pitfall, not styling but often co-occurs)

Not a styling bug per se, but frequently discovered while debugging pitfalls
above: never write `ref.current = x` directly inside a Reanimated worklet
(gesture handlers without `.runOnJS(true)`, or `withTiming` callbacks). The
ref is deep-copied to the UI runtime; the write is silently dropped (only a
Metro `WARN [Worklets] Tried to modify key 'current'...`). Commit all
ref + state writes through a single stable `runOnJS(commitFn)(args)` call
instead. See `.agents/memory/friction-worklet-ref-mutation.md`.

---

## Source memory files

This skill consolidates the following memory topic files — consult them for
additional narrative detail if needed:
- `.agents/memory/friction-native-pill-stretch.md`
- `.agents/memory/friction-toolbar-border-overflow.md`
- `.agents/memory/friction-animated-driver-split.md`
- `.agents/memory/friction-reanimated-cancelled-callback.md`
- `.agents/memory/friction-worklet-ref-mutation.md`
