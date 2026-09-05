import React from "react";
import { StyleSheet, View } from "react-native";
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

const CANONICAL_RADIUS_RATIO = 16 / Sizing.cardSlotW;

/**
 * Keeps an ArticleCardItem at the same canonical size used by the selection
 * overlay, then projects that complete card into a smaller visual slot.
 *
 * The outer view owns layout, the final corner radius, and clipping — it
 * never relies on the scaled-down inner content's own corners lining up
 * exactly with its edges, since a transform can leave a hairline sliver of
 * whatever sits behind the slot visible at the corners. The inner view owns
 * the canonical card dimensions, so ArticleCardItem never recalculates
 * typography, padding, radius, or shadow from a small cardWidth.
 */
const CanonicalCardSlot = React.forwardRef<View, CanonicalCardSlotProps>(
  ({ width, height, children, borderRadius }, ref) => {
    const scale = width / Sizing.cardSlotW;
    const canonicalHeight = Sizing.cardH;
    const resolvedRadius =
      borderRadius ?? Math.max(8, Math.round(width * CANONICAL_RADIUS_RATIO));

    return (
      <View
        ref={ref}
        style={[styles.outer, { width, height, borderRadius: resolvedRadius }]}
      >
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
          {children}
        </View>
      </View>
    );
  },
);

CanonicalCardSlot.displayName = "CanonicalCardSlot";

export default CanonicalCardSlot;

const styles = StyleSheet.create({
  outer: {
    overflow: "hidden",
  },
  inner: {
    position: "absolute",
  },
});