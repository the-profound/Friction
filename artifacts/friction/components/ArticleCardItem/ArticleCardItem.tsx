import React from "react";
import {
  StyleSheet,
  Animated,
  Platform,
  type ViewStyle,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import type { ArticleCover } from "@workspace/api-client-react";
import { Colors, Shadows, Sizing } from "../../constants/tokens";
import ArticleCardCover from "./ArticleCardCover";

interface ArticleCardItemProps {
  title: string;
  authorName?: string;
  collectionName?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
  cardWidth?: number;
  letterTypeBadge?: string | null;
  date?: string | null;
  /** When 'RECIPIENT_ONLY', the cover shows a 👥 badge. No badge for 'PUBLIC' or when omitted. */
  visibility?: string | null;
  /** Limits shadow strength when the card sits inside a clipped date carousel. */
  carouselShadow?: boolean;
  /**
   * Selection overlays use the same hero progress to blend a carousel card's
   * raised surface into the selected-card treatment and back on close.
   */
  shadowProgress?: Animated.Value | Animated.AnimatedInterpolation<number>;
  /** Called after the image, or its explicit fallback, is visibly rendered. */
  onImageReady?: () => void;
}

const DEFAULT_BG = Colors.zinc50;

function getCardSurfaceShadowStyle(
  carouselShadow: boolean,
  shadowProgress?: Animated.Value | Animated.AnimatedInterpolation<number>,
): ViewStyle {
  if (!carouselShadow) return styles.standardCardSurface;
  if (!shadowProgress) return styles.carouselCardSurface;

  const interpolateNumber = (outputRange: number[]) =>
    shadowProgress.interpolate({
      inputRange: [0, 1],
      outputRange,
    });
  const interpolateString = (outputRange: string[]) =>
    shadowProgress.interpolate({
      inputRange: [0, 1],
      outputRange,
    });

  // The card surface itself owns the interpolation. Avoid an opaque shadow
  // sibling: it can show up as a same-sized white card while the cover moves.
  if (Platform.OS === "ios") {
    return {
      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: interpolateNumber([2, 4]) as unknown as number,
      },
      shadowOpacity: interpolateNumber([0.1, 0.12]) as unknown as number,
      shadowRadius: interpolateNumber([6, 12]) as unknown as number,
    };
  }

  if (Platform.OS === "android") {
    return {
      elevation: interpolateNumber([3, 5]) as unknown as number,
    };
  }

  if (Platform.OS === "web") {
    return {
      boxShadow: interpolateString([
        "0px 2px 8px rgba(0,0,0,0.10)",
        "0px 4px 14px rgba(0,0,0,0.12)",
      ]) as unknown as string,
    } as ViewStyle;
  }

  return styles.standardCardSurface;
}

function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  onLongPress,
  disabled = false,
  cover,
  isRead = false,
  isActive = true,
  cardWidth,
  letterTypeBadge,
  date,
  visibility,
  carouselShadow = false,
  shadowProgress,
  onImageReady,
}: ArticleCardItemProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  const scale = w / CARD_W;
  const borderRadius = Math.max(8, Math.round(16 * scale));

  return (
    <ScalePressable
      style={[
        styles.cardFrame,
        { width: w, height: h, borderRadius },
        !isActive && styles.inactive,
        isRead && styles.read,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
    >
      <Animated.View
        style={[
          styles.cardSurface,
          getCardSurfaceShadowStyle(carouselShadow, shadowProgress),
          { width: w, height: h, borderRadius },
        ]}
      >
        <ArticleCardCover
          cover={cover}
          title={title}
          authorName={authorName}
          collectionName={collectionName}
          letterTypeBadge={letterTypeBadge}
          date={date}
          visibility={visibility}
          width={w}
          height={h}
          borderRadius={borderRadius}
          onImageLoad={onImageReady}
        />
      </Animated.View>
    </ScalePressable>
  );
}

export default React.memo(ArticleCardItem);

const CARD_W = Sizing.cardSlotW;

const styles = StyleSheet.create({
  cardFrame: {
    position: "relative",
  },
  cardSurface: {
    position: "relative",
    overflow: "visible",
    // The raised surface is the card itself. Never put an opaque, same-sized
    // shadow plate behind this cover: a transform or image handoff can expose
    // it as a white duplicate card.
    backgroundColor: DEFAULT_BG,
  },
  standardCardSurface: {
    ...Shadows.card,
  },
  carouselCardSurface: {
    ...Shadows.carouselCard,
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
  },
  read: {
    opacity: 0.45,
  },
});