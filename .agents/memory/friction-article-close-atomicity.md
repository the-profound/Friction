---
name: Friction article close atomicity
description: The invariant for saving the latest editor snapshot while entering the CLOSING stage.
---

The close boundary must save title, content, and the complete pages array together with the DIVIDING→CLOSING transition. A retry is idempotent only when the article is already CLOSING with the exact same snapshot; a different snapshot must remain a conflict rather than silently overwriting newer work.

**Why:** Separate PATCH and transition requests let a detached editor save race with the stage change, producing extra requests and leaving concurrency rules in the client.

**How to apply:** Keep the close API transaction and the closing screen's single mutation aligned. Do not reintroduce a PATCH→transition→GET confirmation sequence for export.