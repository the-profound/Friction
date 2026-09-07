import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
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

// expo-image's SDK typings currently use a React base type that conflicts with
// this app's React 19 JSX types. Keep shared cover surfaces on expo-image while
// the project-wide type mismatch is addressed separately.
const CachedImage = Image as unknown as React.ComponentType<any>;

interface ArticleCardCoverProps {
  cover?: ArticleCover | null;
  title: string;
  authorName?: string;
  /** Card is the default; list uses a compact, fixed-height text treatment. */
  layout?: "card" | "list";
  collectionName?: string | null;
  /**
   * Space name for the card's collection/space line.
   * When set, spaceName is shown as the primary label; collectionName is shown
   * as a second line only when it differs from spaceName.
   */
  spaceName?: string | null;
  date?: string | null;
  letterTypeBadge?: string | null;
  /**
   * No longer rendered on the cover itself (the visibility badge was removed
   * from all small/list card covers). Kept only so callers that still pass
   * a visibility value (e.g. for the letter-selection overlay's separate
   * visibility-toggle button) don't need to change their call sites.
   */
  visibility?: string | null;
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
  layout = "card",
  collectionName,
  spaceName,
  date,
  letterTypeBadge,
  width,
  height,
  borderRadius = 16,
  onImageLoad,
}: ArticleCardCoverProps) {
  // Resolve which label to show on the collection/space line.
  // spaceName (where the letter lives in a Space) takes priority over
  // collectionName (personal folder). Callers that set only one field get that
  // label; callers that set both display spaceName first.
  const primaryLabel = spaceName ?? collectionName ?? null;
  const secondaryLabel =
    spaceName && collectionName && collectionName !== spaceName
      ? collectionName
      : null;
  const [measuredSize, setMeasuredSize] = useState({ width: 0, height: 0 });
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [displayedImageUrl, setDisplayedImageUrl] = useState<string | null>(null);
  const displayedImageFrameRef = useRef<number | null>(null);

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
  // Keep the native image request stable while an ancestor re-renders to hide
  // the source slot. expo-image can otherwise briefly clear its drawing
  // surface even though the URI and cache key have not changed.
  const imageSource = useMemo(
    () => (hasImage ? { uri: imageUrl, cacheKey: imageUrl } : null),
    [hasImage, imageUrl],
  );
  const presentation = getArticleCardCoverPresentation(
    cover,
    hasImage && displayedImageUrl === imageUrl,
    {
      neutralBackground: Colors.zinc50,
      readableText: Colors.zinc900,
    },
  );
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

  const isListLayout = layout === "list";
  const scale = resolvedWidth / Sizing.cardSlotW;
  const pad = isListLayout
    ? 16
    : Math.max(6, Math.round(24 * scale));
  const textFrameWidth = Math.max(1, resolvedWidth - pad * 2);
  const titleSize = isListLayout
    ? 18
    : Math.max(
        8,
        Math.round(
          readerFontSize(ReaderTokens.typeScale.cardTitleCqi, textFrameWidth),
        ),
      );
  const authorSize = isListLayout
    ? 14
    : Math.max(6, Math.round(AUTHOR_SIZE * scale));
  const collectionSize = isListLayout
    ? 12
    : Math.max(5, Math.round(COLLECTION_SIZE * scale));
  const senderBottom = getArticleCardSenderBottomOffset(
    pad,
    collectionSize * 1.3,
    isListLayout || !!primaryLabel,
  );

  const handleImageError = useCallback(() => {
    if (imageUrl) {
      setDisplayedImageUrl(null);
      setFailedImageUrl(imageUrl);
    }
  }, [imageUrl]);

  const handleImageDisplay = useCallback(() => {
    setDisplayedImageUrl(imageUrl ?? null);
    if (!onImageLoad) return;
    if (displayedImageFrameRef.current !== null) {
      cancelAnimationFrame(displayedImageFrameRef.current);
    }
    // `onDisplay` is delivered before native has necessarily composited the
    // image into the modal. Keep the source card visible through one committed
    // frame, then allow the parent to hide it and begin the hero transition.
    displayedImageFrameRef.current = requestAnimationFrame(() => {
      displayedImageFrameRef.current = null;
      onImageLoad();
    });
  }, [imageUrl, onImageLoad]);

  useEffect(() => {
    setFailedImageUrl(null);
    setDisplayedImageUrl(null);
  }, [imageUrl]);

  useEffect(
    () => () => {
      if (displayedImageFrameRef.current !== null) {
        cancelAnimationFrame(displayedImageFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!imageUrl || failedImageUrl !== imageUrl || !onImageLoad) return;
    // An error callback does not mean the fallback has appeared. Wait one
    // committed frame before an overlay is allowed to hide its source card.
    const frame = requestAnimationFrame(onImageLoad);
    return () => cancelAnimationFrame(frame);
  }, [failedImageUrl, imageUrl, onImageLoad]);

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
          // This view owns clipping its own corners. The cover image used to
          // rely solely on its own internal border-radius clip, which can
          // drift a hairline out of sync with this view's background/corner
          // rendering — most visible while a ScalePressable press-transform
          // is live. Clipping here guarantees the image, overlay, and
          // background all share the exact same rounded-rect boundary.
          overflow: "hidden",
        },
      ]}
      onLayout={handleLayout}
    >
      {hasImage ? (
        <CachedImage
          source={imageSource}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onDisplay={handleImageDisplay}
          onError={handleImageError}
        />
      ) : null}
      {presentation.isImageRendered ? (
        <View style={[styles.imageOverlay, { borderRadius }]} />
      ) : null}

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
          numberOfLines={isListLayout ? 2 : 4}
          allowFontScaling={!isListLayout}
        >
          {title}
        </Text>

        <View
          style={[
            styles.senderBlock,
            { bottom: senderBottom, right: pad, width: textFrameWidth },
          ]}
        >
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
              allowFontScaling={!isListLayout}
            >
              {authorName}
            </Text>
          ) : null}
          {primaryLabel ? (
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
              {primaryLabel}
            </Text>
          ) : null}
          {secondaryLabel ? (
            <Text
              style={[
                styles.collection,
                {
                  color: textColor,
                  fontFamily: boldFontFamily,
                  fontSize: Math.max(5, Math.round(collectionSize * 0.85)),
                  lineHeight: Math.max(5, Math.round(collectionSize * 0.85)) * 1.3,
                  opacity: 0.75,
                },
              ]}
              numberOfLines={1}
            >
              {secondaryLabel}
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