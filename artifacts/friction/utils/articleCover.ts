import type { ArticleCover } from "@workspace/api-client-react";
import { Colors } from "../constants/tokens";
import { normalizeCoverColorSettings } from "../lib/articleCoverColors";
import { runtimeConfig } from "../lib/runtimeConfig";

const DEFAULT_COVER: ArticleCover = {
  type: "color",
  textColor: Colors.zinc900,
  bgColor: Colors.zinc50,
  fontFamily: "sans",
  align: "left",
};

export function getDefaultCover(): ArticleCover {
  return { ...DEFAULT_COVER };
}

/**
 * Article covers persist their server-owned storage path as a relative API
 * URL. expo-image on native needs an absolute URL, while browser rendering
 * accepts either. Normalize at the shared presentation boundary so reloads and
 * list cards render the same saved cover as the editor.
 */
export function resolveArticleCoverImageUrl(
  imageUrl: string | undefined,
): string | undefined {
  if (!imageUrl || /^https?:\/\//i.test(imageUrl) || !runtimeConfig.apiBaseUrl) {
    return imageUrl;
  }
  return new URL(imageUrl, `${runtimeConfig.apiBaseUrl}/`).toString();
}

export function resolveArticleCover(cover: ArticleCover | null | undefined): ArticleCover {
  if (!cover) return getDefaultCover();
  const normalized = normalizeCoverColorSettings(
    cover,
    Colors.zinc900,
    Colors.zinc50,
  );
  return normalized.type === "image"
    ? { ...normalized, imageUrl: resolveArticleCoverImageUrl(normalized.imageUrl) }
    : normalized;
}
