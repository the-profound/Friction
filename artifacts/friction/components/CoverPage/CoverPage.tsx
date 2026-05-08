import React, { useMemo } from "react";
import { View, Text, StyleSheet, ImageBackground } from "react-native";
import { ReaderTokens, Colors, cqiToPx, readerFontSize, readerLetterSpacing } from "@/constants/tokens";
import type { ArticleCover } from "@workspace/api-client-react";

interface CoverPageProps {
  cover: ArticleCover;
  title: string;
  authorName?: string;
  containerWidth: number;
  containerHeight: number;
  onImageLoad?: () => void;
}

export default function CoverPage({
  cover,
  title,
  authorName,
  containerWidth,
  containerHeight,
  onImageLoad,
}: CoverPageProps) {
  const dynamicStyles = useMemo(() => {
    const titleSize = readerFontSize(6.5, containerWidth);
    const authorSize = readerFontSize(3.6, containerWidth);
    const paddingX = cqiToPx(ReaderTokens.padding.xCqi, containerWidth);
    const paddingY = cqiToPx(ReaderTokens.padding.yCqi, containerWidth);

    const alignItems =
      cover.align === "left"
        ? ("flex-start" as const)
        : ("center" as const);

    const textAlign =
      cover.align === "left"
        ? ("left" as const)
        : ("center" as const);

    return StyleSheet.create({
      wrapper: {
        width: containerWidth,
        height: containerHeight,
        backgroundColor: cover.type === "color" || cover.type === "default"
          ? (cover.bgColor ?? Colors.zinc50)
          : "transparent",
        justifyContent: "center",
        alignItems,
        paddingHorizontal: paddingX * 2,
        paddingVertical: paddingY * 2,
      },
      imageWrapper: {
        width: containerWidth,
        height: containerHeight,
      },
      imageOverlay: {
        flex: 1,
        justifyContent: "center",
        alignItems,
        paddingHorizontal: paddingX * 2,
        paddingVertical: paddingY * 2,
        backgroundColor: "rgba(0,0,0,0.25)",
      },
      author: {
        fontSize: authorSize,
        fontFamily: ReaderTokens.fontFamily.sans,
        color: cover.textColor,
        opacity: 0.7,
        textAlign,
        lineHeight: authorSize * ReaderTokens.lineHeight.relaxed,
        marginBottom: cqiToPx(1.5, containerWidth),
      },
      title: {
        fontSize: titleSize,
        fontFamily: ReaderTokens.fontFamily.serifBold,
        color: cover.textColor,
        lineHeight: titleSize * ReaderTokens.lineHeight.tight,
        letterSpacing: readerLetterSpacing(
          ReaderTokens.letterSpacing.tightEm,
          titleSize,
        ),
        textAlign,
      },
    });
  }, [cover, containerWidth, containerHeight]);

  const content = (
    <>
      {authorName ? <Text style={dynamicStyles.author}>{authorName}</Text> : null}
      <Text style={dynamicStyles.title}>{title}</Text>
    </>
  );

  if (cover.type === "image" && cover.imageUrl) {
    return (
      <ImageBackground
        source={{ uri: cover.imageUrl }}
        style={dynamicStyles.imageWrapper}
        resizeMode="cover"
        onLoadEnd={onImageLoad}
      >
        <View style={dynamicStyles.imageOverlay}>
          {content}
        </View>
      </ImageBackground>
    );
  }

  return (
    <View style={dynamicStyles.wrapper}>
      {content}
    </View>
  );
}
