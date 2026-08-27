import type { ArticleCover } from "@workspace/api-client-react";
import { Colors } from "../constants/tokens";

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
  return cover;
}
