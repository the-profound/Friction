import { normalizeHexColor } from "./articleCoverColors";

export interface ArticleCoverPresentationInput {
  type?: "default" | "color" | "image";
  imageUrl?: string;
  bgColor?: string;
  textColor?: string;
  fontFamily?: "sans" | "serif";
}

interface ArticleCardCoverColors {
  neutralBackground: string;
  readableText: string;
}

/**
 * Selects visual colors from the rendered surface, rather than only from the
 * requested cover type. A saved image cover may have no image URL or fail to
 * load, so photo-oriented light text must never remain on the neutral fallback.
 */
export function getArticleCardCoverPresentation(
  cover: ArticleCoverPresentationInput | null | undefined,
  isImageRendered: boolean,
  colors: ArticleCardCoverColors,
) {
  const isMissingImage = cover?.type === "image" && !isImageRendered;
  const neutralBackground =
    normalizeHexColor(colors.neutralBackground) ?? "#FAFAFA";
  const readableText = normalizeHexColor(colors.readableText) ?? "#18181B";
  const coverBackground =
    cover?.type === "color" ? normalizeHexColor(cover.bgColor) : null;
  const coverText = normalizeHexColor(cover?.textColor);
  const hasUsableColorSurface =
    cover?.type !== "color" || coverBackground !== null;

  return {
    backgroundColor:
      coverBackground ?? neutralBackground,
    textColor: isMissingImage || !hasUsableColorSurface
      ? readableText
      : (coverText ?? readableText),
    isImageRendered,
  };
}

/**
 * Keep the author on the same baseline whether or not a collection name is
 * available. The collection line is the second line in the fixed card meta
 * block, so an absent collection must still reserve that line's height.
 */
export function getArticleCardSenderBottomOffset(
  pad: number,
  collectionLineHeight: number,
  hasCollectionName: boolean,
): number {
  return pad + (hasCollectionName ? 0 : collectionLineHeight);
}

/**
 * Old covers do not have a fontFamily value. Keep them on the current Gothic
 * treatment while allowing new covers to opt into the body serif face.
 */
export function getArticleCardCoverFontFamily(
  cover: ArticleCoverPresentationInput | null | undefined,
): "sans" | "serif" {
  return cover?.fontFamily === "serif" ? "serif" : "sans";
}