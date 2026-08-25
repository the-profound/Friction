import React from "react";
import { StyleSheet, View } from "react-native";
import { Sizing } from "@/constants/tokens";

interface CanonicalCardSlotProps {
  /** The visual slot size in the surrounding list or carousel. */
  width: number;
  height: number;
  children: React.ReactNode;
}

/**
 * Keeps an ArticleCardItem at the same canonical size used by the selection
 * overlay, then projects that complete card into a smaller visual slot.
 *
 * The outer view owns layout and clipping. The inner view owns the canonical
 * card dimensions, so ArticleCardItem never recalculates typography, padding,
 * radius, or shadow from a small cardWidth.
 */
const CanonicalCardSlot = React.forwardRef<View, CanonicalCardSlotProps>(
  ({ width, height, children }, ref) => {
    const scale = width / Sizing.cardSlotW;
    const canonicalHeight = Sizing.cardH;

    return (
      <View ref={ref} style={[styles.outer, { width, height }]}>
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