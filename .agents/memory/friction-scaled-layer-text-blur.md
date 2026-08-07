---
name: Scaled-layer text blur (RN/iOS)
description: Why text inside a transform-scaled card renders blurry, and the layer split that fixes it.
---

Text inside a view that is scaled down with a `transform: [{ scale }]` renders at low
resolution when that same view (or an ancestor within the scaled subtree) triggers
offscreen compositing. The two usual triggers are:

- native shadow props (`shadowOpacity`/`shadowRadius`, `elevation`) on the layer that
  also contains the text
- `overflow: "hidden"` (layer mask) on a container inside the scaled subtree

**Rule:** in any deck/pager where cards are scaled with a transform, keep the text on a
plain layer. Put the shadow on an empty absolutely-positioned sibling behind it, and
apply masking (`overflow: hidden`) only to the card that is actually at scale 1 and
actually needs clipping. Where a scaled card still needs its content bounded, give the
inner text/TextInput a fixed height and let the native text view clip itself instead of
adding an RN mask.

**Why:** the offscreen buffer is allocated at the layer's *presentation* size, so at
0.88x it captures the content at 0.88x resolution and upsamples nothing back.

**How to apply:** applies to the reader letter card and the question-card deck; check it
first whenever "text looks blurry only when shrunk" is reported. Rasterization hints
(`shouldRasterizeIOS`) are for *during* an animation only — they are not the fix for a
blurry resting state.
