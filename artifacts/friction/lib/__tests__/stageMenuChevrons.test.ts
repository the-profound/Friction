import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readOn01a = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");
const readOn01c = () => readFileSync(join(appRoot, "app/on-01c.tsx"), "utf8");
const readActionSheetModal = () =>
  readFileSync(
    join(appRoot, "components/ActionSheetModal/ActionSheetModal.tsx"),
    "utf8",
  );

/**
 * Extracts the source slice for a single `{ label: "<label>", ... }` action
 * object literal, bounded by the next `label:` occurrence (or end of file).
 * Mirrors the raw-source-text assertion convention used for large writing
 * screens that have no render harness (see friction-large-screen-test-convention).
 */
function extractActionBlock(source: string, label: string): string {
  const marker = `label: "${label}"`;
  const start = source.indexOf(marker);
  expect(start, `expected to find action with label "${label}"`).toBeGreaterThan(-1);
  const nextLabelIndex = source.indexOf('label: "', start + marker.length);
  const end = nextLabelIndex === -1 ? source.length : nextLabelIndex;
  return source.slice(start, end);
}

describe("stage-transition menu chevrons", () => {
  it("renders a leading/trailing Feather chevron next to the action label in ActionSheetModal", () => {
    const source = readActionSheetModal();

    expect(source).toContain(
      'export type ActionSheetDirectionIcon = "leading" | "trailing";',
    );
    expect(source).toContain("directionIcon?: ActionSheetDirectionIcon;");
    expect(source).toContain('action.directionIcon === "leading"');
    expect(source).toContain('action.directionIcon === "trailing"');
    expect(source).toContain('name="chevron-left"');
    expect(source).toContain('name="chevron-right"');

    // The icon color must follow the same disabled/destructive logic as the label.
    expect(source).toContain("getActionColor");
  });

  it("does not add a chevron to the shared cancel row", () => {
    const source = readActionSheetModal();
    const cancelRowSection = source.slice(
      source.indexOf("cancelActions.length > 0"),
    );

    expect(cancelRowSection).not.toContain("directionIcon");
    expect(cancelRowSection).not.toContain("chevron-left");
    expect(cancelRowSection).not.toContain("chevron-right");
  });

  it("marks the draft-stage forward action with a trailing chevron", () => {
    const source = readOn01a();
    const forwardBlock = extractActionBlock(source, "검토 단계로");

    expect(forwardBlock).toContain('directionIcon: "trailing"');
  });

  it("marks the dividing-stage back/forward actions and leaves non-transition actions untouched", () => {
    const source = readOn01a();

    const backBlock = extractActionBlock(source, "단상 단계로");
    expect(backBlock).toContain('directionIcon: "leading"');

    const autoSplitBlock = extractActionBlock(source, "자동 분할");
    expect(autoSplitBlock).not.toContain("directionIcon");

    const spellCheckBlock = extractActionBlock(source, "맞춤법 검사");
    expect(spellCheckBlock).not.toContain("directionIcon");

    const closingBlock = extractActionBlock(source, "마감 단계로");
    expect(closingBlock).toContain('directionIcon: "trailing"');
  });

  it("marks the closing-stage back action and leaves non-transition actions untouched", () => {
    const source = readOn01c();

    const backBlock = extractActionBlock(source, "검토 단계로");
    expect(backBlock).toContain('directionIcon: "leading"');

    const coverEditBlock = extractActionBlock(source, "표지 편집");
    expect(coverEditBlock).not.toContain("directionIcon");

    const exportBlock = extractActionBlock(source, "내보내기");
    expect(exportBlock).not.toContain("directionIcon");
  });
});
