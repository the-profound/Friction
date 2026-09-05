import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(appRoot, path), "utf8");

describe("shared writing header buttons", () => {
  it("defines one fixed 36px outer/inner contract for every shared variant", () => {
    const button = read("components/shared/HeaderButton.tsx");
    const tokens = read("constants/tokens.ts");

    expect(button).toContain('export type HeaderButtonVariant = "back" | "menu" | "settings";');
    expect(button).toContain('variant === "settings"');
    expect(button).toContain("label?: string;");
    expect(button).toContain("backgroundColor: Colors.white");
    expect(button).toContain("borderColor: Colors.noticeAccent");
    expect(button).toContain("color: Colors.noticeAccent");
    expect(button).toContain("borderColor: Colors.zinc300");
    expect(button).not.toContain("overflow: \"hidden\"");
    expect(button).toContain("accessibilityRole=\"button\"");
    expect(button).toContain("accessibilityState={{");
    expect(button).toContain("disabled: unavailable");
    expect(button).toContain("busy,");
    expect(button).toContain("contentStyle={[");
    expect(button).toContain("style={styles.button}");
    expect(tokens).toContain("headerButtonTouchSize: 36");
    expect(tokens).toContain("headerButtonSurfaceSize: 36");
    expect(tokens).toContain("headerButtonIconSize: 18");
  });

  it("uses the shared button in all writing-flow headers", () => {
    const writing = read("app/on-01a.tsx");
    const closing = read("app/on-01c.tsx");
    const stateBar = read("components/WritingStateBar/WritingStateBar.tsx");
    const pageHeader = read("components/NavBar/PageHeader.tsx");

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
    expect(pageHeader).toContain("const rowHeight = Sizing.headerButtonTouchSize;");
    expect(pageHeader).toContain("variant={profileButtonVariant}");
    expect(pageHeader).toContain('variant="menu"');
  });

  it("uses the shared back button across stack, space, account, and reading headers", () => {
    const screenPaths = [
      "app/activity.tsx",
      "app/mypage.tsx",
      "app/mypage-neighbors.tsx",
      "app/mypage-sendrecords.tsx",
      "app/of-01.tsx",
      "app/of-space-archived-list.tsx",
      "app/of-space-archive.tsx",
      "app/of-space-basic-settings.tsx",
      "app/of-space-participants.tsx",
      "app/of-space-rounds.tsx",
      "app/of-space-schedule-send.tsx",
      "app/of-space-start.tsx",
      "app/space-create.tsx",
      "app/space-join.tsx",
      "app/terms.tsx",
      "app/to-03.tsx",
      "app/to-send.tsx",
      "app/user-profile/[userId].tsx",
      "app/user-profile/recipient-only-letters.tsx",
    ];

    for (const path of screenPaths) {
      const screen = read(path);
      const usesHeaderButtonDirectly = screen.includes(
        'import HeaderButton from "@/components/shared/HeaderButton";',
      );
      const usesPageHeaderBack =
        screen.includes('import { PageHeader } from "@/components/NavBar/PageHeader";') &&
        screen.includes("showBack");

      expect(usesHeaderButtonDirectly || usesPageHeaderBack, path).toBe(true);
      if (usesHeaderButtonDirectly) {
        expect(screen, path).toContain('variant="back"');
      }
      expect(screen, path).not.toMatch(/name="(?:arrow-left|chevron-left)"/);
    }

    const reader = read("app/read.tsx");
    expect(reader).toContain('{mode === "re_read" ? (');
    expect(reader).toContain('accessibilityLabel="읽기 화면에서 돌아가기"');
  });
});