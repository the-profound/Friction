---
name: 401 retry fresh signal
description: customFetch 401 auto-retry signal bug and fix — retry must build a fresh timeout, not reuse the exhausted original.
---

## Rule
When the 401 auto-retry in `customFetch` fires a second `fetch` call, it must use a **fresh timeout signal** built from `buildTimeoutSignal(timeoutMs)`, never the original `effectiveSignal`.

## Why
The original `effectiveSignal` is a combination of the caller's signal and a per-request timeout signal. A slow first request (e.g. server-side question generation taking ~14 s out of a 15 s budget) nearly exhausts the timeout. By the time `_authRefreshCallback()` resolves and the retry is attempted, `effectiveSignal.aborted === true`. The retry `fetch` call receives an already-aborted signal and throws `AbortError` before it can even send a packet — making every slow-request 401 a guaranteed failure.

## How to apply
- In the 401 retry block: `const retryTimeoutSignal = buildTimeoutSignal(timeoutMs); const retrySignal = init.signal ? combineSignals(init.signal, retryTimeoutSignal) : retryTimeoutSignal;`
- Also check `init.signal?.aborted` before retrying — if the **caller** explicitly cancelled (navigation away), skip the refresh and retry entirely.
- The `timeoutMs` used for the retry should be the same per-request value extracted at the top of `customFetch` (from `options.timeoutMs ?? DEFAULT_TIMEOUT_MS`).

## Related
- `lib/api-client-react/src/custom-fetch.ts` — the fix lives in the 401 retry block
- `CustomFetchOptions.timeoutMs` — per-request timeout override (added alongside the fix)
- Question-queue calls use `request: { timeoutMs: 30_000 }` since server-side generation can take several seconds
