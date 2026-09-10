---
name: Body typography measurement
description: Durable rules for keeping visible WebView letter layout and pagination measurements identical.
---

Measure page overflow from the same composed block structure the visible editor and reader use. Independent block heights cannot be summed safely when CSS margins collapse or when Markdown groups list and quote children.

**Why:** Isolated measurements silently diverged for paragraph-to-heading transitions, grouped lists, explicit line breaks, and authored blank paragraphs even though the configured font size and line height matched.

**How to apply:** Preserve explicit breaks and authored blank paragraphs before fragmenting Markdown; measure cumulative composed prefixes for boundary detection. Binary-split candidates must keep the exact emitted block shape, and internal blank markers must be restored before persistence.

Candidate measurements are not sufficient after Markdown balancing or page recomposition. Remeasure every final page with the visible typography contract; correct it or fail explicitly if it still overflows. Keep the editor read-only from source export through apply, and cancel the operation if font/typography context changes.