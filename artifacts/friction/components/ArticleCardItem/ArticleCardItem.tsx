import React from "react";
import {
  View,
  StyleSheet,
  Animated,
  Platform,
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
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
  cardWidth?: number;
  letterTypeBadge?: string | null;
  date?: string | null;
  /** Limits shadow strength when the card sits inside a clipped date carousel. */
  carouselShadow?: boolean;
  /** Lets a transition render the shadow separately from the card content. */
  hideShadow?: boolean;
}
const DEFAULT_BG = Colors.zinc50;
type CardShadowOpacity =
  | number
  | Animated.Value
  | Animated.AnimatedInterpolation<number>;

interface ArticleCardShadowProps {
  width: number;
  height: number;
  borderRadius: number;
  carouselShadow?: boolean;
  opacity?: CardShadowOpacity;
}

/**
 * The shadow is intentionally an empty sibling of the card content. This keeps
 * scaled card text crisp and lets selection transitions cross-fade only the
 * shadow treatment without changing the card's content, corners, or press
 * behavior.
 */
export function ArticleCardShadow({
  width,
  height,
  borderRadius,
  carouselShadow = false,
  opacity,
}: ArticleCardShadowProps) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.cardShadowHost,
        carouselShadow ? styles.carouselShadow : undefined,
        { width, height, borderRadius },
        opacity === undefined ? undefined : { opacity },
      ]}
    />
  );
}

function ArticleCardItem({
  title,
  authorName,
  collectionName,
  onPress,
  onLongPress,
  cover,
  isRead = false,
  isActive = true,
  cardWidth,
  letterTypeBadge,
  date,
  carouselShadow = false,
  hideShadow = false,
}: ArticleCardItemProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  const scale = w / CARD_W;

  const borderRadius = Math.max(8, Math.round(16 * scale));
  // Android elevation controls sibling paint order. Keep it on the containing
  // card surface so an empty shadow sibling can never cover the card content.
  const useAndroidSurfaceShadow = Platform.OS === "android" && !hideShadow;

  return (
    <View
      style={[
        styles.cardFrame,
        useAndroidSurfaceShadow
          ? carouselShadow
            ? styles.androidCarouselSurface
            : styles.androidCardSurface
          : undefined,
        { width: w, height: h, borderRadius },
        !isActive && styles.inactive,
        isRead && styles.read,
      ]}
    >
      {!hideShadow && Platform.OS !== "android" ? (
        <ArticleCardShadow
          width={w}
          height={h}
          borderRadius={borderRadius}
          carouselShadow={carouselShadow}
        />
      ) : null}
      <ScalePressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={{ width: w, height: h }}
        animatedBorderRadius={borderRadius}
      >
        <ArticleCardCover
          cover={cover}
          title={title}
          authorName={authorName}
          collectionName={collectionName}
          letterTypeBadge={letterTypeBadge}
          date={date}
          width={w}
          height={h}
          borderRadius={borderRadius}
        />
      </ScalePressable>

    </View>
  );
}

export default React.memo(ArticleCardItem);

const CARD_W = Sizing.cardSlotW;
const styles = StyleSheet.create({
  cardFrame: {
    position: "relative",
  },
  // On Android this is the containing elevated surface, not a sibling. An
  // elevated sibling is painted above the non-elevated card pressable.
  androidCardSurface: {
    backgroundColor: DEFAULT_BG,
    ...Shadows.card,
  },
  androidCarouselSurface: {
    backgroundColor: DEFAULT_BG,
    ...Shadows.carouselCard,
  },
  cardShadowHost: {
    ...StyleSheet.absoluteFill,
    backgroundColor: DEFAULT_BG,
    ...Shadows.card,
  },
  carouselShadow: {
    ...Shadows.carouselCard,
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
  },
  read: {
    opacity: 0.45,
  },
});
