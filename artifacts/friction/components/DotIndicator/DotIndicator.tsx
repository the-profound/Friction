import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { Colors, Sizing, Animation } from "../../constants/tokens";

interface DotIndicatorProps {
  total: number;
  activeIndex: number;
}

const MAX_VISIBLE = Sizing.dotMaxVisible;

export default function DotIndicator({ total, activeIndex }: DotIndicatorProps) {
  const dots = useMemo(() => {
    if (total <= MAX_VISIBLE) {
      return Array.from({ length: total }, (_, i) => ({ index: i, type: getType(i, activeIndex, total, 0) }));
    }

    let windowStart = activeIndex - Math.floor(MAX_VISIBLE / 2);
    windowStart = Math.max(0, Math.min(windowStart, total - MAX_VISIBLE));

    return Array.from({ length: MAX_VISIBLE }, (_, i) => {
      const realIndex = windowStart + i;
      return { index: realIndex, type: getType(realIndex, activeIndex, total, windowStart) };
    });
  }, [total, activeIndex]);

  return (
    <View style={styles.container}>
      {total > 1 ? dots.map((dot) => (
        <View
          key={dot.index}
          style={[
            styles.dot,
            dot.type === "active"
              ? styles.activeDot
              : dot.type === "edge"
                ? styles.edgeDot
                : styles.inactiveDot,
          ]}
        />
      )) : null}
    </View>
  );
}

type DotType = "active" | "inactive" | "edge";

function getType(index: number, activeIndex: number, total: number, windowStart: number): DotType {
  if (index === activeIndex) return "active";
  if (total <= MAX_VISIBLE) return "inactive";
  if (index === windowStart && windowStart > 0) return "edge";
  if (index === windowStart + MAX_VISIBLE - 1 && windowStart + MAX_VISIBLE < total) return "edge";
  return "inactive";
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: Sizing.dotsH,
  },
  dot: {
    borderRadius: 999,
  },
  activeDot: {
    width: Sizing.dotActiveW,
    height: Sizing.dotActiveH,
    backgroundColor: Colors.dotActive,
    borderRadius: Sizing.dotActiveH / 2,
  },
  inactiveDot: {
    width: Sizing.dotInactiveW,
    height: Sizing.dotInactiveH,
    backgroundColor: Colors.dotInactive,
    borderRadius: Sizing.dotInactiveH / 2,
  },
  edgeDot: {
    width: Sizing.dotEdgeSize,
    height: Sizing.dotEdgeSize,
    backgroundColor: Colors.dotEdge,
    borderRadius: Sizing.dotEdgeSize / 2,
  },
});
