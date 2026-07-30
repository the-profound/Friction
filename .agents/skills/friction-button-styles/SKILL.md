---
name: friction-button-styles
description: >
  Button/Pressable/animated-view styling pitfalls in the Friction app (RN + Reanimated
  on iOS/Android). Read this BEFORE writing or editing any button, ScalePressable,
  pill/capsule component, toolbar icon button, or scale/transform animation, so the
  same five recurring visual bugs are not reintroduced.
---

# Friction: Button / Pressable style pitfalls

Five distinct visual bugs have each been hit **more than once** in this codebase
because of RN / Reanimated / iOS layout quirks around how `ScalePressable` and
`StyleSheet` are used here. This skill is the consolidated reference — check the
list below before shipping any new button, pressable, or animated view.

Reference implementation: **`components/shared/PillButton.tsx`** — it combines the
fixes for pitfalls #1 and #2 correctly (fixed height on every layer, no
`overflow: hidden` misuse). Read it alongside this file as a working example.

## Pre-ship checklist

Run through this for every new/edited button, `ScalePressable` usage, or
animated view:

- [ ] If it's a pill/capsule/circle button: does every layer (outer style,
      `ScalePressable`/`Pressable` style, `contentStyle`) have an **explicit fixed
      `height`** (not just `paddingVertical`)? Are `flexGrow: 0` / `flexShrink: 0`
      set where the button sits inside a `flex` row?
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

---

## 1. `ScalePressable` inner-view stretch

**Rule:** Never rely on flex alignment props (`alignSelf: "flex-start"`,
`alignItems: "flex-start"`) alone to keep a pill/capsule button from stretching
vertically on native. Give an **explicit fixed `height`** to the outer wrapper,
the `ScalePressable`/`Pressable` style, and the inner `contentStyle` — and set
`flexGrow: 0` on all three.

**Why it fails:** `ScalePressable`'s inner `Animated.View` (`styles.inner` in
`ScalePressable.tsx`) is `flexGrow: 1, alignSelf: "stretch"` by design, so it
fills whatever height its parent gives it. On web this is invisible because the
parent's height is usually already content-sized, but on native, if any
ancestor row doesn't tightly constrain height, the button silently expands to
fill available vertical space. This has hit the app's filter pills (공간 tab)
and remains latent risk in inline-styled buttons like `modalCancelBtn` /
`modalConfirmBtn` in `of-space-start.tsx`, which use only `paddingVertical: 12`
with no fixed `height`.

**Correct pattern** (see `PillButton.tsx` for the full working version):

```tsx
const PILL_HEIGHT = 40;

const styles = StyleSheet.create({
  pill: {
    height: PILL_HEIGHT,       // fixed height on the ScalePressable's own style
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 999,
    justifyContent: "center",
  },
  pillContent: {
    height: "100%",            // contentStyle also constrained
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});

<ScalePressable style={styles.pill} contentStyle={styles.pillContent}>
  <Text>Label</Text>
</ScalePressable>
```

**Known fragile locations (not yet fixed, on the radar):**
- `artifacts/friction/app/of-space-start.tsx` — `modalCancelBtn` (~line 2225) and
  `modalConfirmBtn` (~line 2239): both use `paddingVertical: 12` only, no
  fixed `height`.

---

## 2. `borderWidth` + `overflow: "hidden"` on the same view

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

## 3. `overflow: "hidden"` on ancestors of scale-transform views

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

## 4. Reanimated native vs. non-native driver mix (RN `Animated`)

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

## 5. `withTiming`/`withSpring` cleanup gated on `finished`

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
