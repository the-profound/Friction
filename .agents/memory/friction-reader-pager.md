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
