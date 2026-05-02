import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, LayoutChangeEvent } from "react-native";
import { Colors, ReaderTokens, cqiToPx, readerFontSize, readerLetterSpacing } from "../../constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";
import { resolveArticleCover } from "../../utils/articleCover";

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
  const cover = resolveArticleCover(coverProp);
  const isImage = cover.type === "image" && !!cover.imageUrl;
  const bgColor =
    cover.type === "color" || cover.type === "default"
      ? (cover.bgColor ?? Colors.zinc50)
      : Colors.zinc50;

  const [containerWidth, setContainerWidth] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const alignItems = cover.align === "left" ? "flex-start" : "center";
  const textAlign = cover.align === "left" ? "left" as const : "center" as const;

  const titleSize = containerWidth > 0 ? readerFontSize(6.5, containerWidth) : (compact ? 16 : 22);
  const authorSize = containerWidth > 0 ? readerFontSize(3.6, containerWidth) : (compact ? 11 : 14);
  const paddingX = containerWidth > 0 ? cqiToPx(ReaderTokens.padding.xCqi, containerWidth) * 2 : 24;
  const paddingY = containerWidth > 0 ? cqiToPx(ReaderTokens.padding.yCqi, containerWidth) * 2 : 32;

  return (
    <View
      style={[
        styles.container,
        compact && styles.containerCompact,
        { backgroundColor: isImage ? Colors.zinc200 : bgColor, borderRadius },
      ]}
      onLayout={onLayout}
    >
      {isImage && (
        <Image
          source={{ uri: cover.imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      {isImage && <View style={styles.imageOverlay} />}
      <View
        style={[
          styles.overlay,
          { alignItems, paddingHorizontal: paddingX, paddingVertical: paddingY },
        ]}
      >
        {author ? (
          <Text
            style={{
              fontFamily: ReaderTokens.fontFamily.sans,
              fontSize: authorSize,
              lineHeight: authorSize * ReaderTokens.lineHeight.relaxed,
              color: cover.textColor,
              textAlign,
              opacity: 0.7,
              marginBottom: cqiToPx(1.5, containerWidth > 0 ? containerWidth : 160),
            }}
            numberOfLines={1}
          >
            {author}
          </Text>
        ) : null}
        <Text
          style={{
            fontFamily: ReaderTokens.fontFamily.serifBold,
            fontSize: titleSize,
            lineHeight: titleSize * ReaderTokens.lineHeight.tight,
            letterSpacing: readerLetterSpacing(ReaderTokens.letterSpacing.tightEm, titleSize),
            color: cover.textColor,
            textAlign,
          }}
          numberOfLines={compact ? 2 : 3}
        >
          {title || "제목 없음"}
        </Text>
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
    maxHeight: 480,
    justifyContent: "center",
  },
  containerCompact: {
    maxHeight: 200,
    aspectRatio: 4 / 5,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  overlay: {
    justifyContent: "center",
  },
});
