---
name: CanonicalCardSlot press-scale unification
description: How CanonicalCardSlot's outer clip box and ArticleCardCover's own corners stay in sync during a ScalePressable press animation.
---

Two related corner-clipping bugs and their fix:

1. **Clip-box vs. content mismatch (CanonicalCardSlot).** CanonicalCardSlot
   projects an ArticleCardItem drawn at canonical size (~300×480) down into a
   smaller fixed slot via a static `transform: scale`. The outer box owns
   the final radius + `overflow:"hidden"` clip and is fixed-size; the press
   shrink from ScalePressable used to animate only the inner canonical-sized
   content, so pressing opened a gap between the shrunk card and the
   never-moving outer clip boundary.
   - **Fix:** CanonicalCardSlot creates one `pressScale` shared value,
     applies it as its own outer-view transform (so the clip box + radius
     scale as a unit), and injects the same shared value into its single
     child via `React.cloneElement(children, { pressScale })`. ArticleCardItem
     forwards it to ScalePressable as `externalScale`, with
     `applyScaleStyle={false}` so the scale is applied exactly once (on the
     ancestor), never twice.
   - `ScalePressable` gained `externalScale`/`applyScaleStyle` props for
     exactly this ancestor-mirrors-descendant-press-state pattern — reuse it
     for any other "outer clip owns final radius, inner content is a scaled
     projection" structure, rather than inventing a new mechanism.

2. **Cover self-clipping (ArticleCardCover).** The cover's cover image relied
   on its own internal border-radius clip instead of the surrounding
   `ArticleCardCover` root view clipping itself; under a live scale
   transform the two could drift a hairline apart, leaking the shadow
   layer's background color along the rounded corners. Fix: give
   `ArticleCardCover`'s root view its own `overflow:"hidden"` so image,
   overlay, and background all share one clip boundary. Cheap, safe change —
   apply to any similar "inner surface trusts a child's own radius clip"
   pattern.

**Why this matters:** a fixed-size clip ancestor and a scaled/animated
content descendant must be scaled as a single transformed node (or mirror
the exact same shared value), never independently — nesting-based transform
composition, not after-the-fact radius matching, is what keeps corners
aligned during a press/hero animation.
