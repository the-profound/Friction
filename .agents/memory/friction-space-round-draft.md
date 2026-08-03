---
name: Friction space-round draft data flow
description: Where the "회차 구성 초안" (round title/description draft) actually lives and how it flows into space-start.
---

- `SpaceRound` rows are created (one per round) at space-creation time with `title: null, description: null` — they exist in the DB well before the operator reaches the "공간 시작하기" flow.
- Operators can pre-fill a round's title/description earlier via the 회차 관리 screen (`of-space-rounds.tsx`'s `RoundEditSheet`, `PATCH /spaces/:id/rounds/:roundId`). So the real "draft" the user means by "이미 작성된 초안" is the current state of these DB rows, not anything local-only in the start-flow UI.
- `POST /spaces/:id/start` deletes and recreates all `SpaceRound` rows from whatever `rounds` array the client submits — the start screen's local state is authoritative at submit time, but it must be *seeded* from the existing draft rows on entry, or it silently overwrites real data with blanks.
- **How to apply:** when a start/onboarding-style screen edits data that already exists from an earlier step (rounds, drafts, etc.), always fetch and seed local component state from the live records first; don't assume "not yet visited this screen" means "no data exists yet."
