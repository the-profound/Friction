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

  it("does not move the existing list or letter card shadows", () => {
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
      "rowContent: { padding: 16, gap: 7, borderRadius: 16, backgroundColor: Colors.white, ...Shadows.card }",
    );
    expect(articleCard).toContain("...Shadows.card");
    expect(articleCard).toContain("...Shadows.carouselCard");
    expect(articleListItem).toContain("...Shadows.card");
    expect(articleListItem).toContain("marginHorizontal: Spacing.screenPx");
  });
});
