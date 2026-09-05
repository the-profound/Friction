import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const editableInputFiles = [
  "app/login.tsx",
  "app/of-01-detail.tsx",
  "app/of-01.tsx",
  "app/of-space-detail.tsx",
  "app/of-space-participants.tsx",
  "app/of-space-rounds.tsx",
  "app/of-space-start.tsx",
  "app/space-create.tsx",
  "app/space-join.tsx",
  "app/(tabs)/archive.tsx",
  "components/AnimatedSearchBar/AnimatedSearchBar.tsx",
  "components/MemoBottomSheet/MemoBottomSheet.tsx",
  "components/MemoPageView/MemoPageView.tsx",
  "components/MyCollectionsModal/MyCollectionsModal.tsx",
  "components/QuestionCardCurl/QuestionCardCurl.tsx",
  "components/shared/LetterPickerList.tsx",
  "components/SpaceBasicSettingsForm/SpaceBasicSettingsForm.tsx",
  "components/ThoughtsBottomSheet/ThoughtsBottomSheet.tsx",
  "components/ToInline/NeighborsInline.tsx",
] as const;

describe("editable React Native input cursor contract", () => {
  it("uses the semantic Friction cursor token on every editable input", () => {
    let editableInputCount = 0;

    for (const relativePath of editableInputFiles) {
      const source = readFileSync(join(appRoot, relativePath), "utf8");
      const inputTags = source.match(/^\s*<TextInput\b[\s\S]*?\/>/gm) ?? [];

      for (const inputTag of inputTags) {
        if (inputTag.includes("editable={false}")) continue;
        editableInputCount += 1;
        expect(inputTag, relativePath).toContain(
          "cursorColor={Colors.cursorAccent}",
        );
      }
    }

    expect(editableInputCount).toBe(35);
  });

  it("applies the same cursor token to React Native Web inputs", () => {
    const rootLayout = readFileSync(join(appRoot, "app/_layout.tsx"), "utf8");

    expect(rootLayout).toContain(
      "`input,textarea{caret-color:${Colors.cursorAccent}}`",
    );
  });

  it("preserves the reading memo's transparent selection treatment", () => {
    const source = readFileSync(
      join(appRoot, "components/MemoPageView/MemoPageView.tsx"),
      "utf8",
    );

    expect(source).toContain("cursorColor={Colors.cursorAccent}");
    expect(source).toContain('selectionColor="transparent"');
  });

  it("keeps reading thoughts proportional and lets the outer list own long-input scrolling", () => {
    const source = readFileSync(
      join(appRoot, "components/ThoughtsBottomSheet/ThoughtsBottomSheet.tsx"),
      "utf8",
    );

    expect(source).toContain("const THOUGHT_FONT_RATIO = 0.04");
    expect(source).toContain("fontSize = thoughtCardWidth * THOUGHT_FONT_RATIO");
    expect(source).toContain("lineHeight: fontSize * THOUGHT_LINE_HEIGHT_RATIO");
    expect(source).toContain("event.nativeEvent.contentSize.height");
    expect(source).toContain("{ minHeight: inputMinHeight, height: inputHeight }");
    expect(source.match(/scrollEnabled=\{false\}/g)).toHaveLength(2);
    expect(source.match(/thoughtTypography/g)?.length).toBeGreaterThanOrEqual(5);
  });
});

describe("top-level tab header contract", () => {
  const readTabScreen = (name: "index" | "of" | "archive") =>
    readFileSync(join(appRoot, `app/(tabs)/${name}.tsx`), "utf8");

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
    expect(header).toContain("fontSize: windowWidth * 0.04");
    expect(header).toContain("color: Colors.noticeAccent");
    expect(header).toContain('fontFamily: "Eulyoo1945-Regular"');
    expect(header).toMatch(
      /actions:\s*\{[\s\S]*?minHeight: Sizing\.searchButtonSize/,
    );
    expect(header).toMatch(/actions:\s*\{[\s\S]*?marginLeft: "auto"/);
    expect(header).toContain("<HeaderAccentLine />");
    expect(accentLine).toContain('position: "absolute"');
    expect(accentLine).toContain("bottom: 10");
    expect(accentLine).toContain("width: 96");
    expect(accentLine).toContain("height: StyleSheet.hairlineWidth");
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
    expect(archive).toContain('showAdd={activeSubTab !== "sentence"}');
    expect(archive).toContain('showKebab={activeSubTab === "sentence"}');

    expect(spaces).toContain("showAdd");
    expect(spaces).toContain("showArchive");
  });
});
