import { describe, expect, it } from "vitest";
import type { Thought } from "@workspace/api-client-react";
import {
  buildRecordDateGroups,
  buildRecordGroups,
  buildUnifiedRecords,
  compareRecordsNewestFirst,
  getQueuedThoughtIds,
  getRecordCardBodyLineCount,
  getThoughtPreview,
  getRecordCardContent,
  getRecordCardTitleLineCount,
  getThoughtCardContent,
  normalizePreviewTitle,
  normalizePreviewText,
  type UnifiedRecord,
  QUESTION_QUEUE_GROUP_KEY,
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

  it("puts the FIFO question queue in one stable first group without duplicate date records", () => {
    const firstQuestion = thought("question-first", "2026-03-04T02:00:00.000Z");
    const secondQuestion = thought("question-second", "2026-03-04T01:00:00.000Z");
    const ordinary = thought("ordinary", "2026-03-04T00:00:00.000Z");

    const groups = buildRecordGroups(
      [ordinary, firstQuestion, secondQuestion],
      [firstQuestion, secondQuestion],
    );

    expect(groups.map((group) => group.dateKey)).toEqual([
      QUESTION_QUEUE_GROUP_KEY,
      "2026-03-04",
    ]);
    expect(groups[0].label).toBe("질문 대기열");
    expect(groups[0].records.map((record) => record.id)).toEqual([
      "question-first",
      "question-second",
    ]);
    expect(groups[1].records.map((record) => record.id)).toEqual(["ordinary"]);
  });

  it("removes the queue group when the server queue becomes empty", () => {
    const ordinary = thought("ordinary", "2026-03-04T00:00:00.000Z");

    expect(buildRecordGroups([ordinary], []).map((group) => group.dateKey)).toEqual(["2026-03-04"]);
  });

  it("renders every queued question even when there are no ordinary date records", () => {
    const firstQuestion = thought("question-first", "2026-03-04T02:00:00.000Z");
    const secondQuestion = thought("question-second", "2026-03-04T01:00:00.000Z");

    const groups = buildRecordGroups([], [firstQuestion, secondQuestion]);

    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe(QUESTION_QUEUE_GROUP_KEY);
    expect(groups[0].records.map((record) => record.id)).toEqual([
      "question-first",
      "question-second",
    ]);
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
