import { describe, expect, it } from "vitest";
import type { Thought } from "@workspace/api-client-react";
import {
  buildRecordDateGroups,
  buildUnifiedRecords,
  compareRecordsNewestFirst,
  getQueuedThoughtIds,
  getThoughtPreview,
  normalizePreviewTitle,
  normalizePreviewText,
  type UnifiedRecord,
} from "../recordList";

describe("record list model", () => {
  it("keeps every entry in a six-question queue out of ordinary archive records", () => {
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
    const current = { id: "current" } as never;
    const next = { id: "next" } as never;

    expect(getQueuedThoughtIds(undefined, current, next)).toEqual(new Set(["current", "next"]));
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
});
