import { describe, expect, it } from "vitest";
import {
  getHsvFromHex,
  getHueAtPosition,
  getSpectrumAtPosition,
  hexToHsv,
  hsvToHex,
  normalizeCoverColorSettings,
  normalizeHexColor,
} from "./articleCoverColors";

describe("article cover color helpers", () => {
  it("normalizes 3-digit and 6-digit opaque hex values", () => {
    expect(normalizeHexColor(" #abc ")).toBe("#AABBCC");
    expect(normalizeHexColor("#AbCdEf")).toBe("#ABCDEF");
    expect(normalizeHexColor("#ABCDEF80")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });

  it.each(["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#7B2CBF"])(
    "round-trips %s through HSV",
    (hex) => {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    },
  );

  it("uses stable grayscale boundaries", () => {
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#FFFFFF")).toEqual({ h: 0, s: 0, v: 1 });
    expect(hsvToHex({ h: -20, s: 1.5, v: 2 })).toBe("#FF0055");
    expect(hsvToHex({ h: Number.NaN, s: Number.NaN, v: Number.NaN })).toBe(
      "#000000",
    );
  });

  it("falls back safely when an existing cover has an invalid color", () => {
    expect(getHsvFromHex("#not-a-color", { h: 0, s: 0, v: 1 })).toEqual({
      h: 0,
      s: 0,
      v: 1,
    });
  });

  it("maps taps and drags using each rendered control's actual bounds", () => {
    expect(getHueAtPosition(0, 240)).toBe(0);
    expect(getHueAtPosition(120, 240)).toBe(180);
    expect(getHueAtPosition(240, 240)).toBe(0);

    expect(
      getSpectrumAtPosition({ h: 120, s: 0.2, v: 0.2 }, 60, 46, 120, 92),
    ).toEqual({ h: 120, s: 0.5, v: 0.5 });
    expect(
      getSpectrumAtPosition({ h: 120, s: 0.2, v: 0.2 }, -10, 200, 120, 92),
    ).toEqual({ h: 120, s: 0, v: 0 });
  });

  it("normalizes saved cover settings before a picker or save request uses them", () => {
    expect(
      normalizeCoverColorSettings(
        {
          type: "color",
          textColor: "#aBc",
          bgColor: "112233",
        },
        "#18181b",
        "#fafafa",
      ),
    ).toEqual({
      type: "color",
      textColor: "#AABBCC",
      bgColor: "#112233",
    });

    expect(
      normalizeCoverColorSettings(
        {
          type: "color",
          textColor: "not-a-color",
          bgColor: "#12345",
        },
        "#18181b",
        "#fafafa",
      ),
    ).toMatchObject({
      textColor: "#18181B",
      bgColor: "#FAFAFA",
    });
  });
});