import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./SendInline.tsx", import.meta.url)),
  "utf8",
);

describe("SendInline send color contract", () => {
  it("uses the maroon outline, foreground, and soft fill only for the selected mode", () => {
    expect(source).toContain(
      "color={active ? Colors.primaryAction : Colors.zinc600}",
    );
    expect(source).toMatch(
      /modeButtonActive:\s*\{[\s\S]*?borderColor:\s*Colors\.primaryAction,[\s\S]*?backgroundColor:\s*Colors\.noticeAccentSoft,/,
    );
    expect(source).toMatch(
      /modeTextActive:\s*\{\s*color:\s*Colors\.primaryAction\s*\}/,
    );
    expect(source).toContain('accessibilityState={{ selected: active }}');
  });

  it("keeps inactive modes neutral and the enabled CTA maroon with white content", () => {
    expect(source).toMatch(
      /modeButton:\s*\{[\s\S]*?borderColor:\s*Colors\.zinc200,[\s\S]*?backgroundColor:\s*Colors\.white,/,
    );
    expect(source).toMatch(
      /sendButton:\s*\{[\s\S]*?backgroundColor:\s*Colors\.primaryAction,/,
    );
    expect(source).toMatch(
      /sendButtonText:\s*\{[\s\S]*?color:\s*Colors\.primaryActionForeground,/,
    );
    expect(source).toContain(
      "color={disabled ? Colors.zinc400 : Colors.white}",
    );
  });

  it("preserves button sizing, disabled styling, and submission state wiring", () => {
    expect(source).toContain("modeButtonOuter: { flex: 1, minHeight: 48 }");
    expect(source).toMatch(/modeButton:\s*\{[\s\S]*?minHeight:\s*48,/);
    expect(source).toContain(
      "sendButtonDisabled: { backgroundColor: Colors.zinc100 }",
    );
    expect(source).toContain("pending={isSubmitting}");
    expect(source).toContain(
      'disabled={!canSend || prefillArticleState.kind === "loading"}',
    );
  });
});