import React from "react";
import { StyleSheet, View } from "react-native";
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { Sizing } from "@/constants/tokens";

interface CanonicalCardSlotProps {
  /** The visual slot size in the surrounding list or carousel. */
  width: number;
  height: number;
  children: React.ReactNode;
  /**
   * Corner radius for the outer clip mask, in on-screen pixels at this
   * slot's final `width`/`height`. Defaults to the same radius-to-width
   * ratio ArticleCardItem uses for its own canonical-size corner
   * (16 / Sizing.cardSlotW), which reproduces this component's previous
   * look for callers that don't override it.
   *
   * Pass an explicit value when this slot sits beside sibling cards that use
   * a different (usually larger) radius-to-width ratio — e.g. placeholder
   * cards in a carousel — so the scaled-down cover's corners visually match
   * them instead of looking flatter.
   */
  borderRadius?: number;
}

/**
 * Exported so callers that render sibling placeholder cards outside
 * `CanonicalCardSlot` (which cannot use its `borderRadius` default directly)
 * can compute the identical proportional radius for their own slot width and
 * stay visually matched, instead of hardcoding an independent ratio/literal.
 */
export const CANONICAL_RADIUS_RATIO = 16 / Sizing.cardSlotW;

/**
 * Keeps an ArticleCardItem at the same canonical size used by the selection
 * overlay, then projects that complete card into a smaller visual slot.
 *
 * The outer view owns layout and press scale without clipping. A same-sized
 * inner clip owns the final corner radius and clips only the projected card
 * content. The canonical projection therefore never recalculates typography,
 * padding, or radius from a small cardWidth.
 *
 * This module (this slot, `ArticleCardItem`, and `CardSelectOverlay`) always
 * renders a flat, shadow-free surface, at rest and inside the selection
 * overlay alike — do not add a shadow style here or pass one down to the
 * projected card.
 *
 * The single ArticleCardItem child is expected to expose a `pressScale`
 * prop (all current usages satisfy this). This component creates that
 * shared value, hands it to the child so ScalePressable's press-in/out
 * animation writes into it instead of transforming the child's own subtree,
 * and applies the same value as a transform on this OUTER view. Because the
 * nested clip and content are in the same transformed node tree, they always
 * shrink together at the same ratio and around the same center.
 */
const CanonicalCardSlot = React.forwardRef<View, CanonicalCardSlotProps>(
  ({ width, height, children, borderRadius }, ref) => {
    const scale = width / Sizing.cardSlotW;
    const canonicalHeight = Sizing.cardH;
    const resolvedRadius =
      borderRadius ?? Math.max(8, Math.round(width * CANONICAL_RADIUS_RATIO));

    const pressScale = useSharedValue(1);
    const animatedOuterStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pressScale.value }],
    }));

    const content = React.isValidElement(children)
      ? React.cloneElement(
          children as React.ReactElement<{
            pressScale?: SharedValue<number>;
          }>,
          { pressScale },
        )
      : children;

    return (
      <RAnimated.View
        ref={ref}
        style={[
          styles.outer,
          { width, height, borderRadius: resolvedRadius },
          animatedOuterStyle,
        ]}
      >
        <View style={[styles.clip, { borderRadius: resolvedRadius }]}>
          <View
            style={[
              styles.inner,
              {
                left: (width - Sizing.cardSlotW) / 2,
                top: (height - canonicalHeight) / 2,
                width: Sizing.cardSlotW,
                height: canonicalHeight,
                transform: [{ scale }],
              },
            ]}
          >
            {content}
          </View>
        </View>
      </RAnimated.View>
    );
  },
);

CanonicalCardSlot.displayName = "CanonicalCardSlot";

export default CanonicalCardSlot;

const styles = StyleSheet.create({
  outer: {
    overflow: "visible",
  },
  clip: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
  inner: {
    position: "absolute",
  },
});
