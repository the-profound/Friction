import React from "react";
import { View, StyleSheet } from "react-native";
import type { ArticleCover } from "@workspace/api-client-react";
import { ReaderTokens } from "../../constants/tokens";
import ArticleCardCover from "../ArticleCardItem/ArticleCardCover";

const COMPACT_PREVIEW_HEIGHT = 200;
const COMPACT_PREVIEW_WIDTH =
  COMPACT_PREVIEW_HEIGHT * ReaderTokens.aspectRatio;

interface CoverPreviewProps {
  cover: ArticleCover | null | undefined;
  title: string;
  author?: string;
  compact?: boolean;
  borderRadius?: number;
}

export default function CoverPreview({
  cover: coverProp,
  title,
  author,
  compact = false,
  borderRadius = 16,
}: CoverPreviewProps) {
  return (
    <View
      style={[
        styles.container,
        compact && styles.containerCompact,
        { borderRadius },
      ]}
    >
      <ArticleCardCover
        cover={coverProp}
        title={title || "제목 없음"}
        authorName={author}
        borderRadius={borderRadius}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    width: "100%",
    height: "100%",
    position: "relative",
  },
  containerCompact: {
    width: COMPACT_PREVIEW_WIDTH,
    height: COMPACT_PREVIEW_HEIGHT,
    aspectRatio: ReaderTokens.aspectRatio,
  },
});