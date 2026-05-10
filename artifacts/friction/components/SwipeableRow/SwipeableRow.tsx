import React, { useRef, useImperativeHandle, forwardRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  PanResponder,
  View,
  StyleSheet,
  Text,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";

const BUTTON_WIDTH = 80;
const SWIPE_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 0.3;
const SNAP_DURATION = 220;

const USE_NATIVE_DRIVER = Platform.OS !== "web";

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
  onScrollLock?: (locked: boolean) => void;
}

const SwipeableRow = forwardRef<SwipeableRowHandle, SwipeableRowProps>(
  ({ children, onDeletePress, actions, onSwipeOpen, onScrollLock }, ref) => {
    const resolvedActions: SwipeAction[] = actions
      ? actions
      : onDeletePress
        ? [{ label: "삭제", color: "#EF4444", onPress: onDeletePress }]
        : [];

    const totalWidth = BUTTON_WIDTH * resolvedActions.length;

    const translateX = useRef(new Animated.Value(0)).current;
    const isOpen = useRef(false);
    const currentAnim = useRef<Animated.CompositeAnimation | null>(null);
    const onScrollLockRef = useRef(onScrollLock);
    onScrollLockRef.current = onScrollLock;
    const onSwipeOpenRef = useRef(onSwipeOpen);
    onSwipeOpenRef.current = onSwipeOpen;

    useImperativeHandle(ref, () => ({
      close: () => {
        animateTo(0);
        isOpen.current = false;
      },
    }));

    function animateTo(toValue: number) {
      if (currentAnim.current) {
        currentAnim.current.stop();
      }
      const anim = Animated.timing(translateX, {
        toValue,
        duration: SNAP_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER,
      });
      currentAnim.current = anim;
      anim.start(() => {
        currentAnim.current = null;
      });
    }

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => isOpen.current,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          return Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 6;
        },
        onPanResponderGrant: () => {
          if (currentAnim.current) {
            currentAnim.current.stop();
            currentAnim.current = null;
          }
          onScrollLockRef.current?.(true);
        },
        onPanResponderMove: (_, gestureState) => {
          const { dx } = gestureState;
          const base = isOpen.current ? -totalWidth : 0;
          const raw = base + dx;
          const clamped = Math.min(0, Math.max(-totalWidth, raw));
          translateX.setValue(clamped);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dx, dy, vx } = gestureState;
          const base = isOpen.current ? -totalWidth : 0;
          const newPos = Math.min(0, Math.max(-totalWidth, base + dx));
          onScrollLockRef.current?.(false);

          if (isOpen.current) {
            const isTap = Math.abs(dx) < 5 && Math.abs(dy) < 5;
            const shouldClose = isTap || newPos > -totalWidth + SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
            if (shouldClose) {
              animateTo(0);
              isOpen.current = false;
            } else {
              animateTo(-totalWidth);
            }
          } else {
            const shouldOpen = newPos < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
            if (shouldOpen) {
              animateTo(-totalWidth);
              isOpen.current = true;
              onSwipeOpenRef.current?.();
            } else {
              animateTo(0);
            }
          }
        },
        onPanResponderTerminate: () => {
          onScrollLockRef.current?.(false);
          animateTo(isOpen.current ? -totalWidth : 0);
        },
      })
    ).current;

    if (resolvedActions.length === 0) {
      return <View>{children}</View>;
    }

    return (
      <View style={styles.container}>
        <View style={[styles.actionsContainer, { width: totalWidth }]}>
          {resolvedActions.map((action, index) => (
            <ScalePressable
              key={index}
              style={[styles.actionButton, { width: BUTTON_WIDTH }]}
              onPress={action.onPress}
            >
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: action.color }]} />
              <Text style={styles.actionButtonText}>{action.label}</Text>
            </ScalePressable>
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
    width: "100%",
  },
});
