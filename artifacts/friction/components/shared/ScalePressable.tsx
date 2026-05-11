import React from "react";
import { Pressable, StyleSheet, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";
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

export default function ScalePressable({
  scaleTo = 0.95,
  onPressIn,
  onPressOut,
  style,
  contentStyle,
  children,
  ...rest
}: ScalePressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (
    e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0],
  ) => {
    scale.value = withTiming(scaleTo, { duration: PRESS_DURATION, easing: EASING });
    onPressIn?.(e);
  };

  const handlePressOut = (
    e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0],
  ) => {
    scale.value = withTiming(1, { duration: RELEASE_DURATION, easing: EASING });
    onPressOut?.(e);
  };

  return (
    <Pressable
      style={style}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
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
