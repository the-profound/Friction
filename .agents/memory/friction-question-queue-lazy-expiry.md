---
name: Question-queue lazy expiry ordering
description: How age-based expiry composes with the existing cleanup/trim normalization steps and with the immediate-vs-background AI fill paths, for the thought question queue.
---

# Question-queue lazy expiry ordering

## Compose expiry as its own step between cleanup and trim
`normalizeQuestionQueue` in `artifacts/api-server/src/routes/thoughts.ts` already ran
`cleanupQuestionQueue` (drop rows whose thought no longer exists/qualifies) then
`trimQuestionQueue` (drop FIFO overflow beyond the target size). Age-based expiry
(a PRELIMINARY question queued longer than a threshold with no activation) is a
third, independent reason to drop a row. Implement it as its own function
(`expireQuestionQueue`) inserted between cleanup and trim, operating on the
already-cleaned `queued` array and returning the surviving subset — do not fold the
age check into `cleanupQuestionQueue`'s single SQL statement or into `trimQuestionQueue`'s
overflow slice, since those two have different deletion reasons (existence/status vs.
FIFO position) and mixing them makes the row-count math for background AI fill
(`needed = TARGET - currentQueueLength`) harder to reason about.

**Why:** this is a lazy-cleanup design (task explicitly ruled out a cron job) — expiry
must run on both the GET queue-read path and the POST refresh path, and both already
call `normalizeQuestionQueue` at the start of their transaction, so adding the step
there covers both call sites for free without touching either route handler.

## Remember refresh's AI fill is synchronous, not background
`GET /thoughts/question-queue` schedules AI fill via `scheduleBackgroundGeneration`
(fire-and-forget, drained only in tests via `_drainBackgroundGenerations`). But
`POST /thoughts/question-queue/refresh` and `POST /thoughts/:id/activate` run their
AI phase inline (phase1 short tx → phase2 AI outside any tx → phase3 short tx that
writes results and returns `queueSnapshot`), so their HTTP response already includes
any freshly-generated question. Do not add a `_drainBackgroundGenerations()` call
when testing refresh/activate — the newly generated card is already in the response.

**How to apply:** when writing a regression test that seeds source candidates and
expects an AI-generated card to appear, check which route is under test before
deciding whether to await background drain or just read the response body directly.
