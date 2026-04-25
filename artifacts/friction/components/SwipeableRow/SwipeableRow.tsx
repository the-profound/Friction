import React, { useRef, useImperativeHandle, forwardRef } from "react";
import {
  Animated,
  PanResponder,
  View,
  StyleSheet,
  Text,
  Pressable,
} from "react-native";

const BUTTON_WIDTH = 80;
const SWIPE_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 0.5;

export interface SwipeableRowHandle {
  close: () => void;
}

export interface SwipeAction {
  label: string;
  color: string;
  onPress: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  onDeletePress?: () => void;
  actions?: SwipeAction[];
  onSwipeOpen?: () => void;
}

const SwipeableRow = forwardRef<SwipeableRowHandle, SwipeableRowProps>(
  ({ children, onDeletePress, actions, onSwipeOpen }, ref) => {
    const resolvedActions: SwipeAction[] = actions
      ? actions
      : onDeletePress
        ? [{ label: "삭제", color: "#EF4444", onPress: onDeletePress }]
        : [];

    const totalWidth = BUTTON_WIDTH * resolvedActions.length;

    const translateX = useRef(new Animated.Value(0)).current;
    const isOpen = useRef(false);

    useImperativeHandle(ref, () => ({
      close: () => {
        animateTo(0);
        isOpen.current = false;
      },
    }));

    function animateTo(toValue: number) {
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 20,
      }).start();
    }

    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5;
        },
        onPanResponderMove: (_, gestureState) => {
          const { dx } = gestureState;
          const base = isOpen.current ? -totalWidth : 0;
          const next = Math.min(0, Math.max(-totalWidth, base + dx));
          translateX.setValue(next);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dx, vx } = gestureState;
          const base = isOpen.current ? -totalWidth : 0;
          const newPos = Math.min(0, Math.max(-totalWidth, base + dx));

          if (isOpen.current) {
            const shouldClose =
              newPos > -totalWidth + SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
            if (shouldClose) {
              animateTo(0);
              isOpen.current = false;
            } else {
              animateTo(-totalWidth);
            }
          } else {
            const shouldOpen =
              newPos < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
            if (shouldOpen) {
              animateTo(-totalWidth);
              isOpen.current = true;
              onSwipeOpen?.();
            } else {
              animateTo(0);
            }
          }
        },
      })
    ).current;

    return (
      <View style={styles.container}>
        <View style={[styles.actionsContainer, { width: totalWidth }]}>
          {resolvedActions.map((action, index) => (
            <Pressable
              key={index}
              style={[styles.actionButton, { backgroundColor: action.color, width: BUTTON_WIDTH }]}
              onPress={action.onPress}
            >
              <Text style={styles.actionButtonText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
        <Animated.View
          style={[styles.rowContent, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          {children}
        </Animated.View>
      </View>
    );
  }
);

SwipeableRow.displayName = "SwipeableRow";

export default SwipeableRow;

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    position: "relative",
  },
  actionsContainer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  actionButton: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  rowContent: {
    backgroundColor: "#FFFFFF",
  },
});
