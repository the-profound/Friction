import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("record card shadow ownership", () => {
  it("keeps the card shadow on the animated thought surface", () => {
    const onScreen = read("(tabs)/on.tsx");
    const outerStyle = onScreen.match(/thoughtCard:\s*\{([^}]*)\}/)?.[1] ?? "";
    const contentStyle =
      onScreen.match(/thoughtCardContent:\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(outerStyle).not.toContain("Shadows.");
    expect(outerStyle).not.toContain("borderRadius");
    expect(contentStyle).toContain("borderRadius");
    expect(contentStyle).toContain("...Shadows.carouselCard");
  });

  it("does not move the existing list or letter card shadows", () => {
    const onScreen = read("(tabs)/on.tsx");
    const articleCard = read(
      "../../components/ArticleCardItem/ArticleCardItem.tsx",
    );
    const articleListItem = read(
      "../../components/ArticleListItem/ArticleListItem.tsx",
    );
    const replyPicker = read(
      "../../components/shared/ReplyLetterPickerModal.tsx",
    );

    expect(onScreen).toContain(
      "rowContent: { padding: 16, gap: 7, borderRadius: 16, backgroundColor: Colors.white, ...Shadows.card }",
    );
    expect(articleCard).toContain("...Shadows.card");
    expect(articleCard).toContain("...Shadows.carouselCard");
    expect(articleListItem).toContain("...Shadows.card");
    expect(articleListItem).toContain("marginHorizontal: Spacing.screenPx");
    expect(replyPicker).toContain("...Shadows.card");
    expect(replyPicker).toContain("marginHorizontal: Spacing.screenPx");
  });
});
