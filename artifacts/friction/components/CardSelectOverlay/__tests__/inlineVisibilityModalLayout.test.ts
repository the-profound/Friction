import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../../..");
const overlayHook = readFileSync(
  join(appRoot, "hooks/useLetterSelectionOverlay.tsx"),
  "utf8",
);
const cardSelectOverlay = readFileSync(
  join(appRoot, "components/CardSelectOverlay/CardSelectOverlay.tsx"),
  "utf8",
);

describe("inline visibility modal layout contract", () => {
  it("owns the native Modal window and centers both dialog variants in it", () => {
    expect(overlayHook).toMatch(
      /<View style=\{inlineOverlayStyles\.fullScreenRoot\}>[\s\S]*?<Pressable style=\{inlineOverlayStyles\.backdrop\}/,
    );
    expect(overlayHook).toMatch(
      /fullScreenRoot:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?width:\s*"100%",[\s\S]*?height:\s*"100%"/,
    );
    expect(overlayHook).toMatch(
      /backdrop:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?width:\s*"100%",[\s\S]*?height:\s*"100%"[\s\S]*?justifyContent:\s*"center"[\s\S]*?alignItems:\s*"center"/,
    );
    expect(overlayHook).not.toMatch(
      /backdrop:\s*\{\s*\.\.\.StyleSheet\.absoluteFillObject/,
    );
  });

  it("keeps the dialog inline above the selection overlay content", () => {
    const inlineModalIndex = cardSelectOverlay.indexOf("{inlineModal}");
    const ctaIndex = cardSelectOverlay.indexOf("styles.ctaWrapper");

    expect(inlineModalIndex).toBeGreaterThan(ctaIndex);
    expect(cardSelectOverlay).toContain(
      "Must be a View-based overlay — not a nested",
    );
    expect(overlayHook).toContain("inlineModal={inlineModalNode ?? undefined}");
  });

  it("preserves full-screen dismissal and card event isolation", () => {
    expect(overlayHook).toContain(
      '<Pressable style={inlineOverlayStyles.backdrop} onPress={handleDismiss}>',
    );
    expect(overlayHook).toContain(
      '<Pressable style={inlineOverlayStyles.card} onPress={(e) => e.stopPropagation()}>',
    );
    expect(overlayHook).toContain("if (isChangingVisibility) return;");
  });
});