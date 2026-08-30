import { describe, expect, it } from "vitest";
import type { Thought } from "@workspace/api-client-react";
import {
  buildRecordDateGroups,
  buildMixedRecordGroups,
  buildUnifiedRecords,
  compareRecordsNewestFirst,
  getQueuedThoughtIds,
  getQueuedThoughts,
  getRecordCardBodyLineCount,
  getThoughtPreview,
  getRecordCardContent,
  getRecordCardTitleLineCount,
  getThoughtCardContent,
  normalizePreviewTitle,
  normalizePreviewText,
  resolveQuestionPlacementAnchors,
  type UnifiedRecord,
} from "../recordList";

describe("record list model", () => {
  it("keeps every queued question out of ordinary thought records", () => {
    const queuedThoughts = Array.from({ length: 6 }, (_, index) => ({
      id: `queued-${index + 1}`,
      updatedAt: "2026-01-01T00:00:00.000Z",
    })) as unknown as Thought[];
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

  it("falls back to current and next while an older cached queue response is in use", () => {
    const current = { id: "current" } as Thought;
    const next = { id: "next" } as Thought;

    expect(getQueuedThoughtIds(undefined, current, next)).toEqual(new Set(["current", "next"]));
    expect(getQueuedThoughts(undefined, current, next)).toEqual([current, next]);
  });

  it("de-duplicates repeated queue aliases without changing FIFO order", () => {
    const current = { id: "current" } as Thought;
    const next = { id: "next" } as Thought;

    expect(getQueuedThoughts([current, next, current], current, next)).toEqual([current, next]);
  });

  it("keeps FIFO queue order in the model while excluding every queued ID from date groups", () => {
    const queue = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ] as Thought[];
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
    expect([...records].sort(compareRecordsNewestFirst).map((record) => record.id)).toEqual(["c", "a", "b"]);
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
      "editing:a",
      "thought:b",
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
      hasTitle: true,
    });
  });

  it("keeps plain text and structure without exposing Markdown syntax", () => {
    expect(getThoughtCardContent("# 제목\n\n**굵게**와 *기울임*, [링크](https://example.com)\n\n- 첫 항목\n- 둘째 <u>항목</u>")).toEqual({
      title: "제목",
      body: "굵게와 기울임, 링크\n\n첫 항목\n\n둘째 항목",
      hasTitle: true,
    });
  });

  it("removes every parsed H1 form from the body instead of duplicating it", () => {
    expect(getThoughtCardContent("제목\n====\n\n본문")).toEqual({
      title: "제목",
      body: "본문",
      hasTitle: true,
    });
    expect(getThoughtCardContent("  # 들여쓴 제목\n\n본문")).toEqual({
      title: "들여쓴 제목",
      body: "본문",
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
