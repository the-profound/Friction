import { describe, expect, it } from "vitest";

import { advanceArchiveFilter, advanceRecordKind } from "../tabReselect";

describe("active tab filter cycling", () => {
  it("cycles record filters through thought, editing, letter, and wraps", () => {
    expect(advanceRecordKind("thought")).toBe("editing");
    expect(advanceRecordKind("editing")).toBe("letter");
    expect(advanceRecordKind("letter")).toBe("thought");
  });

  it("preserves every rapid record-tab reselection represented by the version delta", () => {
    expect(advanceRecordKind("thought", 2)).toBe("letter");
    expect(advanceRecordKind("editing", 3)).toBe("editing");
  });

  it("alternates archive filters and preserves even rapid reselection counts", () => {
    expect(advanceArchiveFilter("personal")).toBe("sentence");
    expect(advanceArchiveFilter("sentence")).toBe("personal");
    expect(advanceArchiveFilter("personal", 2)).toBe("personal");
  });
});