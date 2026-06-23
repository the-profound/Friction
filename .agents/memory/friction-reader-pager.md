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
