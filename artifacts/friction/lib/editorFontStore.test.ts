import { describe, expect, it } from "vitest";

import {
  areEditorFontsReady,
  getEditorFonts,
  setEditorFontFallback,
  setEditorFonts,
  setEditorFontsError,
} from "./editorFontStore";

describe("editorFontStore", () => {
  it("publishes the custom four-face contract atomically", () => {
    setEditorFonts("eulyoo-r", "eulyoo-s", "noto-r", "noto-s");

    expect(getEditorFonts()).toEqual({
      regularBase64: "eulyoo-r",
      semiBoldBase64: "eulyoo-s",
      notoRegularBase64: "noto-r",
      notoSemiBoldBase64: "noto-s",
      error: null,
    });
    expect(areEditorFontsReady(getEditorFonts())).toBe(true);
  });

  it("publishes a complete Noto-only contract after a partial custom failure", () => {
    setEditorFontFallback("noto-r", "noto-s", "Eulyoo download failed");

    expect(getEditorFonts()).toEqual({
      regularBase64: "noto-r",
      semiBoldBase64: "noto-s",
      notoRegularBase64: "noto-r",
      notoSemiBoldBase64: "noto-s",
      error: "Eulyoo download failed",
    });
    expect(areEditorFontsReady(getEditorFonts())).toBe(true);
  });

  it("does not retain a stale partial or custom set when Noto is unavailable", () => {
    setEditorFonts("old-r", "old-s", "old-noto-r", "old-noto-s");
    setEditorFontsError("Noto download failed");

    expect(getEditorFonts()).toEqual({
      regularBase64: null,
      semiBoldBase64: null,
      notoRegularBase64: null,
      notoSemiBoldBase64: null,
      error: "Noto download failed",
    });
    expect(areEditorFontsReady(getEditorFonts())).toBe(false);
  });
});
