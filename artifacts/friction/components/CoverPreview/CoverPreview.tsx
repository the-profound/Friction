import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Colors, Typography } from "../../constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";
import { resolveArticleCover } from "../../utils/articleCover";

interface CoverPreviewProps {
  cover: ArticleCover | null | undefined;
  title: string;
  author?: string;
  compact?: boolean;
}

export default function CoverPreview({
  cover: coverProp,
  title,
  author,
  compact = false,
}: CoverPreviewProps) {
  const cover = resolveArticleCover(coverProp);
  const isImage = cover.type === "image" && !!cover.imageUrl;
  const bgColor = cover.type === "color" && cover.bgColor ? cover.bgColor : Colors.zinc50;

  return (
    <View
      style={[
        styles.container,
        compact && styles.containerCompact,
        { backgroundColor: isImage ? Colors.zinc200 : bgColor },
      ]}
    >
      {isImage && (
        <Image
          source={{ uri: cover.imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      <View
        style={[
          styles.overlay,
          {
            alignItems: cover.align === "center" ? "center" : "flex-start",
          },
        ]}
      >
        <Text
          style={[
            compact ? styles.titleCompact : styles.title,
            { color: cover.textColor, textAlign: cover.align },
          ]}
          numberOfLines={compact ? 2 : 3}
        >
          {title || "제목 없음"}
        </Text>
        {author ? (
          <Text
            style={[
              compact ? styles.authorCompact : styles.author,
              { color: cover.textColor, textAlign: cover.align, opacity: 0.7 },
            ]}
            numberOfLines={1}
          >
            {author}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    aspectRatio: 5 / 8,
    width: "100%",
    maxHeight: 400,
    justifyContent: "flex-end",
  },
  containerCompact: {
    maxHeight: 200,
    aspectRatio: 4 / 5,
  },
  overlay: {
    padding: 24,
    justifyContent: "flex-end",
  },
  title: {
    ...Typography.bodySemiBold,
    fontSize: 22,
    lineHeight: 30,
  },
  titleCompact: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  author: {
    ...Typography.body,
    fontSize: 14,
    marginTop: 8,
  },
  authorCompact: {
    ...Typography.body,
    fontSize: 11,
    marginTop: 4,
  },
});
