import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readTabScreen = (name: "index" | "of" | "archive") =>
  readFileSync(join(appRoot, `app/(tabs)/${name}.tsx`), "utf8");

describe("top-level tab header contract", () => {
  it("centers the Friction-red Eulyoo titles on inbox, spaces, and archive", () => {
    const header = readFileSync(
      join(appRoot, "components/NavBar/PageHeader.tsx"),
      "utf8",
    );
    const accentLine = readFileSync(
      join(appRoot, "components/NavBar/HeaderAccentLine.tsx"),
      "utf8",
    );

    expect(header).toContain("centeredBrandTitle?: boolean");
    expect(header).toContain("fontSize: windowWidth * 0.045");
    expect(header).toContain("color: Colors.noticeAccent");
    expect(header).toContain('fontFamily: "Eulyoo1945-SemiBold"');
    expect(header).toMatch(
      /actions:\s*\{[\s\S]*?minHeight: Sizing\.searchButtonSize/,
    );
    expect(header).toMatch(/actions:\s*\{[\s\S]*?marginLeft: "auto"/);
    expect(header).toContain(
      "<HeaderAccentLine titleLineHeight={windowWidth * 0.065} rowHeight={rowHeight} />",
    );
    expect(accentLine).toContain('position: "absolute"');
    expect(accentLine).toContain(
      "const titleBottomOffset = 15 + (rowHeight - titleLineHeight) / 2",
    );
    expect(accentLine).toContain("const lineGap = 2.5");
    expect(accentLine).toContain("width: 96");
    expect(accentLine).toContain("height: 1");
    expect(accentLine).toContain("backgroundColor: Colors.noticeAccent");
    expect(readTabScreen("index")).toContain('title="수신함"');
    expect(readTabScreen("of")).toContain('title="공간 목록"');
    expect(readTabScreen("archive")).toContain('title="보관함"');
    expect(readTabScreen("index")).toContain("centeredBrandTitle");
    expect(readTabScreen("of")).toContain("centeredBrandTitle");
    expect(readTabScreen("archive")).toContain("centeredBrandTitle");
  });

  it("keeps inbox and archive unfiltered while preserving their remaining actions", () => {
    const inbox = readTabScreen("index");
    const archive = readTabScreen("archive");
    const spaces = readTabScreen("of");

    expect(inbox).not.toContain("AnimatedSearchBar");
    expect(inbox).not.toContain("searchQuery");
    expect(inbox).toContain("groupBySlot(visibleItems)");

    expect(archive).not.toContain("AnimatedSearchBar");
    expect(archive).not.toContain("searchQuery");
    expect(archive).toContain("data={sentences}");
    expect(archive).toContain('activeSubTab === "personal" ? (');
    expect(archive).toContain('accessibilityLabel="새 모음 만들기"');
    expect(archive).toContain('accessibilityLabel="문장 추가"');
    expect(archive).toContain("onLongPress={enterSelectionMode}");

    expect(spaces).toContain('variant="menu"');
    expect(spaces).toContain('accessibilityLabel="공간 메뉴 열기"');
    expect(spaces).toContain('label: "공간 만들기"');
    expect(spaces).toContain('label: "보관된 공간"');
  });
});