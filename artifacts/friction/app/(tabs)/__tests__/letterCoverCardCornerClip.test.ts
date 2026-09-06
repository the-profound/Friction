import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

// Regression coverage for a corner-leak bug: the 기록 tab drew letter covers
// directly (no outer wrapper owning the final radius+clip), and any grid that
// opts a letter cover into the restrained carousel shadow token must open its
// CardSelectOverlay with the same token — otherwise the shadow visibly pops
// to the larger standard token right at the card's rounded corners.
describe("letter cover card corner clipping", () => {
  it("wraps the 기록 tab's letter cover in CanonicalCardSlot so the outer wrapper owns radius+clip", () => {
    const onScreen = read("(tabs)/on.tsx");
    const letterBranch = onScreen.match(
      /if \(record\.kind === "letter"\) \{[\s\S]*?\n {2}\}/,
    )?.[0] ?? "";

    expect(letterBranch).toContain("<CanonicalCardSlot");
    expect(letterBranch).toContain("</CanonicalCardSlot>");
    // The slot itself now owns the card's rendered size; ArticleCardItem must
    // not also be forced to a native cardWidth inside it.
    expect(letterBranch).not.toContain("cardWidth={width}");
  });

  it("opens the overlay with originUsesCarouselShadow wherever a letter grid uses the carousel shadow token", () => {
    const filesWithCarouselShadowLetterCards = [
      "(tabs)/on.tsx",
      "(tabs)/index.tsx",
      "of-01-detail.tsx",
    ];

    for (const relativePath of filesWithCarouselShadowLetterCards) {
      const source = read(relativePath);
      expect(source).toContain("carouselShadow");
      expect(source).toContain("originUsesCarouselShadow: true");
    }
  });
});
