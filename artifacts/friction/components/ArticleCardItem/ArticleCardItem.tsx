import React from "react";
import { StyleSheet } from "react-native";
import RAnimated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import ScalePressable from "@/components/shared/ScalePressable";
import type { ArticleCover } from "@workspace/api-client-react";
import { Colors, Sizing } from "../../constants/tokens";
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
  /** Called after the image, or its explicit fallback, is visibly rendered. */
  onImageReady?: () => void;
  /**
   * Supplied by CanonicalCardSlot when this card is rendered inside it. The
   * slot's own outer clip box (which owns the final radius) reads this same
   * shared value and scales itself as a unit, so ScalePressable's press
   * animation must write into it instead of applying its own transform here
   * — otherwise the clip boundary and the card content shrink at different
   * times/ratios and a corner gap opens up during the press animation.
   */
  pressScale?: SharedValue<number>;
  /**
   * Selection overlays use this (UI thread, per-frame) to converge the hero
   * card's own radius onto a destination slot's fixed resting radius by the
   * end of the close animation, when that slot pins a radius that diverges
   * from the natural canonical-scaled ratio. Overrides `cardRadius`/the
   * natural default on the card surface and its cover. Omit for the
   * unchanged static radius.
   */
  radiusOverride?: SharedValue<number>;
}

const DEFAULT_BG = Colors.zinc50;

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
  onImageReady,
  pressScale,
  radiusOverride,
}: ArticleCardItemProps) {
  const w = cardWidth ?? CARD_W;
  const h = w * Sizing.cardRatio;
  const scale = w / CARD_W;
  const borderRadius = cardRadius ?? Math.max(8, Math.round(16 * scale));
  const animatedRadiusStyle = useAnimatedRadiusOverrideStyle(radiusOverride);

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
      externalScale={pressScale}
      applyScaleStyle={!pressScale}
    >
      <RAnimated.View
        style={[
          styles.cardSurface,
          { width: w, height: h, borderRadius },
          animatedRadiusStyle,
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
          radiusOverride={radiusOverride}
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
    // it as a white duplicate card. This module renders a flat surface with
    // no shadow in any state (resting slot or selection overlay) — do not
    // reintroduce a shadow style here or on any wrapping slot/overlay.
    backgroundColor: DEFAULT_BG,
  },
  inactive: {
    opacity: Colors.cardInactiveOpacity,
  },
  read: {
    opacity: 0.45,
  },
});

/**
 * Runs on the UI thread so the radius the selection overlay computes per
 * frame (see `CardSelectOverlay`'s `cardRadiusOverride`) is applied without a
 * JS-thread round trip. Returns an empty style when no override is supplied,
 * leaving the static `borderRadius` set alongside it in the style array
 * untouched.
 */
function useAnimatedRadiusOverrideStyle(radiusOverride?: SharedValue<number>) {
  return useAnimatedStyle(() => {
    if (!radiusOverride) return {};
    return { borderRadius: radiusOverride.value };
  });
}
