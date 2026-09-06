import React from "react";
import {
  StyleSheet,
  Platform,
  type ViewStyle,
} from "react-native";
import RAnimated, {
  useAnimatedStyle,
  interpolate,
  type SharedValue,
} from "react-native-reanimated";
import ScalePressable from "@/components/shared/ScalePressable";
import type { ArticleCover } from "@workspace/api-client-react";
import { Colors, Shadows, Sizing } from "../../constants/tokens";
import ArticleCardCover from "./ArticleCardCover";

interface ArticleCardItemProps {
  title: string;
  authorName?: string;
  collectionName?: string | null;
  /**
   * Space name shown on the card cover's collection/space line.
   * When both `spaceName` and `collectionName` are provided, `spaceName`
   * takes priority and `collectionName` appears as a secondary line.
   * When only one is set, that one is shown.
   */
  spaceName?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  cover?: ArticleCover | null;
  isRead?: boolean;
  isActive?: boolean;
  cardWidth?: number;
  /** Optional radius override for compact previews that render at native size. */
  cardRadius?: number;
  letterTypeBadge?: string | null;
  date?: string | null;
  /**
   * No longer rendered as a badge on the cover (removed from all small/list
   * card covers). Kept only so existing callers don't need to change.
   */
  visibility?: string | null;
  /** Limits shadow strength when the card sits inside a clipped date carousel. */
  carouselShadow?: boolean;
  /** Removes the card surface shadow entirely, e.g. for compact previews stacked inside another shadowed container. */
  noShadow?: boolean;
  /**
   * Selection overlays use the same hero progress (Reanimated shared value,
   * UI thread) to blend a carousel card's raised surface into the
   * selected-card treatment and back on close.
   */
  shadowProgress?: SharedValue<number>;
  /** Called after the image, or its explicit fallback, is visibly rendered. */
  onImageReady?: () => void;
}

const DEFAULT_BG = Colors.zinc50;

/**
 * Static base shadow style for the two non-interpolated cases. When
 * `shadowProgress` is provided, the per-frame interpolated values are layered
 * on top via `useAnimatedCardSurfaceShadowStyle` below (UI thread).
 */
function getStaticCardSurfaceShadowStyle(
  carouselShadow: boolean,
  hasShadowProgress: boolean,
): ViewStyle | undefined {
  if (!carouselShadow) return styles.standardCardSurface;
  if (!hasShadowProgress) return styles.carouselCardSurface;
  return undefined;
}
function ArticleCardItem({
  title,
  authorName,
  collectionName,
  spaceName,
  onPress,
  onLongPress,
  disabled = false,
  cover,
  isRead = false,
  isActive = true,
  cardWidth,
  cardRadius,
  letterTypeBadge,
  date,
  visibility,
  carouselShadow = false,
  shadowProgress,
  noShadow = false,
  onImageReady,
}: ArticleCardItemProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  const scale = w / CARD_W;
  const borderRadius = cardRadius ?? Math.max(8, Math.round(16 * scale));
  const staticShadowStyle = getStaticCardSurfaceShadowStyle(
    carouselShadow,
    !!shadowProgress,
  );
  const animatedShadowStyle = useAnimatedCardSurfaceShadowStyle(
    carouselShadow,
    shadowProgress,
  );

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
      <RAnimated.View
        style={[
          styles.cardSurface,
          !noShadow && staticShadowStyle,
          !noShadow && animatedShadowStyle,
          { width: w, height: h, borderRadius },
        ]}
      >
        <ArticleCardCover
          cover={cover}
          title={title}
          authorName={authorName}
          collectionName={collectionName}
          spaceName={spaceName}
          letterTypeBadge={letterTypeBadge}
          date={date}
          visibility={visibility}
          width={w}
          height={h}
          borderRadius={borderRadius}
          onImageLoad={onImageReady}
        />
      </RAnimated.View>
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

/**
 * The card surface itself owns the interpolation. Avoid an opaque shadow
 * sibling: it can show up as a same-sized white card while the cover moves.
 * Runs entirely on the UI thread via Reanimated so the carousel-shadow
 * cross-fade never drops frames during the hero open/close transition.
 */
function useAnimatedCardSurfaceShadowStyle(
  carouselShadow: boolean,
  shadowProgress?: SharedValue<number>,
) {
  return useAnimatedStyle(() => {
    if (!carouselShadow || !shadowProgress) return {};

    if (Platform.OS === "ios") {
      return {
        shadowColor: "#000",
        shadowOffset: {
          width: 0,
          height: interpolate(shadowProgress.value, [0, 1], [2, 4]),
        },
        shadowOpacity: interpolate(shadowProgress.value, [0, 1], [0.1, 0.12]),
        shadowRadius: interpolate(shadowProgress.value, [0, 1], [6, 12]),
      };
    }

    if (Platform.OS === "android") {
      return {
        elevation: interpolate(shadowProgress.value, [0, 1], [3, 5]),
      };
    }

    if (Platform.OS === "web") {
      const offsetY = interpolate(shadowProgress.value, [0, 1], [2, 4]);
      const blur = interpolate(shadowProgress.value, [0, 1], [8, 14]);
      const alpha = interpolate(shadowProgress.value, [0, 1], [0.1, 0.12]);
      return {
        boxShadow: `0px ${offsetY}px ${blur}px rgba(0,0,0,${alpha})`,
      } as ViewStyle;
    }

    return {};
  });
}
