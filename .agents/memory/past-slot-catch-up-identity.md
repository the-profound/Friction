---
name: Past-slot catch-up identity
description: Durable identity and locking rules for filling an expired assigned CENTER slot.
---

A catch-up CENTER send still occupies its original slot using the persisted slot, round, author, and assigned-date identity. Its actual scheduled delivery instant is not part of slot identity because the server moves it to the nearest available KST 06:00.

**Why:** Requiring the delivery instant to equal the historical slot instant makes a valid catch-up letter appear beside an empty slot. Conversely, accepting client dates or checking lifecycle state without locks allows stale or handcrafted requests to bypass policy.

**How to apply:** Keep catch-up requests free of a client-selected `scheduledAt`. Under the same transaction locks used for slot binding, lock and re-read space/round lifecycle state, reject already-sent exact identities, and compute the next delivery slot on the server.