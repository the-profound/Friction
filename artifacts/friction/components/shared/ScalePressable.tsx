import React from "react";
import { Pressable, type PressableProps } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ScalePressableProps extends PressableProps {
  scaleTo?: number;
}

const PRESS_DURATION = 80;
const RELEASE_DURATION = 80;
const EASING = Easing.inOut(Easing.ease);

export default function ScalePressable({
  scaleTo = 0.95,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: ScalePressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) => {
    scale.value = withTiming(scaleTo, { duration: PRESS_DURATION, easing: EASING });
    onPressIn?.(e);
  };

  const handlePressOut = (e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) => {
    scale.value = withTiming(1, { duration: RELEASE_DURATION, easing: EASING });
    onPressOut?.(e);
  };

  const composedStyle =
    typeof style === "function"
      ? (state: { pressed: boolean }) => [style(state), animatedStyle]
      : [style, animatedStyle];

  return (
    <AnimatedPressable
      style={composedStyle}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    />
  );
}
