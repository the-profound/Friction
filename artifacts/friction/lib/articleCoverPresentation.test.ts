import { describe, expect, it } from "vitest";
import {
  getArticleCardCoverPresentation,
  getArticleCardCoverFontFamily,
  getArticleCardSenderBottomOffset,
} from "./articleCoverPresentation";

const colors = {
  neutralBackground: "#fafafa",
  readableText: "#18181b",
};

describe("getArticleCardCoverPresentation", () => {
  const whiteTextImageCover = {
    type: "image" as const,
    imageUrl: "https://example.com/cover.jpg",
    textColor: "#FFFFFF",
  };

  it("keeps the chosen text color while a photo is rendered", () => {
    expect(
      getArticleCardCoverPresentation(whiteTextImageCover, true, colors),
    ).toMatchObject({
      textColor: "#FFFFFF",
      isImageRendered: true,
    });
  });

  it("uses readable dark text when a photo is missing or fails", () => {
    expect(
      getArticleCardCoverPresentation(whiteTextImageCover, false, colors),
    ).toEqual({
      backgroundColor: "#fafafa",
      textColor: "#18181b",
      isImageRendered: false,
    });

    expect(
      getArticleCardCoverPresentation(
        { ...whiteTextImageCover, imageUrl: undefined },
        false,
        colors,
      ).textColor,
    ).toBe("#18181b");
  });

  it("preserves selected color-cover text and background values", () => {
    expect(
      getArticleCardCoverPresentation(
        {
          type: "color",
          bgColor: "#18181b",
          textColor: "#FFFFFF",
        },
        false,
        colors,
      ),
    ).toEqual({
      backgroundColor: "#18181b",
      textColor: "#FFFFFF",
      isImageRendered: false,
    });
  });

  it("reserves the collection line when positioning an author without a collection", () => {
    expect(getArticleCardSenderBottomOffset(24, 20.8, true)).toBe(24);
    expect(getArticleCardSenderBottomOffset(24, 20.8, false)).toBe(44.8);
  });

  it("defaults old covers to Gothic and preserves the serif choice", () => {
    expect(getArticleCardCoverFontFamily({ type: "default" })).toBe("sans");
    expect(getArticleCardCoverFontFamily({ type: "default", fontFamily: "serif" })).toBe(
      "serif",
    );
  });
});