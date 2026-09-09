---
name: Space-detail unsent letter boundary
description: Public/readable space-letter rules when author-facing reservation management still needs unsent rows.
---

Space detail may receive an author's unsent letter row because reservation management still needs that identity. Treat API availability and readable-card availability as separate contracts: only a current `SENT` reservation or a genuinely never-scheduled legacy letter may expose a title, cover, or reader entry.

**Why:** Letting authors bypass the server release filter is necessary for management, but reusing that raw list in the carousel leaks pending content. Conversely, omitting another author's pending row means a past slot cannot truthfully be labeled “글 없음”; delivery may simply be delayed.

**How to apply:** Filter every space-detail card/count through the SENT-or-true-legacy rule. Render exact own pending reservations as non-interactive scheduled slots. For another user's past slot with no public letter, use privacy-neutral copy that describes only what is publicly visible.