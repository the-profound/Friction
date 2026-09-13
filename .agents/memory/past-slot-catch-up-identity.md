---
name: Past-slot catch-up identity
description: Durable identity and locking rules for filling an expired assigned CENTER slot.
---

A catch-up CENTER send still occupies its original slot using the persisted slot, round, author, and assigned-date identity. Its actual scheduled delivery instant is not part of slot identity because the server moves it to the nearest available KST 06:00. Recovery must choose one canonical attempt per immutable identity, not one per reservation ID.

**Why:** Requiring the delivery instant to equal the historical slot instant makes a valid catch-up letter appear beside an empty slot. Conversely, accepting client dates or checking lifecycle state without locks allows stale or handcrafted requests to bypass policy. Reservation-ID idempotency alone does not prevent duplicate delivery when the same slot has multiple failed or replacement attempts.

**How to apply:** Keep catch-up requests free of a client-selected `scheduledAt`. Under the same identity advisory lock used by creation, re-read lifecycle and competing attempts, prefer active/SENT replacements, choose one deterministic failed attempt, and compute delivery at server-selected KST 06:00.