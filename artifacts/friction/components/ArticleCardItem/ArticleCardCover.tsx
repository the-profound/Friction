import React, { useCallback, useState } from "react";
import {
  LayoutChangeEvent,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ArticleCover } from "@workspace/api-client-react";
import {
  Colors,
  ReaderTokens,
  Sizing,
  readerFontSize,
} from "@/constants/tokens";
import {
  getArticleCardCoverPresentation,
  getArticleCardCoverFontFamily,
  getArticleCardSenderBottomOffset,
} from "@/lib/articleCoverPresentation";

interface ArticleCardCoverProps {
  cover?: ArticleCover | null;
  title: string;
  authorName?: string;
  collectionName?: string | null;
  date?: string | null;
  letterTypeBadge?: string | null;
  width?: number;
  height?: number;
  borderRadius?: number;
  onImageLoad?: () => void;
}

const AUTHOR_SIZE = 24;
const COLLECTION_SIZE = 16;

/**
 * The visual surface shared by letter cards, reading covers, and cover
 * previews. Keep the title/meta placement here so a letter never changes its
 * identity when it moves between a carousel and a full-page preview.
 *
 * `cover.align` is intentionally not read. It remains part of the API shape
 * for backwards compatibility, but cards use one fixed layout: title at the
 * top-left and sender/collection at the bottom-right. The sender also reserves
 * the collection line when that optional metadata is unavailable.
 */
export default function ArticleCardCover({
  cover,
  title,
  authorName,
  collectionName,
  date,
  letterTypeBadge,
  width,
  height,
  borderRadius = 16,
  onImageLoad,
}: ArticleCardCoverProps) {
  const [measuredSize, setMeasuredSize] = useState({ width: 0, height: 0 });
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setMeasuredSize((current) =>
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight },
    );
  }, []);

  const resolvedWidth = width ?? (measuredSize.width || 300);
  const resolvedHeight =
    height ?? (measuredSize.height || resolvedWidth * Sizing.cardRatio);
  const coverType = cover?.type ?? "default";
  const imageUrl = cover?.imageUrl;
  const hasImage =
    coverType === "image" && !!imageUrl && failedImageUrl !== imageUrl;
  const presentation = getArticleCardCoverPresentation(cover, hasImage, {
    neutralBackground: Colors.zinc50,
    readableText: Colors.zinc900,
  });
  const textColor = presentation.textColor;
  const coverFontFamily = getArticleCardCoverFontFamily(cover);
  const regularFontFamily =
    coverFontFamily === "serif"
      ? ReaderTokens.fontFamily.serif
      : ReaderTokens.fontFamily.sans;
  const boldFontFamily =
    coverFontFamily === "serif"
      ? ReaderTokens.fontFamily.serifBold
      : ReaderTokens.fontFamily.sansBold;

  const scale = resolvedWidth / Sizing.cardSlotW;
  const pad = Math.max(6, Math.round(24 * scale));
  const textFrameWidth = Math.max(1, resolvedWidth - pad * 2);
  const titleSize = Math.max(
    8,
    Math.round(
      readerFontSize(ReaderTokens.typeScale.cardTitleCqi, textFrameWidth),
    ),
  );
  const authorSize = Math.max(6, Math.round(AUTHOR_SIZE * scale));
  const collectionSize = Math.max(5, Math.round(COLLECTION_SIZE * scale));
  const senderBottom = getArticleCardSenderBottomOffset(
    pad,
    collectionSize * 1.3,
    !!collectionName,
  );

  const handleImageError = useCallback(() => {
    if (imageUrl) setFailedImageUrl(imageUrl);
    // Image capture needs to proceed even when the remote image is unavailable.
    onImageLoad?.();
  }, [imageUrl, onImageLoad]);

  return (
    <View
      style={[
        styles.root,
        width === undefined && StyleSheet.absoluteFill,
        {
          width: width ?? "100%",
          height: height ?? "100%",
          borderRadius,
          backgroundColor: presentation.backgroundColor,
        },
      ]}
      onLayout={handleLayout}
    >
      {hasImage ? (
        <Image
          source={{ uri: imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={onImageLoad}
          onError={handleImageError}
        />
      ) : null}
      {hasImage ? <View style={styles.imageOverlay} /> : null}

      <View style={[styles.inner, { padding: pad }]} pointerEvents="none">
        {letterTypeBadge ? (
          <View
            style={[
              styles.letterTypeBadge,
              !presentation.isImageRendered && {
                backgroundColor: `${textColor}22`,
              },
            ]}
          >
            <Text
              style={[
                styles.letterTypeBadgeText,
                {
                  fontSize: Math.max(8, Math.round(10 * scale)),
                  fontFamily: boldFontFamily,
                  color: presentation.isImageRendered
                    ? Colors.white
                    : textColor,
                },
              ]}
            >
              {letterTypeBadge}
            </Text>
          </View>
        ) : null}

        <Text
          style={[
            styles.title,
            {
              color: textColor,
              fontFamily: boldFontFamily,
              fontSize: titleSize,
              lineHeight: titleSize * ReaderTokens.lineHeight.tight,
              marginTop: letterTypeBadge
                ? Math.max(4, Math.round(6 * scale))
                : 0,
            },
          ]}
          numberOfLines={4}
        >
          {title}
        </Text>

        <View style={[styles.senderBlock, { bottom: senderBottom, right: pad }]}>
          {authorName ? (
            <Text
              style={[
                styles.author,
                {
                  color: textColor,
                  fontFamily: boldFontFamily,
                  fontSize: authorSize,
                  lineHeight: authorSize * 1.3,
                },
              ]}
              numberOfLines={1}
            >
              {authorName}
            </Text>
          ) : null}
          {collectionName ? (
            <Text
              style={[
                styles.collection,
                {
                  color: textColor,
                  fontFamily: boldFontFamily,
                  fontSize: collectionSize,
                  lineHeight: collectionSize * 1.3,
                },
              ]}
              numberOfLines={1}
            >
              {collectionName}
            </Text>
          ) : null}
        </View>

        {date ? (
          <Text
            style={[
              styles.dateText,
              {
                left: 0,
                bottom: pad,
                  fontFamily: regularFontFamily,
                fontSize: Math.max(7, Math.round(9 * scale)),
                color:
                  presentation.isImageRendered ? Colors.white : textColor,
                opacity: presentation.isImageRendered ? 0.7 : 0.55,
              },
            ]}
            numberOfLines={1}
          >
            {date}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    overflow: "hidden",
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  inner: {
    flex: 1,
    justifyContent: "flex-start",
  },
  title: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    alignSelf: "flex-start",
  },
  senderBlock: {
    position: "absolute",
    alignItems: "flex-end",
  },
  author: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
  },
  collection: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
  },
  letterTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.30)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  letterTypeBadgeText: {
    fontFamily: ReaderTokens.fontFamily.sansBold,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  dateText: {
    position: "absolute",
    fontFamily: ReaderTokens.fontFamily.sans,
    letterSpacing: 0.1,
  },
});