---
name: Friction photo-must-be-standalone-page design
description: Why the "photo isolation" feature reuses the existing autoSplitImages HR-divider mechanism instead of a new page-array-level split, and the edge case it required fixing.
---

Task: images inserted in the [작성] writing screen must never share a page with text.

Rejected approach: flanking the image with explicit HR guard nodes plus an ongoing
ProseMirror plugin to prevent text being typed between the image and its HR dividers.
User rejected this as too complex to defend indefinitely against future edits.

Adopted approach: call the insert-time image-isolation immediately after `insertImage`
(reusing the already-existing `autoSplitImages()` WebView command that previously only
ran as a safety net at review-entry), then show an informational toast
("사진은 페이지에 단독으로만 첨부할 수 있어요") every time — no attempt to police future
edits, no separate/parallel mechanism. Since page boundaries in this editor are only ever
expressed as PAGE_DIVIDER/HR nodes inside one continuous ProseMirror doc (there is no
other page-boundary primitive), reusing the same idempotent function for both insert-time
and review-time avoids having two competing division mechanisms.

**Why:** `autoSplitImages` is idempotent (marks handled images with `data-autosplit`), so
calling it right after every insert is safe and doesn't conflict with its review-entry
safety-net invocation.

**Edge case fixed:** `autoSplitImages`'s trailing-paragraph-fallback (added so the cursor
always has somewhere to land after a destructive replaceWith) skipped adding a divider
before the fallback paragraph when the *last* node in the doc was an image (because
`needHRAfter` is only computed relative to the original next-sibling, which is null at
doc end). This let a user type text directly after a doc-ending photo, merging text onto
the photo's page. Fix: if the fallback paragraph's preceding node is an image, insert an
HR before it too.

**How to apply:** Any future change to page-division/photo-isolation logic in this editor
should keep insert-time and review-time on the same underlying function rather than
inventing a second mechanism, and should re-check the trailing-fallback branch whenever
touching `autoSplitImages`.
