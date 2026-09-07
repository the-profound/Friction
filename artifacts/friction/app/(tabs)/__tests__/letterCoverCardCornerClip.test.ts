import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

const componentsRoot = join(appRoot, "..", "components");
const readComponent = (relativePath: string) =>
  readFileSync(join(componentsRoot, relativePath), "utf8");

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

// Regression coverage for two press-feedback corner defects fixed together:
//   A) In CanonicalCardSlot-scaled screens (e.g. the space-detail round
//      carousel), the press-in shrink used to animate only the inner
//      canonical-sized content while the outer slot box (which owns the
//      final radius + clip) stayed a fixed size — opening a gap between the
//      shrunk card and the slot's clip boundary.
//   B) ArticleCardCover relied on the cover image's own internal
//      border-radius clip instead of clipping itself, so a hairline of the
//      shadow layer's background could show through the rounded corners
//      while the press transform was live.
describe("card press-scale corner clipping", () => {
  it("lets ArticleCardCover clip its own corners instead of relying on the image's internal radius", () => {
    const source = readComponent("ArticleCardItem/ArticleCardCover.tsx");
    const rootStyleBlock =
      source.match(/style=\{\[\s*styles\.root,[\s\S]*?\]\}/)?.[0] ?? "";

    expect(rootStyleBlock).toContain('overflow: "hidden"');
  });

  it("has ScalePressable support an external shared value so an ancestor can mirror its press scale", () => {
    const source = readComponent("shared/ScalePressable.tsx");

    expect(source).toContain("externalScale");
    expect(source).toContain("applyScaleStyle");
    // The internal scale must fall back to externalScale when provided,
    // rather than always animating a private shared value that no ancestor
    // can observe.
    expect(source).toMatch(/externalScale\s*\?\?\s*localScale/);
  });

  it("forwards CanonicalCardSlot's pressScale into ArticleCardItem's ScalePressable instead of animating its own transform", () => {
    const source = readComponent("ArticleCardItem/ArticleCardItem.tsx");

    expect(source).toContain("pressScale");
    expect(source).toContain("externalScale={pressScale}");
    expect(source).toContain("applyScaleStyle={!pressScale}");
  });

  it("makes CanonicalCardSlot's outer clip box scale as one unit with the content's press animation", () => {
    const source = readComponent("ArticleCardItem/CanonicalCardSlot.tsx");

    // The outer node (owner of the final radius + overflow:hidden clip) must
    // be the one animated by the shared press-scale value, not a separate
    // static-only wrapper.
    expect(source).toContain("useSharedValue(1)");
    expect(source).toMatch(/transform:\s*\[\{\s*scale:\s*pressScale\.value\s*\}\]/);
    expect(source).toContain("RAnimated.View");
    // The same shared value must reach the ArticleCardItem child so its own
    // ScalePressable writes into it (single source of truth for the ratio).
    expect(source).toMatch(/cloneElement\([\s\S]*?\{\s*pressScale\s*\}/);
  });
});
