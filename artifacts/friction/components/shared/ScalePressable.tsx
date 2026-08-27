import React from "react";
import { Pressable, StyleSheet, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle, type LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

export interface ScalePressableProps extends PressableProps {
  scaleTo?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

const PRESS_DURATION = 80;
const RELEASE_DURATION = 80;
const EASING = Easing.inOut(Easing.ease);

/** Reference ratio: (1 – 0.95) / 2 = 2.5% per edge at the current default scale. */
const BASE_RATIO = 0.025;
/** Minimum perceptible edge movement in px. Below this the press feels invisible. */
const MIN_EDGE_PX = 2;
/** Maximum comfortable edge movement in px. Above this large cards feel crushed. */
const MAX_EDGE_PX = 5;
/** Absolute scale floor — even tiny elements should not compress beyond this. */
const SCALE_FLOOR = 0.9;
/** Fallback when size is not yet measured. */
const DEFAULT_SCALE = 0.95;

/**
 * Computes the target press scale for an element whose largest dimension is
 * `maxDimension` pixels, keeping the perceived edge movement in a comfortable
 * range (MIN_EDGE_PX … MAX_EDGE_PX) regardless of element size.
 *
 * Algorithm:
 *  1. Compute the raw edge movement at the reference ratio: size × BASE_RATIO.
 *  2. Clamp it to [MIN_EDGE_PX, MAX_EDGE_PX].
 *  3. Back-calculate the corresponding scale: 1 – (2 × edgePx) / size.
 *  4. Apply SCALE_FLOOR so the scale never goes below 0.90.
 *
 * Returns DEFAULT_SCALE when `maxDimension` is 0 (not yet measured).
 */
export function computeAdaptiveScale(maxDimension: number): number {
  if (maxDimension <= 0) return DEFAULT_SCALE;
  const rawEdge = maxDimension * BASE_RATIO;
  const edgePx = Math.max(MIN_EDGE_PX, Math.min(MAX_EDGE_PX, rawEdge));
  const scale = 1 - (2 * edgePx) / maxDimension;
  return Math.max(SCALE_FLOOR, scale);
}

export default function ScalePressable({
  scaleTo,
  onPressIn,
  onPressOut,
  onLayout,
  style,
  contentStyle,
  children,
  disabled = false,
  ...rest
}: ScalePressableProps) {
  const scale = useSharedValue(1);
  /**
   * Largest rendered dimension (width or height), stored as a shared value so
   * it can be read inside onPressIn without triggering a re-render.
   */
  const maxDimension = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    maxDimension.value = Math.max(width, height);
    onLayout?.(e);
  };

  const handlePressIn = (
    e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0],
  ) => {
    if (disabled) return;
    // Explicit scaleTo always wins; otherwise derive from the measured size so
    // the value is always fresh even after layout changes.
    const target =
      scaleTo !== undefined
        ? scaleTo
        : computeAdaptiveScale(maxDimension.value);
    scale.value = withTiming(target, { duration: PRESS_DURATION, easing: EASING });
    onPressIn?.(e);
  };

  const handlePressOut = (
    e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0],
  ) => {
    if (disabled) return;
    scale.value = withTiming(1, { duration: RELEASE_DURATION, easing: EASING });
    onPressOut?.(e);
  };

  return (
    <Pressable
      style={style}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      onLayout={handleLayout}
      disabled={disabled}
      {...rest}
    >
      {(state: PressableStateCallbackType) => (
        <Animated.View style={[styles.inner, contentStyle, animatedStyle]}>
          {typeof children === "function" ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  inner: {
    flexShrink: 0,
    flexGrow: 1,
    alignSelf: "stretch",
    overflow: "visible",
  },
});
