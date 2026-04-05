import React, { useRef, useImperativeHandle, forwardRef } from "react";
import {
  Animated,
  PanResponder,
  View,
  StyleSheet,
  Text,
  Pressable,
} from "react-native";

const DELETE_BUTTON_WIDTH = 80;
const SWIPE_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 0.5;

export interface SwipeableRowHandle {
  close: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  onDeletePress: () => void;
  onSwipeOpen?: () => void;
}

const SwipeableRow = forwardRef<SwipeableRowHandle, SwipeableRowProps>(
  ({ children, onDeletePress, onSwipeOpen }, ref) => {
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
          const base = isOpen.current ? -DELETE_BUTTON_WIDTH : 0;
          const next = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH, base + dx));
          translateX.setValue(next);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dx, vx } = gestureState;
          const base = isOpen.current ? -DELETE_BUTTON_WIDTH : 0;
          const newPos = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH, base + dx));

          if (isOpen.current) {
            const shouldClose =
              newPos > -DELETE_BUTTON_WIDTH + SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
            if (shouldClose) {
              animateTo(0);
              isOpen.current = false;
            } else {
              animateTo(-DELETE_BUTTON_WIDTH);
            }
          } else {
            const shouldOpen =
              newPos < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
            if (shouldOpen) {
              animateTo(-DELETE_BUTTON_WIDTH);
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
        <View style={[styles.deleteButtonContainer, { width: DELETE_BUTTON_WIDTH }]}>
          <Pressable style={styles.deleteButton} onPress={onDeletePress}>
            <Text style={styles.deleteButtonText}>삭제</Text>
          </Pressable>
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
  deleteButtonContainer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButton: {
    flex: 1,
    width: "100%",
    backgroundColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  rowContent: {
    backgroundColor: "#FFFFFF",
  },
});
