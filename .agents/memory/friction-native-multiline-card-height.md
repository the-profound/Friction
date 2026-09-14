---
name: Native multiline card height contract
description: Prevents native auto-growing text inputs from visually escaping their card or using stale keyboard-era scroll geometry.
---

For an inline native multiline editor, use one content-height measurement to size both the `TextInput` and the visible parent card surface. Include the card's vertical padding in the parent minimum height, while leaving the first unmeasured native render intrinsic so prefilled content can report its real size.

**Why:** On native React Native, updating a controlled multiline input's explicit height does not reliably make a shadowed parent surface and surrounding list behave as one visual size contract. Separately, keyboard animation can change the list viewport without changing the card height, so a card-only scroll generation can apply stale geometry.

**How to apply:** When an inline editor grows or shrinks, bind the fresh editor-key-and-width measurement to both layers. Reconcile visibility only after parent layout or viewport/keyboard geometry settles, and invalidate older queued scroll corrections with one shared revision.