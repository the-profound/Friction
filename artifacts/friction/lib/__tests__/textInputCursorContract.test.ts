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
  "app/stored-sentence-create.tsx",
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

    expect(editableInputCount).toBe(37);
  });

  it("keeps stored sentence selection feedback opaque with the cursor token", () => {
    const source = readFileSync(
      join(appRoot, "app/stored-sentence-create.tsx"),
      "utf8",
    );
    const inputTags = source.match(/^\s*<TextInput\b[\s\S]*?\/>/gm) ?? [];

    expect(inputTags).toHaveLength(2);
    for (const inputTag of inputTags) {
      expect(inputTag).toContain("cursorColor={Colors.cursorAccent}");
      expect(inputTag).toContain("selectionColor={Colors.cursorAccent}");
      expect(inputTag).not.toContain('selectionColor={Colors.noticeAccent + "40"}');
    }
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
    expect(source.match(/selectionColor=\{Colors\.cursorAccent\}/g)).toHaveLength(2);
  });

  it("starts every reading thought card with its body and keeps retry recovery", () => {
    const source = readFileSync(
      join(appRoot, "components/ThoughtsBottomSheet/ThoughtsBottomSheet.tsx"),
      "utf8",
    );

    expect(source).not.toContain("formatRelativeDate");
    expect(source).not.toContain("optimisticMetaRow");
    expect(source).not.toContain("cardDate");
    expect(source).toContain('t.saveState === "failed"');
    expect(source).toContain("retryOptimisticThought(t.id)");
  });
});
