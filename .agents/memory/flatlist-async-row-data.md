---
name: FlatList async row data
description: Prevents virtualized rows from retaining stale external async data.
---

When a `FlatList` row reads data from an async map that is not part of the list's `data`, update both the memoized `renderItem` dependency and the list's `extraData`.

**Why:** A query can resolve successfully while visible rows continue rendering the empty map captured on the first render. Updating only the map does not guarantee a pure virtualized list will revisit its cells.

**How to apply:** Include the derived map (or a stable revision token) in `renderItem` dependencies and pass the same value through `extraData`. For authenticated row data, also gate queries on completed auth restoration and scope query keys by user.