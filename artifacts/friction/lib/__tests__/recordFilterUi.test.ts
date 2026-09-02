import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("record filter UI regression", () => {
  it("keeps record kind filters as independent buttons", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).not.toContain("DropdownFilter");
    expect(recordsScreen).toContain("function RecordKindButton");
    expect(recordsScreen).toContain('label="단상" active={kind === "thought"}');
    expect(recordsScreen).toContain('label="편집" active={kind === "editing"}');
    expect(recordsScreen).toContain('label="편지" active={kind === "letter"}');
  });
});