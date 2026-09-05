---
name: Swipeable card edge ornaments
description: How to keep crown/star-style edge ornaments visible on cards inside clipped swipe rows.
---

Reserve the ornament's top overflow inside the swipe row's clipping boundary, then offset the row's outer layout by the same amount so list spacing stays unchanged. The ornament must remain in the horizontally translated content subtree.

**Why:** Swipe action rows need horizontal clipping, so a card ornament positioned above the child's boundary is otherwise cut off. Moving it outside the swipe row leaves it visually detached while the card moves.

**How to apply:** For any crown, star, or badge that straddles a swipeable card edge, allocate internal top space equal to the negative ornament offset and align the revealed action surface below that space.