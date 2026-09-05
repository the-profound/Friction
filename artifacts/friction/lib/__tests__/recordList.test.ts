import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError, type Thought } from "@workspace/api-client-react";
import {
  buildRecordDateGroups,
  buildMixedRecordGroups,
  buildUnifiedRecords,
  classifyQuestionError,
  compareRecordsNewestFirst,
  getQuestionUnavailableMessage,
  getQueuedThoughtIds,
  getQueuedThoughts,
  getRecordCardBodyLineCount,
  getThoughtPreview,
  getRecordCardContent,
  getRecordCardTitleLineCount,
  getThoughtCardContent,
  isPendingQueueQuestionThought,
  mergeRecordSession,
  normalizePreviewTitle,
  normalizePreviewText,
  resolveQuestionPlacementAnchors,
  shouldRefetchQuestionQueue,
  shouldShowQuestionErrorToast,
  type QuestionErrorKind,
  type UnifiedRecord,
} from "../recordList";

function queuedThought(id: string): Thought {
  return {
    id,
    authorId: "user-a",
    content: `# ${id}?\n\n질문 설명`,
    createdFrom: "question",
    status: "PRELIMINARY",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

/** Builds a queue-endpoint ApiError with the given HTTP status for classifier tests. */
function questionQueueApiError(status: number): ApiError {
  return new ApiError(
    new Response(JSON.stringify({ error: "boom" }), { status }),
    { error: "boom" },
    { method: "GET", url: "/thoughts/question-queue" },
  );
}

describe("record list model", () => {
  it("keeps every queued question out of ordinary thought records", () => {
    const queuedThoughts = Array.from(
      { length: 6 },
      (_, index) => queuedThought(`queued-${index + 1}`),
    );
    const listedThoughts = [
      ...queuedThoughts,
      { id: "regular-thought", updatedAt: "2026-01-02T00:00:00.000Z" },
    ] as unknown as Thought[];

    const queuedIds = getQueuedThoughtIds(queuedThoughts, queuedThoughts[0], queuedThoughts[1]);
    const records = buildUnifiedRecords(
      listedThoughts.filter((thought) => !queuedIds.has(thought.id)),
      [],
    );

    expect(records.map((record) => record.id)).toEqual(["regular-thought"]);
  });

  it("keeps a still-queued question hidden from the ordinary list even when the queue fetch fails", () => {
    // Simulates on.tsx when questionQuery has no successful data: queuedIds
    // is empty exactly like this, yet the thought list still contains the
    // question the server-side queue is holding onto.
    const emptyQueuedIds = new Set<string>();
    const stillQueued = queuedThought("leaked-queue-question");
    // The reading screen's in-context "answer this question" flow also
    // writes createdFrom:"question"/status:"PRELIMINARY", but always with a
    // sourceArticleId — it must keep showing as an ordinary card.
    const readingAnswer: Thought = { ...queuedThought("reading-answer"), sourceArticleId: "article-1" };
    const ordinary = { id: "ordinary", updatedAt: "2026-01-02T00:00:00.000Z" } as unknown as Thought;

    const records = buildUnifiedRecords(
      [stillQueued, readingAnswer, ordinary].filter(
        (thought) => !emptyQueuedIds.has(thought.id) && !isPendingQueueQuestionThought(thought),
      ),
      [],
    );

    expect(records.map((record) => record.id)).toEqual(["ordinary", "reading-answer"]);
  });

  it("keeps the queue-success exclusion behavior unchanged when combined with the resilience check", () => {
    const queuedThoughts = Array.from(
      { length: 3 },
      (_, index) => queuedThought(`queued-${index + 1}`),
    );
    const listedThoughts = [
      ...queuedThoughts,
      { id: "regular-thought", updatedAt: "2026-01-02T00:00:00.000Z" },
    ] as unknown as Thought[];

    const queuedIds = getQueuedThoughtIds(queuedThoughts, queuedThoughts[0], queuedThoughts[1]);
    const records = buildUnifiedRecords(
      listedThoughts.filter(
        (thought) => !queuedIds.has(thought.id) && !isPendingQueueQuestionThought(thought),
      ),
      [],
    );

    expect(records.map((record) => record.id)).toEqual(["regular-thought"]);
  });

  it("falls back to current and next while an older cached queue response is in use", () => {
    const current = queuedThought("current");
    const next = queuedThought("next");

    expect(getQueuedThoughtIds(undefined, current, next)).toEqual(new Set(["current", "next"]));
    expect(getQueuedThoughts(undefined, current, next)).toEqual([current, next]);
  });

  it("de-duplicates repeated queue aliases without changing FIFO order", () => {
    const current = queuedThought("current");
    const next = queuedThought("next");

    expect(getQueuedThoughts([current, next, current], current, next)).toEqual([current, next]);
  });

  it("recovers valid aliases from a malformed queue response", () => {
    const current = queuedThought("current");
    expect(getQueuedThoughts({ unexpected: true }, current, { noId: true })).toEqual([current]);
    expect(getQueuedThoughts([
      null,
      { id: "blank-card", updatedAt: "not-a-date", content: "" },
      current,
    ], null, null)).toEqual([current]);
  });

  it("refetches only after auth is ready and no queue read or mutation is active", () => {
    const state = {
      userId: "user-a",
      isLoading: false,
      isFetching: false,
      mutationPending: false,
    };
    expect(shouldRefetchQuestionQueue(state)).toBe(true);
    expect(shouldRefetchQuestionQueue({ ...state, userId: undefined })).toBe(false);
    expect(shouldRefetchQuestionQueue({ ...state, isLoading: true })).toBe(false);
    expect(shouldRefetchQuestionQueue({ ...state, isFetching: true })).toBe(false);
    expect(shouldRefetchQuestionQueue({ ...state, mutationPending: true })).toBe(false);
  });

  it("keeps FIFO queue order in the model while excluding every queued ID from date groups", () => {
    const queue = [
      queuedThought("first"),
      queuedThought("second"),
      queuedThought("third"),
    ];
    const queueIds = getQueuedThoughtIds(queue, queue[0], queue[1]);
    const normalThoughts = [
      { id: "third" },
      { id: "ordinary" },
      { id: "first" },
      { id: "second" },
    ] as Thought[];

    expect(queue.map((thought) => thought.id)).toEqual(["first", "second", "third"]);
    expect(normalThoughts.filter((thought) => !queueIds.has(thought.id)).map((thought) => thought.id))
      .toEqual(["ordinary"]);
  });

  it("sorts kinds together by newest update time with a deterministic tie-break", () => {
    const records: UnifiedRecord[] = [
      { id: "b", kind: "thought", updatedAt: "2026-01-01T00:00:00.000Z", thought: {} as never },
      { id: "a", kind: "editing", updatedAt: "2026-01-01T00:00:00.000Z", article: {} as never },
      { id: "c", kind: "letter", updatedAt: "2026-01-02T00:00:00.000Z", article: {} as never },
    ];
    expect([...records].sort(compareRecordsNewestFirst).map((record) => record.id)).toEqual(["c", "b", "a"]);
  });

  it("uses creation time rather than a later edit time for the canonical order", () => {
    const olderButEdited: UnifiedRecord = {
      id: "older",
      kind: "thought",
      updatedAt: "2026-01-05T00:00:00.000Z",
      thought: {
        createdAt: "2026-01-01T00:00:00.000Z",
      } as never,
    };
    const newer: UnifiedRecord = {
      id: "newer",
      kind: "editing",
      updatedAt: "2026-01-03T00:00:00.000Z",
      article: {
        createdAt: "2026-01-02T00:00:00.000Z",
      } as never,
    };

    expect([olderButEdited, newer].sort(compareRecordsNewestFirst).map((record) => record.id))
      .toEqual(["newer", "older"]);
  });

  it("maps article status to record kind: non-LETTER articles become editing, LETTER becomes letter", () => {
    const records = buildUnifiedRecords(
      [],
      [
        { id: "editing", status: "DIVIDING", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "letter", status: "LETTER", updatedAt: "2026-01-02T00:00:00.000Z" },
      ] as never,
    );
    expect(records.map((record) => `${record.kind}:${record.id}`)).toEqual(["letter:letter", "editing:editing"]);
  });

  it("keeps placed rows stable while prepending new rows deterministically", () => {
    const previous: UnifiedRecord[] = [
      { id: "older", kind: "thought", updatedAt: "2026-01-01T00:00:00.000Z", thought: {} as never },
      { id: "newer", kind: "thought", updatedAt: "2026-01-02T00:00:00.000Z", thought: {} as never },
    ];
    const incoming: UnifiedRecord[] = [
      { ...previous[1], thought: { content: "refreshed" } as never },
      { id: "new-b", kind: "thought", updatedAt: "2026-01-03T00:00:00.000Z", thought: {} as never },
      { ...previous[0] },
      { id: "new-a", kind: "editing", updatedAt: "2026-01-03T00:00:00.000Z", article: {} as never },
    ];

    const merged = mergeRecordSession(previous, incoming);
    expect(merged.map((record) => record.id)).toEqual(["new-b", "new-a", "older", "newer"]);
    expect((merged[3] as Extract<UnifiedRecord, { kind: "thought" }>).thought).toEqual({
      content: "refreshed",
    });
  });

  it("deduplicates late snapshots and removes rows absent from the authoritative response", () => {
    const previous: UnifiedRecord[] = [
      { id: "keep", kind: "thought", updatedAt: "2026-01-01T00:00:00.000Z", thought: {} as never },
      { id: "deleted", kind: "thought", updatedAt: "2026-01-01T00:00:00.000Z", thought: {} as never },
    ];
    const olderDuplicate = {
      id: "keep",
      kind: "thought" as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
      thought: { content: "old" } as never,
    };
    const newerDuplicate = {
      ...olderDuplicate,
      updatedAt: "2026-01-02T00:00:00.000Z",
      thought: { content: "new" } as never,
    };

    const merged = mergeRecordSession(previous, [olderDuplicate, newerDuplicate]);
    expect(merged.map((record) => record.id)).toEqual(["keep"]);
    expect((merged[0] as Extract<UnifiedRecord, { kind: "thought" }>).thought).toEqual({
      content: "new",
    });
  });

  it("does not jump existing rows across consecutive reversed refetches", () => {
    const record = (id: string, updatedAt: string): UnifiedRecord => ({
      id,
      kind: "thought",
      updatedAt,
      thought: { id, updatedAt } as never,
    });
    const initial = mergeRecordSession([], [
      record("first", "2026-01-03T00:00:00.000Z"),
      record("second", "2026-01-02T00:00:00.000Z"),
    ]);
    const afterLateResponse = mergeRecordSession(initial, [
      record("second", "2026-01-05T00:00:00.000Z"),
      record("first", "2026-01-01T00:00:00.000Z"),
      record("new", "2026-01-04T00:00:00.000Z"),
    ]);
    const afterNextRefetch = mergeRecordSession(afterLateResponse, [
      record("first", "2026-01-06T00:00:00.000Z"),
      record("new", "2026-01-04T00:00:00.000Z"),
      record("second", "2026-01-05T00:00:00.000Z"),
    ]);

    expect(afterLateResponse.map((item) => item.id)).toEqual(["new", "first", "second"]);
    expect(afterNextRefetch.map((item) => item.id)).toEqual(["new", "first", "second"]);
  });
});

describe("read.tsx thought creation batching", () => {
  const readScreen = () => readFileSync(join(__dirname, "../../app/read.tsx"), "utf8");

  it("settles every answered-card create before one list refresh", () => {
    const screen = readScreen();
    const batchStart = screen.indexOf("const results = await Promise.allSettled");
    const refresh = screen.indexOf("await invalidateThoughtLists(queryClient)", batchStart);

    expect(batchStart).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(batchStart);
    expect(screen.slice(batchStart, refresh).match(/upsertThoughtInRecordCaches/g)).toHaveLength(1);
  });

  it("claims answered cards synchronously so overlapping completion paths cannot duplicate them", () => {
    const screen = readScreen();
    const handlerStart = screen.indexOf("const applyAnsweredQuestionCardsToMemo");
    const firstAwait = screen.indexOf("await queryClient.cancelQueries", handlerStart);
    const beforeAwait = screen.slice(handlerStart, firstAwait);

    expect(beforeAwait).toContain("if (answeredQuestionBatchClaimedRef.current) return;");
    expect(beforeAwait).toContain("answeredQuestionBatchClaimedRef.current = true;");
  });
});

describe("isPendingQueueQuestionThought", () => {
  it("recognizes a queue-shaped thought independently of the queue response", () => {
    expect(isPendingQueueQuestionThought({
      createdFrom: "question",
      status: "PRELIMINARY",
      sourceArticleId: null,
    })).toBe(true);
    expect(isPendingQueueQuestionThought({
      createdFrom: "question",
      status: "PRELIMINARY",
      sourceArticleId: undefined,
    })).toBe(true);
  });

  it("excludes an in-reading question answer, which always carries a sourceArticleId", () => {
    expect(isPendingQueueQuestionThought({
      createdFrom: "question",
      status: "PRELIMINARY",
      sourceArticleId: "article-1",
    })).toBe(false);
  });

  it("excludes an activated question once status has moved on to NORMAL", () => {
    expect(isPendingQueueQuestionThought({
      createdFrom: "question",
      status: "NORMAL",
      sourceArticleId: null,
    })).toBe(false);
  });

  it("excludes every other creation source", () => {
    for (const createdFrom of ["quoted", "reading", "direct"] as const) {
      expect(isPendingQueueQuestionThought({
        createdFrom,
        status: "PRELIMINARY",
        sourceArticleId: null,
      })).toBe(false);
    }
  });
});

describe("classifyQuestionError", () => {
  it("classifies network failures from both React Native and browser fetch", () => {
    expect(classifyQuestionError(new TypeError("Network request failed"))).toBe("network");
    expect(classifyQuestionError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("classifies abort/timeout errors by name regardless of error class", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyQuestionError(timeout)).toBe("timeout");
    expect(classifyQuestionError(abort)).toBe("timeout");
  });

  it("classifies 401/403 as auth and 5xx as server", () => {
    expect(classifyQuestionError(questionQueueApiError(401))).toBe("auth");
    expect(classifyQuestionError(questionQueueApiError(403))).toBe("auth");
    expect(classifyQuestionError(questionQueueApiError(500))).toBe("server");
    expect(classifyQuestionError(questionQueueApiError(503))).toBe("server");
  });

  it("classifies a 404 as unsupported, since the queue handler never returns one itself", () => {
    expect(classifyQuestionError(questionQueueApiError(404))).toBe("unsupported");
  });

  it("falls back to unknown for anything else", () => {
    expect(classifyQuestionError(null)).toBe("unknown");
    expect(classifyQuestionError(new Error("boom"))).toBe("unknown");
    expect(classifyQuestionError(questionQueueApiError(400))).toBe("unknown");
  });
});

describe("getQuestionUnavailableMessage", () => {
  const kinds: QuestionErrorKind[] = ["timeout", "network", "auth", "unsupported", "server", "unknown"];

  it("gives every failure kind a non-empty message", () => {
    for (const kind of kinds) {
      expect(getQuestionUnavailableMessage(kind).length).toBeGreaterThan(0);
    }
  });

  it("never invites a retry when the server does not support the feature at all", () => {
    const message = getQuestionUnavailableMessage("unsupported");
    expect(message).not.toContain("다시 시도");
    expect(message).not.toContain("당겨");
  });

  it("is the single source both the toast and the empty state read from, so identical kinds always match", () => {
    for (const kind of kinds) {
      expect(getQuestionUnavailableMessage(kind)).toBe(getQuestionUnavailableMessage(kind));
    }
  });
});

describe("shouldShowQuestionErrorToast", () => {
  it("shows the first failure observed in a session", () => {
    expect(shouldShowQuestionErrorToast("network", null)).toBe(true);
  });

  it("suppresses a repeat of the same failure kind", () => {
    expect(shouldShowQuestionErrorToast("network", "network")).toBe(false);
    expect(shouldShowQuestionErrorToast("unsupported", "unsupported")).toBe(false);
  });

  it("still shows when the failure kind changes", () => {
    expect(shouldShowQuestionErrorToast("auth", "network")).toBe(true);
  });

  it("shows again after a success resets the suppression back to null", () => {
    const resetAfterSuccess: QuestionErrorKind | null = null;
    expect(shouldShowQuestionErrorToast("network", resetAfterSuccess)).toBe(true);
  });
});

describe("on.tsx question queue wiring", () => {
  const readScreen = () =>
    readFileSync(join(__dirname, "../../app/(tabs)/on.tsx"), "utf8");

  it("hides a leaked queue question from the ordinary list independently of queuedIds", () => {
    const screen = readScreen();
    expect(screen).toContain(
      "!queuedIds.has(thought.id) && !isPendingQueueQuestionThought(thought)",
    );
  });

  it("delegates error classification and copy to the single recordList source instead of a local copy", () => {
    const screen = readScreen();
    expect(screen).not.toMatch(/type QuestionErrorKind =/);
    expect(screen).not.toMatch(/function classifyQuestionError/);
    expect(screen).toContain("classifyQuestionError(questionQuery.error)");
    expect(screen).toContain("getQuestionUnavailableMessage(errorKind)");
    expect(screen).toContain("getQuestionUnavailableMessage(questionErrorKind)");
  });

  it("suppresses repeat-kind toasts and resets suppression on the next queue success", () => {
    const screen = readScreen();
    expect(screen).toContain("if (questionQuery.isSuccess) {");
    expect(screen).toContain("lastShownQuestionErrorKindRef.current = null;");
    expect(screen).toContain(
      "if (!shouldShowQuestionErrorToast(errorKind, lastShownQuestionErrorKindRef.current)) return;",
    );
  });
});

describe("record card date groups", () => {
  const thought = (id: string, updatedAt: string): UnifiedRecord => ({
    id,
    kind: "thought",
    updatedAt,
    thought: {} as never,
  });
  const editing = (id: string, updatedAt: string): UnifiedRecord => ({
    id,
    kind: "editing",
    updatedAt,
    article: {} as never,
  });

  it("uses KST midnight boundaries and orders days and records newest first", () => {
    const groups = buildRecordDateGroups([
      thought("previous-day", "2026-01-01T14:59:59.000Z"), // KST 1/1 23:59:59
      editing("newest", "2026-01-02T01:00:00.000Z"), // KST 1/2 10:00
      thought("same-day-older", "2026-01-01T15:00:00.000Z"), // KST 1/2 00:00
    ]);

    expect(groups.map((group) => group.dateKey)).toEqual(["2026-01-02", "2026-01-01"]);
    expect(groups[0].records.map((record) => record.id)).toEqual(["newest", "same-day-older"]);
    expect(groups[1].records.map((record) => record.id)).toEqual(["previous-day"]);
  });

  it("keeps mixed record kinds and timestamp ties deterministic within a date", () => {
    const groups = buildRecordDateGroups([
      thought("b", "2026-02-03T01:00:00.000Z"),
      editing("a", "2026-02-03T01:00:00.000Z"),
      thought("latest", "2026-02-03T02:00:00.000Z"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((record) => `${record.kind}:${record.id}`)).toEqual([
      "thought:latest",
      "thought:b",
      "editing:a",
    ]);
  });

  it("can preserve a session-merged order while retaining date groups", () => {
    const groups = buildRecordDateGroups([
      thought("placed-first", "2026-02-03T01:00:00.000Z"),
      thought("placed-second", "2026-02-03T03:00:00.000Z"),
    ], { preserveRecordOrder: true });

    expect(groups[0].records.map((record) => record.id)).toEqual([
      "placed-first",
      "placed-second",
    ]);
  });

  it("preserves current-question metadata while grouping filtered card records", () => {
    const currentQuestion = {
      ...thought("question", "2026-03-04T01:00:00.000Z"),
      isQuestion: true,
    };
    const regularThought = {
      ...thought("regular", "2026-03-04T00:00:00.000Z"),
      isQuestion: false,
    };

    const groups = buildRecordDateGroups([regularThought, currentQuestion]);

    expect(groups[0].records.map((record) => record.isQuestion)).toEqual([true, false]);
  });

  it("returns no groups when a filter or search has no matching records", () => {
    expect(buildRecordDateGroups([])).toEqual([]);
  });

  it("pins the current question to the newest visible date without changing date order", () => {
    const currentQuestion = thought("question-current", "2020-01-01T00:00:00.000Z");
    const otherQuestion = thought("question-other", "2030-01-01T00:00:00.000Z");
    const newest = thought("newest", "2026-03-04T02:00:00.000Z");
    const older = thought("older", "2026-03-03T02:00:00.000Z");

    const groups = buildMixedRecordGroups(
      [older, newest],
      [currentQuestion, otherQuestion],
      "session",
    );

    expect(groups.map((group) => group.dateKey)).toEqual(["2026-03-04", "2026-03-03"]);
    expect(groups[0].label).toBe("3월 4일");
    expect(groups[0].records[0].id).toBe("question-current");
    expect(groups.flatMap((group) => group.records).map((record) => record.id).sort()).toEqual([
      "newest",
      "older",
      "question-current",
      "question-other",
    ]);
  });

  it("returns ordinary date groups unchanged when the server queue becomes empty", () => {
    const ordinary = thought("ordinary", "2026-03-04T00:00:00.000Z");

    expect(buildMixedRecordGroups([ordinary], [], "session").map((group) => group.dateKey))
      .toEqual(["2026-03-04"]);
  });

  it("renders every queued question in a date-formatted group when no ordinary records match", () => {
    const firstQuestion = thought("question-first", "2026-03-04T02:00:00.000Z");
    const secondQuestion = thought("question-second", "2026-03-04T01:00:00.000Z");

    const groups = buildMixedRecordGroups([], [firstQuestion, secondQuestion], "session");

    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe("2026-03-04");
    expect(groups[0].label).toBe("3월 4일");
    expect(groups[0].records.map((record) => record.id)).toEqual([
      "question-first",
      "question-second",
    ]);
  });

  it("keeps one session placement stable and changes it only with a new seed", () => {
    const ordinary = Array.from({ length: 6 }, (_, index) =>
      thought(`ordinary-${index + 1}`, `2026-03-04T0${index}:00:00.000Z`),
    );
    const questions = Array.from({ length: 6 }, (_, index) =>
      thought(`q${index + 1}`, "2026-03-01T00:00:00.000Z"),
    );
    const ids = (seed: string) => buildMixedRecordGroups(ordinary, questions, seed)
      .flatMap((group) => group.records.map((record) => record.id));

    expect(ids("seed-a")).toEqual(ids("seed-a"));
    expect(ids("seed-a")).not.toEqual(ids("seed-b"));
    expect(ids("seed-a")[0]).toBe("q1");
    expect(new Set(ids("seed-a")).size).toBe(ordinary.length + questions.length);
  });

  it("does not move unaffected questions after activation or ordinary-card deletion", () => {
    const ordinary = Array.from({ length: 6 }, (_, index) =>
      thought(`ordinary-${index + 1}`, `2026-03-04T0${index}:00:00.000Z`),
    );
    const questions = Array.from({ length: 6 }, (_, index) =>
      thought(`q${index + 1}`, "2026-03-01T00:00:00.000Z"),
    );
    const beforeAnchors = resolveQuestionPlacementAnchors(
      ordinary,
      questions,
      "session",
    );
    const activatedQuestions = questions.slice(1);
    const afterActivationAnchors = resolveQuestionPlacementAnchors(
      [...ordinary, questions[0]],
      activatedQuestions,
      "session",
      beforeAnchors,
    );
    const deletedOrdinaryId = afterActivationAnchors.get("q3");
    const afterDeletionAnchors = resolveQuestionPlacementAnchors(
      [...ordinary, questions[0]].filter((record) => record.id !== deletedOrdinaryId),
      activatedQuestions,
      "session",
      afterActivationAnchors,
    );

    for (const questionId of ["q4", "q5", "q6"]) {
      if (afterActivationAnchors.get(questionId) === deletedOrdinaryId) continue;
      expect(afterDeletionAnchors.get(questionId)).toBe(afterActivationAnchors.get(questionId));
    }
    expect(buildMixedRecordGroups(
      [...ordinary, questions[0]],
      activatedQuestions,
      "session",
      afterActivationAnchors,
    )[0].records[0].id).toBe("q2");
  });

  it("temporarily falls back from hidden search anchors and restores every original position", () => {
    const ordinary = Array.from({ length: 6 }, (_, index) =>
      thought(`ordinary-${index + 1}`, `2026-03-04T0${index}:00:00.000Z`),
    );
    const questions = Array.from({ length: 6 }, (_, index) =>
      thought(`q${index + 1}`, "2026-03-01T00:00:00.000Z"),
    );
    const anchors = resolveQuestionPlacementAnchors(ordinary, questions, "session");
    const recordIds = (records: UnifiedRecord[]) => buildMixedRecordGroups(
      records,
      questions,
      "session",
      anchors,
    ).flatMap((group) => group.records.map((record) => record.id));
    const beforeSearch = recordIds(ordinary);
    const duringSearch = recordIds(ordinary.slice(0, 2));
    const afterSearch = recordIds(ordinary);

    expect(duringSearch.filter((id) => id.startsWith("q"))).toHaveLength(questions.length);
    expect(afterSearch).toEqual(beforeSearch);
  });
});

describe("record preview normalization", () => {
  it("extracts only a leading H1 as a thought title", () => {
    expect(getThoughtPreview("# 제목\n\n본문").title).toBe("제목");
    expect(getThoughtPreview("본문\n\n# 나중 제목")).toEqual({
      title: "",
      titleDisplay: "",
      body: "본문 나중 제목",
      hasTitle: false,
    });
  });

  it("keeps leading H1 hard breaks in the title and excludes them from the body", () => {
    const markdown = "# **첫 제목**  \n둘째 <u>제목</u>  \n셋째 제목\n\n실제 본문";
    expect(getThoughtPreview(markdown)).toEqual({
      title: "첫 제목 둘째 제목 셋째 제목",
      titleDisplay: "첫 제목\n둘째 제목\n셋째 제목",
      body: "실제 본문",
      hasTitle: true,
    });
    expect(getThoughtCardContent(markdown)).toEqual({
      title: "첫 제목\n둘째 제목\n셋째 제목",
      body: "실제 본문",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
  });

  it("removes whitespace around newlines then collapses all remaining runs", () => {
    expect(normalizePreviewText("  첫 줄  \n   둘째\t\t줄 \n\n 셋째  ")).toBe("첫 줄 둘째 줄 셋째");
  });

  it("keeps meaningful title line breaks for content view", () => {
    expect(normalizePreviewTitle("  첫 제목  \n  둘째\t제목 \n\n 셋째 ")).toBe("첫 제목\n둘째 제목\n셋째");
  });

  it("keeps authored thought paragraphs and blank lines in the card model", () => {
    expect(getThoughtCardContent("# 긴 제목\n\n첫 줄\n둘째 줄\n\n\n셋째 줄")).toEqual({
      title: "긴 제목",
      body: "첫 줄\n둘째 줄\n\n\n셋째 줄",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
  });

  it("keeps plain text and structure without exposing Markdown syntax", () => {
    expect(getThoughtCardContent("# 제목\n\n**굵게**와 *기울임*, [링크](https://example.com)\n\n- 첫 항목\n- 둘째 <u>항목</u>")).toEqual({
      title: "제목",
      body: "굵게와 기울임, 링크\n\n첫 항목\n\n둘째 항목",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
  });

  it("preserves supported block and inline tokens for card formatting without link URLs", () => {
    const content = getThoughtCardContent(
      "# 제목\n\n## 소제목\n\n**굵게** *기울임* <u>밑줄</u> [문구](https://example.com)\n\n> 인용\n\n- 항목\n\n1. 순서",
    );
    expect(content.bodyBlocks.map((block) => block.type)).toEqual([
      "h2", "paragraph", "blockquote", "ul_item", "ol_item",
    ]);
    expect(content.bodyBlocks[1]?.tokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining(["bold", "italic", "underline"]),
    );
    expect(content.body).toContain("문구");
    expect(content.body).not.toContain("https://example.com");
  });

  it("preserves a non-leading H1 and paragraph boundaries as card blocks", () => {
    const content = getThoughtCardContent("첫 문단\n\n# 본문 제목\n\n둘째 문단");
    expect(content.hasTitle).toBe(false);
    expect(content.bodyBlocks.map((block) => block.type)).toEqual([
      "paragraph", "h1", "paragraph",
    ]);
  });

  it("removes every parsed H1 form from the body instead of duplicating it", () => {
    expect(getThoughtCardContent("제목\n====\n\n본문")).toEqual({
      title: "제목",
      body: "본문",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
    expect(getThoughtCardContent("  # 들여쓴 제목\n\n본문")).toEqual({
      title: "들여쓴 제목",
      body: "본문",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
  });

  it("keeps article card text untouched while preview text stays normalized", () => {
    const record: UnifiedRecord = {
      id: "article",
      kind: "editing",
      updatedAt: "2026-01-01T00:00:00.000Z",
      article: {
        title: "긴 제목\n둘째 줄",
        content: "첫 줄  \n\n  둘째 줄",
      } as never,
    };
    expect(getRecordCardContent(record)).toEqual({
      title: "긴 제목\n둘째 줄",
      body: "첫 줄  \n\n  둘째 줄",
      bodyBlocks: expect.any(Array),
      hasTitle: true,
    });
  });
});

describe("fixed-ratio record card text limits", () => {
  it("caps long and explicitly broken titles at two visible lines", () => {
    expect(getRecordCardTitleLineCount("짧은 제목", 20, 200)).toBe(1);
    expect(getRecordCardTitleLineCount("첫 줄\n둘째 줄", 20, 200)).toBe(2);
    expect(getRecordCardTitleLineCount("첫 줄\n둘째 줄\n셋째 줄", 20, 200)).toBe(2);
    expect(getRecordCardTitleLineCount("가".repeat(40), 20, 200)).toBe(2);
  });

  it("allows question titles to reserve three or more lines without changing the card size", () => {
    expect(getRecordCardTitleLineCount("첫 줄\n둘째 줄\n셋째 줄", 20, 200, Number.MAX_SAFE_INTEGER))
      .toBe(3);
    expect(getRecordCardTitleLineCount("가".repeat(40), 20, 200, Number.MAX_SAFE_INTEGER))
      .toBe(4);
    expect(getRecordCardBodyLineCount({
      cardHeight: 480,
      paddingY: 48,
      titleLineCount: 4,
      titleLineHeight: 24,
      titleGap: 8,
      bodyLineHeight: 20,
    })).toBe(14);
  });

  it("reduces body lines by the visible title only and never below one line", () => {
    expect(getRecordCardBodyLineCount({
      cardHeight: 480,
      paddingY: 48,
      titleLineCount: 2,
      titleLineHeight: 24,
      titleGap: 8,
      bodyLineHeight: 20,
    })).toBe(16);
    expect(getRecordCardBodyLineCount({
      cardHeight: 80,
      paddingY: 32,
      titleLineCount: 2,
      titleLineHeight: 24,
      titleGap: 8,
      bodyLineHeight: 20,
    })).toBe(1);
  });
});
