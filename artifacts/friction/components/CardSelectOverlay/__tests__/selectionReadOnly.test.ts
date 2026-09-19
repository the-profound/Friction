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
    const inbox = read("app/(tabs)/index.tsx");

    expect(overlay).toContain("const handleRead = useCallback(() =>");
    expect(overlay).toContain("runReadTransition(onRead);");
    expect(overlay).toContain("contentStyle={[");
    expect(overlay).toContain("readAction.mode === \"re_read\"");
    expect(overlay).toContain("accessibilityLabel={readAction.label}");
    expect(overlay).toContain("ctaButtonRereadContent");
    expect(overlay).toContain("backgroundColor: Colors.noticeAccentSoft");
    expect(overlay).toContain("borderColor: Colors.primaryAction");
    expect(overlay).toContain("ctaButton: { width: \"100%\", height: 56");
    expect(overlay).toContain("ctaButtonFlex: { flex: 1, height: 56");
    expect(overlay).toContain("onPress={handleRead}");
    expect(inbox).toContain("hasReadBefore: item.hasReadBefore");
    expect(inbox).toContain("mode: selectionMode");
  });

  it("does not add a separate same-sized shadow card behind selection covers", () => {
    const overlay = read("components/CardSelectOverlay/CardSelectOverlay.tsx");
    const articleCard = read("components/ArticleCardItem/ArticleCardItem.tsx");

    expect(overlay).not.toContain("renderCardShadow");
    expect(overlay).not.toContain("ArticleCardShadow");
    expect(articleCard).not.toContain("ArticleCardShadow");
    expect(articleCard).not.toContain("hideShadow");
    expect(articleCard).toContain("backgroundColor: DEFAULT_BG");
    // The letter card module (CanonicalCardSlot + ArticleCardItem +
    // CardSelectOverlay) renders a flat, shadow-free surface in every
    // state — see letterCoverCardCornerClip.test.ts's "never renders a
    // shadow" coverage.
    expect(articleCard).not.toContain("Shadows.");
    expect(articleCard).not.toContain("shadowProgress");
    expect(articleCard).not.toContain("StyleSheet.absoluteFill");
    expect(overlay).not.toContain("shadowProgress");
  });
});