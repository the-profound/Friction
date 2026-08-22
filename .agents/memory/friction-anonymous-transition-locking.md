---
name: Anonymous-space transition locking
description: Concurrency rule for switching a recruiting space between public and anonymous while users join or are approved.
---

Any transaction that creates, activates, or reserves a space identity must lock the space row and then re-read the space inside that transaction before deciding whether a nickname is required.

**Why:** A request can read a public-space snapshot, wait behind a simultaneous public-to-anonymous update, and otherwise commit a pending or approved identity without a nickname after the conversion finishes. Sharing a row lock is insufficient if validation still uses the pre-lock snapshot.

**How to apply:** Use the same space-row lock for anonymity changes and all participation, invitation-acceptance, and application create/approval paths. Derive nickname requirements, conflict checks, and identity-sensitive responses from the post-lock row.