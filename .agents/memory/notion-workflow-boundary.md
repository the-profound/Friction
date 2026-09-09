---
name: Notion workflow boundary
description: The supported Replit-to-Notion workflow is file-based Markdown publishing, not Queue ingestion or Quick Writeback.
---

The supported workflow for this workspace is publishing a completed UTF-8
Markdown specification file through the Replit Notion connector. Queue
selection, Queue status updates, SSOT interpretation, and legacy Quick
Writeback are not part of the active workflow.

**Why:** The project intentionally consolidated the two-way Notion skill
surface into one low-cost, deterministic publisher so completed specifications
can be recorded without reintroducing the old Queue orchestration flow.

**How to apply:** Start from `scripts/src/notion-publisher` for new Notion
publishing work. Do not restore Queue/SSOT behavior into the active
Replit2Notion skill unless the user explicitly requests a new workflow.