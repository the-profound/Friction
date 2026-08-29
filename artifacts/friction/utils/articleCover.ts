import type { ArticleCover } from "@workspace/api-client-react";
import { Colors } from "../constants/tokens";
import { normalizeCoverColorSettings } from "../lib/articleCoverColors";

const DEFAULT_COVER: ArticleCover = {
  type: "default",
  textColor: Colors.zinc900,
  fontFamily: "sans",
  align: "left",
};

export function getDefaultCover(): ArticleCover {
  return { ...DEFAULT_COVER };
}

export function resolveArticleCover(cover: ArticleCover | null | undefined): ArticleCover {
  if (!cover) return getDefaultCover();
  return normalizeCoverColorSettings(
    cover,
    Colors.zinc900,
    Colors.zinc50,
  );
}
