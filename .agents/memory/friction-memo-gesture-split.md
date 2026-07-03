---
name: Friction memo card scroll vs page-flip gesture
description: How keyboard-open drag-to-scroll coexists with the memo swipe-flip gesture, and how typing overflow auto-advances pages
---

# Keyboard-open drag scrolls the card; keyboard-closed drag flips pages

The reading-mode memo's pan gesture branches on `keyboardVisibleRef.current` at
the very top of `onUpdate`/`onEnd`/`onFinalize` in `read.tsx`: keyboard visible
→ translate the whole card (a `translateY` shared value composed into the same
`memoAnimStyle` as the existing slide-in `translateX`), keyboard hidden →
unchanged 3D flip logic. The native WebView's own scroll is fully disabled
(`scrollEnabled={false}`) for memo usage so the card-translate gesture is the
only way to reveal text hidden behind the keyboard — letting the WebView also
scroll internally would fight the gesture.

**Why:** card-translate (not internal WebView scroll) keeps the reveal
animation on the RN/Reanimated side where it can be composed with the
existing flip machinery and guaranteed smooth; WebView-internal scroll can't
be driven by a RN gesture without also fighting the browser's own
scroll-into-view-on-caret behavior.

**How to apply:** when keyboard closes, a `memoReturningRef` flag blocks the
pan gesture entirely while the card animates back to translateY=0 — without
that guard, `keyboardVisibleRef.current` flips to flip-mode instantly and the
still-offset card would jump into 3D-flip physics mid-return.

**Gotcha:** Gesture Handler's `translationY` resets to 0 at the start
of every new pan gesture, but the card intentionally stays offset
after each release (no snap-back while editing). Naively assigning
`memoEditScrollY.value = translationY` in `onUpdate` makes the card
visibly SNAP toward 0 the instant a new drag begins, then jump back
out — capture the card's current offset in `.onBegin()` into a ref and
add `translationY` on top of that captured start value instead.

# Overflow-split state update must be built as one atomic array

When applying a WebView-reported split, do NOT call a separate
per-page `saveMemoPage(idx, beforeMarkdown)` (which uses a functional
`setMemoPages(prev => ...)`) and then separately build `nextPages`
from a `pages` snapshot taken earlier in the same function — the
snapshot won't reflect the functional update yet, so the final
`setMemoPages(nextPages)` silently overwrites `saveMemoPage`'s change
and `idx` keeps its pre-split (un-truncated) content. Build a single
`nextPages` array that sets both `nextPages[idx] = beforeMarkdown` and
the merged next-page content, then commit it with one `setMemoPages`.

# Typing overflow auto-split reuses probe, not decoration

`setOverflowProbeConfig(px, autoSplit)` in the WebView editor bridge can run
in two modes: `autoSplit=false` (existing behavior — dispatches a
ProseMirror decoration highlighting the overflow range, used by the 기록 tab's
review UI) or `autoSplit=true` (memo mode — instead of decorating, cuts the
doc at the overflow position via `doc.cut()` + `DOMSerializer` and posts
`onOverflowSplit{beforeMarkdown, afterMarkdown}` to RN). The split event is
**only a report** — the WebView doc itself is never truncated. RN must call
`setMarkdown(beforeMarkdown)` on the same editor to actually apply the cut,
and separately merge `afterMarkdown` into the next page's content.
