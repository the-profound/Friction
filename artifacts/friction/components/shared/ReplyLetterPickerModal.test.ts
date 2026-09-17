import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const replyPickerSource = readFileSync(
  new URL("./ReplyLetterPickerModal.tsx", import.meta.url),
  "utf8",
);

describe("reply letter picker two-step flow (single sheet)", () => {
  it("renders both steps inside exactly one BottomSheet, never a separate SpacePickerModal", () => {
    // The flow must not borrow the standalone space-picker modal/layout —
    // both steps live inside the same sheet, swapping body content by step.
    expect(replyPickerSource).toContain("<BottomSheet");
    expect((replyPickerSource.match(/<BottomSheet/g) ?? []).length).toBe(1);
    expect(replyPickerSource).not.toContain("SpacePickerModal");
    expect(replyPickerSource).not.toContain("<LetterPickerSelectionSheet");
  });

  it("keeps the sheet open across both steps and only advances local step state on space selection", () => {
    const onPressBlock = replyPickerSource.slice(
      replyPickerSource.indexOf("onPress={() => {\n                  setSelectedSpace(item);"),
    );
    expect(onPressBlock).toContain("setSelectedSpace(item)");
    expect(onPressBlock).toContain('setStep("letters")');
    // Selecting a space must not call the flow's onClose — only choosing a
    // letter (or an explicit dismiss) may close the whole sheet.
    const onPressBody = onPressBlock.slice(0, onPressBlock.indexOf("}}"));
    expect(onPressBody).not.toContain("onClose(");
  });

  it("returns to the space step via an explicit back button, without touching the flow's onClose", () => {
    expect(replyPickerSource).toContain('onPress={() => setStep("space")}');
    const headerLeftBlock = replyPickerSource.slice(
      replyPickerSource.indexOf("headerLeft={"),
      replyPickerSource.indexOf("}\n    >"),
    );
    expect(headerLeftBlock).toContain('onPress={() => setStep("space")}');
    expect(headerLeftBlock).not.toContain("onClose(");
  });

  it("shows the space step by default and restarts there on every open", () => {
    expect(replyPickerSource).toContain('useState<ReplyPickerStep>("space")');
    expect(replyPickerSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(visible\) \{\s*setStep\("space"\);\s*setSelectedSpace\(null\);/,
    );
  });

  it("filters the letter grid to the selected space and hides the title search", () => {
    expect(replyPickerSource).toContain("filterReplyLettersBySpace");
    expect(replyPickerSource).toContain("<LetterPickerGrid");
    expect(replyPickerSource).toContain("showSearch={false}");
  });

  it("reuses the same active-space data and status styling as the other space picker, without its modal wrapper", () => {
    expect(replyPickerSource).toContain("filterActiveParticipatingSpaces");
    expect(replyPickerSource).toContain("spaceStatusLabel");
    expect(replyPickerSource).toContain("spaceStatusStyle");
  });
});
