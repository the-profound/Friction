import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("selection-mode read entry", () => {
  it("does not connect cover taps to reader navigation", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const inbox = read("app/(tabs)/index.tsx");

    expect(overlay).not.toContain("onCardTap");
    expect(overlay).toContain(
      "const handleCardTap = useCallback(() => undefined, []);",
    );
    expect(overlay).toContain("onPress={handleCardTap}");
    const selectionCards = overlay.match(/<ArticleCardItem[\s\S]*?\/>/g) ?? [];
    expect(selectionCards.length).toBeGreaterThanOrEqual(3);
    for (const card of selectionCards) {
      expect(card).toContain("disabled");
    }
    expect(inbox).not.toContain("onCardTap={handleRead}");
  });

  it("keeps the explicit read CTA connected to the read callback", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");

    expect(overlay).toContain("const handleRead = useCallback(() =>");
    expect(overlay).toContain("runReadTransition(onRead);");
    expect(overlay).toContain(
      '<ScalePressable style={styles.ctaButton} contentStyle={styles.ctaButtonContent} onPress={handleRead}>',
    );
  });

  it("does not add a separate same-sized shadow card behind selection covers", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const articleCard = read("components/ArticleCardItem/ArticleCardItem.tsx");

    expect(overlay).not.toContain("renderCardShadow");
    expect(overlay).not.toContain("ArticleCardShadow");
    expect(articleCard).not.toContain("ArticleCardShadow");
    expect(articleCard).not.toContain("hideShadow");
    expect(articleCard).toContain("backgroundColor: DEFAULT_BG");
    expect(articleCard).toContain("...Shadows.card");
    expect(articleCard).toContain("...Shadows.carouselCard");
    expect(articleCard).toContain("shadowProgress?:");
    expect(articleCard).toContain("interpolate(shadowProgress.value");
    expect(articleCard).not.toContain("StyleSheet.absoluteFill");
    expect(overlay).toContain("shadowProgress={");
    expect(overlay).toContain("? progress");
  });
});