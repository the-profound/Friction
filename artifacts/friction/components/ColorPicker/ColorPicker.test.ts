import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ColorPicker interaction contract", () => {
  const source = readFileSync(join(__dirname, "ColorPicker.tsx"), "utf8");

  it("uses tap and drag responders for both spectrum and hue controls", () => {
    expect(source).toContain("onResponderGrant={handleSpectrumTouch}");
    expect(source).toContain("onResponderMove={handleSpectrumTouch}");
    expect(source).toContain("onResponderGrant={handleHueTouch}");
    expect(source).toContain("onResponderMove={handleHueTouch}");
    expect(source).toContain("getSpectrumAtPosition");
    expect(source).toContain("getHueAtPosition");
  });

  it("provides accessible adjustable controls and visible selected color feedback", () => {
    expect(source).toContain('accessibilityRole="adjustable"');
    expect(source).toContain("accessibilityHint=");
    expect(source).toContain("accessibilityValue=");
    expect(source).toContain("accessibilityActions=");
    expect(source).toContain("onAccessibilityAction=");
    expect(source).toContain("valueSwatch");
    expect(source).toContain("valueText");
    expect(source).toContain("spectrumMarker");
    expect(source).toContain("hueMarker");
  });
});