import { describe, expect, it } from "vitest";
import {
  buildUnifiedRecords,
  compareRecordsNewestFirst,
  getThoughtPreview,
  normalizePreviewTitle,
  normalizePreviewText,
  type UnifiedRecord,
} from "../recordList";

describe("record list model", () => {
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
