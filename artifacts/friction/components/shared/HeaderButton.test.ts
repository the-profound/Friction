import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(appRoot, path), "utf8");

describe("shared writing header buttons", () => {
  it("defines one fixed outer/inner contract for both icon variants", () => {
    const button = read("components/shared/HeaderButton.tsx");
    const tokens = read("constants/tokens.ts");

    expect(button).toContain('export type HeaderButtonVariant = "back" | "menu";');
    expect(button).toContain('variant === "back" ? "arrow-left" : "more-horizontal"');
    expect(button).toContain("accessibilityRole=\"button\"");
    expect(button).toContain("accessibilityState={{");
    expect(button).toContain("disabled: unavailable");
    expect(button).toContain("busy,");
    expect(button).toContain("contentStyle={styles.surface}");
    expect(button).toContain("style={styles.button}");
    expect(tokens).toContain("headerButtonTouchSize: 44");
    expect(tokens).toContain("headerButtonSurfaceSize: 40");
    expect(tokens).toContain("headerButtonIconSize: 20");
  });

  it("uses the shared button in all writing-flow headers", () => {
    const writing = read("app/on-01a.tsx");
    const closing = read("app/on-01c.tsx");
    const stateBar = read("components/WritingStateBar/WritingStateBar.tsx");

    expect(writing).toContain('import HeaderButton from "@/components/shared/HeaderButton";');
    expect(writing).toContain('<HeaderButton\n            variant="back"');
    expect(writing).not.toContain("styles.headerBackButton");
    expect(writing).not.toContain("styles.headerBackButtonContent");

    expect(closing).toContain('<HeaderButton\n            variant="back"');
    expect(closing).not.toContain("styles.headerBackButton");
    expect(closing).not.toContain("styles.headerBackButtonContent");

    expect(stateBar).toContain('<HeaderButton\n        testID="writing-stage-menu"');
    expect(stateBar).toContain('variant="menu"');
    expect(stateBar).toContain("<ActionSheetModal");
  });
});