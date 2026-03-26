import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import { Colors } from "../../constants/tokens";

interface ProgressIndicatorProps {
  type: "spinner" | "linear" | "circular";
  progress?: number;
  size?: "small" | "medium" | "large";
  color?: string;
}

const SIZE_MAP = { small: 20, medium: 32, large: 48 };
const TRACK_HEIGHT = { small: 2, medium: 3, large: 4 };

export default function ProgressIndicator({
  type,
  progress,
  size = "medium",
  color = Colors.zinc900,
}: ProgressIndicatorProps) {
  if (type === "spinner") return <Spinner size={SIZE_MAP[size]} color={color} />;
  if (type === "linear") return <LinearBar progress={progress} height={TRACK_HEIGHT[size]} color={color} />;
  if (type === "circular") return <CircularProgress progress={progress} size={SIZE_MAP[size]} color={color} />;
  return null;
}

function Spinner({ size, color }: { size: number; color: string }) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          borderTopColor: "transparent",
          transform: [{ rotate }],
        },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="로딩 중"
    />
  );
}

function LinearBar({
  progress,
  height,
  color,
}: {
  progress?: number;
  height: number;
  color: string;
}) {
  const animWidth = useRef(new Animated.Value(0)).current;
  const indeterminate = useRef(new Animated.Value(0)).current;
  const isIndeterminate = progress == null;

  useEffect(() => {
    if (isIndeterminate) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(indeterminate, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(indeterminate, { toValue: 0, duration: 1000, useNativeDriver: false }),
        ]),
      ).start();
    } else {
      Animated.timing(animWidth, {
        toValue: Math.min(1, Math.max(0, progress)),
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [progress, isIndeterminate]);

  const width = isIndeterminate
    ? indeterminate.interpolate({ inputRange: [0, 1], outputRange: ["20%", "80%"] })
    : animWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  const left = isIndeterminate
    ? indeterminate.interpolate({ inputRange: [0, 1], outputRange: ["0%", "20%"] })
    : "0%";

  return (
    <View
      style={[styles.linearTrack, { height, borderRadius: height / 2 }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: progress != null ? Math.round(progress * 100) : undefined }}
    >
      <Animated.View
        style={[
          styles.linearFill,
          { backgroundColor: color, height, borderRadius: height / 2, width, left },
        ]}
      />
    </View>
  );
}

function CircularProgress({
  progress,
  size,
  color,
}: {
  progress?: number;
  size: number;
  color: string;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const isIndeterminate = progress == null;

  useEffect(() => {
    if (isIndeterminate) {
      Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    }
  }, [isIndeterminate]);

  const strokeWidth = Math.max(2, size / 10);
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: Colors.zinc200,
          borderTopColor: color,
          transform: isIndeterminate ? [{ rotate }] : [],
        },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={progress != null ? `${Math.round(progress * 100)}%` : "로딩 중"}
    />
  );
}

const styles = StyleSheet.create({
  spinner: {
    borderWidth: 2.5,
  },
  linearTrack: {
    width: "100%",
    backgroundColor: Colors.zinc200,
    overflow: "hidden",
  },
  linearFill: {
    position: "absolute",
  },
});
