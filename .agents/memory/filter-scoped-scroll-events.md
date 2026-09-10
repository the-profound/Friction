---
name: Filter-scoped scroll events
description: Prevents delayed FlatList scroll events from corrupting another filter's remembered position.
---

When one mounted list swaps data between filters, attribute every scroll event to the filter and item-key snapshot from the render that installed that handler. Do not look up the active filter or keys through refs that a newer render may already have changed.

**Why:** React Native Web, iOS, and Android can emit a final layout or programmatic scroll event after a filter render begins. Reading next-render refs assigns that outgoing event to the incoming filter and silently overwrites its saved position.

**How to apply:** For filter-specific list positions, capture the filter key in the callback closure. For index/anchor paging, capture both the filter key and that render's ordered item keys. Regression tests should bind each handler assertion to its specific list ref, not merely check that both handler names occur somewhere.