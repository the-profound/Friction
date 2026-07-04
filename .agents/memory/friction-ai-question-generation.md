---
name: Friction AI question generation
description: Orval query hook enabled-option typing quirk, and expected fallback behavior for low-signal LLM content in the article-questions feature.
---

# AI question generation (article finalize → 5 reflection questions)

## Orval query hooks require an explicit `queryKey` when passing `enabled`
When calling a generated `useGetX(id, { query: { enabled: ... } })` hook, `tsc`
requires `queryKey` to be present in that options object too (the generated
`UseQueryOptions` type is not fully `Partial`). Every existing call site in the
codebase already does this:
```ts
{ query: { queryKey: getGetXQueryKey(id), enabled: someCondition } }
```
Omitting `queryKey` compiles fine at first read but fails `tsc --noEmit` with
"Property 'queryKey' is missing". Grep for `enabled:` usages in the target app
to copy the exact pattern before adding a new gated query hook call.

**Why:** discovered when adding `useGetArticleQuestions(articleId, { query: { enabled: !!articleId } })` — passed typecheck was missing `queryKey`.

## Low-signal article content legitimately fails LLM question validation — not a bug
The question-generation service (gpt-5-mini, 5 open-ended Korean questions,
strict per-question validation: length + must end in "?") correctly produces
`FAILED` status (and the caller falls back to the fixed 3 questions) when the
source article content is placeholder/garbage text (e.g. repeated digit
strings) or otherwise too sparse for the model to produce 5 valid reflective
questions. Confirmed via direct end-to-end testing against real Supabase-backed
dev data: substantive articles reliably produce 5 valid questions, garbage
content reliably (and correctly) falls back. Don't chase this as a generation
bug — verify by checking the actual article content first.

**Why:** wasted time double-checking a live finalize test where FAILED
appeared; direct invocation with the same content class reproduced the exact
same (correct) fallback behavior.
