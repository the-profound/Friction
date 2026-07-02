---
name: Friction reader page-turn animation
description: Why the read.tsx page-turn must use a side-by-side pager, and the padding/pagination coupling across the 4 reader screens
---

# Page-turn must be a side-by-side pager (no overlapping WebViews)

The reader (`app/read.tsx`) renders each page's body inside a `WebViewMarkdownReader`
(react-native-webview). Native WebViews do **not** honour React Native `zIndex` when
two of them overlap — the upper page's background cannot hide the lower page's text.

**Rule:** never overlap two page WebViews and rely on z-index to layer them. Lay the
prev/current/next slots out adjacently (`left = relPos * containerWidth`, i.e. −W / 0 / +W)
and translate the whole strip with one shared `translateX` (forward → 0→−W, backward → 0→+W).
Then each page's background + text move together as one solid sheet.

**Why:** an earlier attempt used per-slot z-index layering (current on top slides left,
next underneath). It looked fine for plain Views but with WebViews the next page's text
bled on top of the sliding page → visible text overlap during every turn. Adjacent
layout is the only reliable fix.

# Reader padding ↔ pagination coupling (4 screens share one SSOT)

`computeBodyLayout()` in `lib/bodyLayout.ts` is the single source of truth for
`paddingX`/`safeAreaWidth`/`textColumnWidth`, driven by `ReaderTokens.padding.xCqi`.
Write (on-01a), split (on-01b), finish (on-01c) and read (read.tsx) all go through it.

Pages are pre-paginated at split time and stored in `article.pages`; read displays them
with `scrollEnabled={false}` (content **clips**, never scrolls). So the read column width
must match the column width pages were split at, or the last lines clip.

**How to apply:** to change the letter's side margins, change the shared
`ReaderTokens.padding.xCqi` token (not a read-only override) so all 4 screens stay in
lockstep and newly created letters paginate correctly. Letters created before the change
keep their old split and may reflow/clip slightly — that is the unavoidable cost.

# Memo-mode swipe flip: nested GestureDetector reuses button flip primitives

`read.tsx` has an outer `panGesture` for the non-memo page pager that early-returns
when memo mode is active. The memo swipe-to-flip feature adds a **separate, nested**
`GestureDetector`/`Gesture.Pan()` wrapping just the memo overlay `Animated.View` —
it does not extend/modify the outer gesture. `onUpdate` drives the same
`memoFlipAngle` shared value the button flow already animates via `runFlip`, and
`onEnd` (past a distance/velocity threshold) calls the existing `flipToPage()`
directly rather than duplicating the export→edge-on→swap→return sequence.

**Why:** `runFlip` already resumes correctly from a non-zero starting angle, so
drag-then-release-to-commit "just works" by handing off to it — no special-cased
"resume from mid-drag" logic was needed.

**Boundary behavior differs from the button:** at the first/last page, the button
(`handleNextMemoPage`) auto-creates a new blank page. The swipe gesture must NOT do
this — swiping past a boundary should show reduced-range resistance then always
snap back to 0°, never auto-create pages or navigate.

**WebView selection conflict:** the memo editor's own text-selection-handle drag
(inside the TipTap WebView) must suppress the swipe gesture, or dragging a selection
handle gets misread as a page-turn attempt. Solved by threading an
`onTextSelectionActiveChange` boolean prop up from `WebViewMarkdownEditor` (fired on
`onSelHandleDragStart`/`onSelHandleDragEnd` bridge messages) through `MemoWebEditor`
to `read.tsx`, gating the pan gesture's `onUpdate`/`onEnd` handlers.

**Flip axis matches the physical hinge, not the drag convention people expect
by default:** `rotateX` rotates around a *horizontal* axis (like flipping a
notepad page over its top/bottom edge), so the pan gesture must measure
*vertical* finger movement (`translationY`/`velocityY`), not horizontal — an
initial horizontal-drag implementation looked disconnected from the visual
flip and had to be swapped to vertical.

**Avoid a real second WebView for the "page revealed underneath" effect —
and prefer a static preview layer over a veil once "always visible" is a
requirement.** A first attempt used a "veil" (`Animated.View`, solid
`MEMO_BG`, opacity 1→0) to hide the instant content-swap at 90° edge-on, then
faded away to reveal the new page. That only reveals the destination page at
the very end, which fails a stricter requirement: the destination page must
be visible *underneath* the flipping page from the moment it starts lifting,
like a real stack of overlapping paper. The fix: render the destination
page's content as a **plain, non-WebView static preview** (reuse the existing
markdown block renderer — `parseMarkdownBlocks()` + `<MarkdownBlock>`, the
same one `PretextMeasureLayer` uses) in a sibling `View` positioned underneath
(rendered before, at the same absolute position as) the rotating WebView
card — never rotated itself. It's swapped in via a JS-thread callback the
instant a drag/flip starts (not at edge-on), so as the rotating WebView
foreshortens toward 90° it visually thins and the always-already-there static
page shows through naturally, no fade/veil needed. Still only one real
WebView instance exists (the static layer is plain RN views/text), so the
known WebView-zIndex-bleed issue above never comes into play.

# Per-card animated shadows: use boxShadow, never elevation

Each pager slot (next/current/prev) needs its own shadow. Android `elevation`
controls BOTH shadow intensity AND sibling paint order, so giving slots different
elevations reorders them (e.g. a high-elevation bottom slot draws over the page
above it). `boxShadow` (RN 0.81+, cross-platform incl. Android & RN-web) casts a
shadow WITHOUT touching z-order, so render order [next, current, prev] is preserved.

**Pattern:** put a separate absolutely-positioned shadow layer (bg = page color +
`boxShadow`) BEHIND each slot's opaque `slotContent`; animate that layer's
**opacity** (reliably animatable in Reanimated 4 — animating boxShadow strings is
not). The opaque content hides the box interior, leaving only the radiated shadow.

**Resting model (avoids the "shadow suddenly darkens on commit" bug):** only the
bottom `next` slot casts a static shadow (opacity 1). `current` shadow opacity grows
0→1 with its swipe-out progress (`-currentSlotSV/W`, same factor as its 0°→-4° tilt
— "lifting paper"). `prev` shadow fades 1→0 as it settles in (`1-(prevSlotSV+W)/W`).
So the resting stack always shows exactly one shadow, and forward/backward commits
are seamless because the at-rest top cards contribute zero shadow.

# Live WebView under rotateX goes blank/laggy — swap to a plain view while animating

Once the destination page had a static preview underneath (see above), the *front*
(currently rotating) layer was still the real interactive WebView, and it looked
blank during the flip with content only "popping in" after the animation finished.
Native WebViews under an RN 3D `rotateX` transform go blank/white and lag on
content updates — this is a rendering limitation of the WebView layer itself, not
a sequencing bug.

**Fix:** never let the real WebView be the thing that's animating. Add a plain
`frontBlocks` static render (same `parseMarkdownBlocks()` + `<MarkdownBlock>`
pattern as the destination preview) as a sibling layer inside the rotating card,
and hide the real WebView (`opacity:0` + `pointerEvents:"none"`) for the whole
`isFlipping` duration (drag start through settle-to-0°, including cancelled/
snap-back drags) — reveal it again only once the angle is back at rest. The
WebView is only needed for interactivity, and interactivity is meaningless while
mid-rotation anyway.
