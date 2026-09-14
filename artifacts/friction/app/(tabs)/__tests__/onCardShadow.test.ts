import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("record card shadow ownership", () => {
  it("separates the animated shadow layer from the clipped card surface", () => {
    const onScreen = read("(tabs)/on.tsx");
    const outerStyle = onScreen.match(/thoughtCard:\s*\{([^}]*)\}/)?.[1] ?? "";
    const contentStyle =
      onScreen.match(/thoughtCardContent:\s*\{([^}]*)\}/)?.[1] ?? "";
    const surfaceStyle =
      onScreen.match(/thoughtCardSurface:\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(outerStyle).not.toContain("Shadows.");
    expect(outerStyle).not.toContain("borderRadius");
    expect(contentStyle).toContain("borderRadius");
    expect(contentStyle).toContain("...Shadows.carouselCard");
    expect(contentStyle).not.toContain('overflow: "hidden"');
    expect(surfaceStyle).toContain("borderRadius");
    expect(surfaceStyle).toContain('overflow: "hidden"');
    expect(surfaceStyle).not.toContain("Shadows.");
  });

  it("uses a white default surface while preserving the red question surface", () => {
    const onScreen = read("(tabs)/on.tsx");
    const contentStyle =
      onScreen.match(/thoughtCardContent:\s*\{([^}]*)\}/)?.[1] ?? "";
    const surfaceStyle =
      onScreen.match(/thoughtCardSurface:\s*\{([^}]*)\}/)?.[1] ?? "";
    const questionStyle =
      onScreen.match(/questionCardSurface:\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(contentStyle).toContain("backgroundColor: Colors.white");
    expect(surfaceStyle).toContain("backgroundColor: Colors.white");
    expect(contentStyle).not.toContain("Colors.zinc50");
    expect(surfaceStyle).not.toContain("Colors.zinc50");
    expect(questionStyle).toContain("backgroundColor: Colors.noticeAccent");
    expect(onScreen).toContain("question && styles.questionCardSurface");
  });

  it("keeps card-view shadows untouched while list rows use the toned-down list card shadow", () => {
    const recordRow = read(
      "../components/RecordRow/RecordRow.tsx",
    );
    const articleCard = read(
      "../components/ArticleCardItem/ArticleCardItem.tsx",
    );
    const articleListItem = read(
      "../components/ArticleListItem/ArticleListItem.tsx",
    );
    expect(recordRow).toContain(
      "rowContent: { padding: 16, gap: 7, borderRadius: 16, backgroundColor: Colors.white, ...Shadows.listCard }",
    );
    expect(articleCard).toContain("...Shadows.card");
    expect(articleCard).toContain("...Shadows.carouselCard");
    expect(articleListItem).toContain("...Shadows.listCard");
    expect(articleListItem).toContain("marginHorizontal: Spacing.screenPx");
  });

  it("lets the 기록 letter slot own one unclipped carousel shadow", () => {
    const onScreen = read("(tabs)/on.tsx");
    const letterBranch = onScreen.match(
      /if \(record\.kind === "letter"\) \{[\s\S]*?\n {2}\}/,
    )?.[0] ?? "";
    const canonicalSlot = read(
      "../components/ArticleCardItem/CanonicalCardSlot.tsx",
    );

    expect(letterBranch).toContain(
      "<CanonicalCardSlot width={width} height={height} carouselShadow>",
    );
    expect(letterBranch).not.toContain("<ArticleCardItem\n            carouselShadow");
    expect(canonicalSlot).toContain("carouselShadow && styles.carouselShadow");
    expect(canonicalSlot).toContain('overflow: "visible"');
    expect(canonicalSlot).toContain("styles.clip");
  });

  it("gives the list view's first row breathing room below the filter bar", () => {
    const onScreen = read("(tabs)/on.tsx");
    expect(onScreen).toContain(
      "contentContainerStyle={{ paddingTop: FILTER_BAR_HEIGHT + Spacing.cardGap, paddingBottom: navBottom + 16 }}",
    );
  });
});
