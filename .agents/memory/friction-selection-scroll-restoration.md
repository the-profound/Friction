---
name: Selection overlay scroll restoration
description: Preventing native list jumps when a card-selection modal restores its source slot.
---

For a cover selection modal over a native `FlatList` or `ScrollView`, capture the
outer vertical offset at the initial press, disable background scrolling while
the modal is selected, and restore that captured offset only when the user
actually closes selection. Cancel the pending restoration before navigating to
the reader. Any delayed native-dismissal correction must be tied to the same
selection session, so a close followed by an immediate new selection cannot
move the newly selected card's background.

**Why:** Native virtualized lists can automatically adjust their visible range
when the hidden origin slot is shown again during modal dismissal. A one-frame
post-dismissal correction is useful, but without cancellation/session ownership
it can race a reader navigation or rapid re-open and visibly jump the page.

**How to apply:** Reuse the shared selection scroll restoration pattern for new
CardSelectOverlay hosts. Keep normal close and reader-navigation teardown
separate: close permits restoration; reader navigation explicitly cancels it.