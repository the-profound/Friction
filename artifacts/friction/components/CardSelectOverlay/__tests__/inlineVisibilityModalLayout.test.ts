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
const confirmModal = readFileSync(
  join(appRoot, "components/ConfirmModal/ConfirmModal.tsx"),
  "utf8",
);

describe("inline visibility modal layout contract", () => {
  it("owns the native Modal window and centers both dialog variants in it", () => {
    expect(overlayHook).toMatch(
      /<Animated\.View[\s\S]*?style=\{\[inlineOverlayStyles\.fullScreenRoot,[\s\S]*?<Pressable[\s\S]*?style=\{inlineOverlayStyles\.overlay\}/,
    );
    expect(overlayHook).toMatch(
      /fullScreenRoot:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?width:\s*"100%",[\s\S]*?height:\s*"100%"/,
    );
    expect(overlayHook).toMatch(
      /overlay:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?backgroundColor:\s*"rgba\(0,0,0,0\.4\)",[\s\S]*?justifyContent:\s*"center"[\s\S]*?alignItems:\s*"center"/,
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
    expect(overlayHook).toContain("<InlineConfirmDialog");
  });

  it("preserves full-screen dismissal and card event isolation", () => {
    expect(overlayHook).toMatch(
      /<Pressable\s+style=\{inlineOverlayStyles\.overlay\}[\s\S]*?onPress=\{cancelDisabled \? undefined : onCancel\}/,
    );
    expect(overlayHook).toContain(
      '<Pressable style={inlineOverlayStyles.card} onPress={(e) => e.stopPropagation()}>',
    );
    expect(overlayHook).toContain("if (isChangingVisibility) return;");
  });

  it("fades in/out and freezes the last real content while closing, like ConfirmModal", () => {
    // Same trick as ConfirmModal: freeze props into refs while visible so the
    // dialog never renders empty/stale text mid fade-out.
    expect(overlayHook).toMatch(/const frozenTitle = useRef\(title\);/);
    expect(overlayHook).toMatch(/const frozenDescription = useRef\(description\);/);
    expect(overlayHook).toMatch(/if \(visible\) \{[\s\S]*?frozenTitle\.current = title;/);
    expect(overlayHook).toMatch(
      /Animated\.timing\(opacity,\s*\{\s*toValue:\s*0,[\s\S]*?\}\)\.start\(\(\{ finished \}\) => \{\s*if \(finished\) setIsMounted\(false\);/,
    );
  });

  it("matches ConfirmModal's color, typography, and spacing tokens", () => {
    // Card shape.
    expect(overlayHook).toMatch(/card:\s*\{[\s\S]*?borderRadius:\s*16,/);
    expect(confirmModal).toMatch(/card:\s*\{[\s\S]*?borderRadius:\s*16,/);

    // Title/description tokens.
    expect(overlayHook).toMatch(/title:\s*\{[\s\S]*?\.\.\.Typography\.bodySemiBold,[\s\S]*?color:\s*Colors\.zinc900,/);
    expect(overlayHook).toMatch(/description:\s*\{[\s\S]*?\.\.\.Typography\.body,[\s\S]*?color:\s*Colors\.zinc500,/);

    // Button shape and colors — cancel is neutral, confirm uses the app's
    // primary action color (not a hardcoded dark/black surface).
    expect(overlayHook).toMatch(/buttonContent:\s*\{[\s\S]*?height:\s*48,[\s\S]*?borderRadius:\s*12,/);
    expect(overlayHook).toMatch(/cancelButton:\s*\{\s*backgroundColor:\s*Colors\.zinc100,/);
    expect(overlayHook).toMatch(/confirmButton:\s*\{\s*backgroundColor:\s*Colors\.primaryAction,/);
    expect(overlayHook).not.toMatch(/confirmButton:\s*\{\s*backgroundColor:\s*Colors\.zinc900,/);
    expect(overlayHook).toMatch(/confirmText:\s*\{[\s\S]*?color:\s*Colors\.primaryActionForeground,/);
  });
});
