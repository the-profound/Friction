---
name: Native virtualized special groups
description: Why interactive leading content in Friction virtualized lists must use the same row model as ordinary groups.
---

Special interactive content that participates in scrolling, snapping, or anchor
restoration must be represented as a stable item in the virtualized list's data.
Do not render it as a conditional `ListHeaderComponent` while ordinary groups
are data rows.

**Why:** Native list header virtualization and nested horizontal scrolling can
take a different measurement path from data rows. A conditional header can
therefore disappear or produce stale offsets even when the equivalent web
layout appears correct.

**How to apply:** Give the special group a stable key and explicit height, put
it in the same ordered group array, and derive rendering, estimated heights,
signatures, and anchor restoration from that one array.