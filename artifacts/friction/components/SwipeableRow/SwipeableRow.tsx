import React, { useRef, useImperativeHandle, forwardRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  PanResponder,
  Pressable,
  View,
  StyleSheet,
  Text,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Shadows } from "@/constants/tokens";

const BUTTON_WIDTH = 80;
const ACTION_GAP = 8;
const ACTION_RADIUS = 16;
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
  disabled?: boolean;
  busy?: boolean;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  onDeletePress?: () => void;
  actions?: SwipeAction[];
  onSwipeOpen?: () => void;
  onScrollLock?: (locked: boolean) => void;
  overflowTop?: number;
  actionRightInset?: number;
  actionBottomInset?: number;
}

const SwipeableRow = forwardRef<SwipeableRowHandle, SwipeableRowProps>(
  ({
    children,
    onDeletePress,
    actions,
    onSwipeOpen,
    onScrollLock,
    overflowTop = 0,
    actionRightInset = 0,
    actionBottomInset = 0,
  }, ref) => {
    const resolvedActions: SwipeAction[] = actions
      ? actions
      : onDeletePress
        ? [{ label: "삭제", color: Colors.primaryAction, onPress: onDeletePress }]
        : [];

    const totalWidth = BUTTON_WIDTH * resolvedActions.length
      + ACTION_GAP * Math.max(0, resolvedActions.length - 1);
    const revealWidth = totalWidth + actionRightInset;

    const translateX = useRef(new Animated.Value(0)).current;
    const isOpen = useRef(false);
    const [open, setOpen] = useState(false);
    const currentAnim = useRef<Animated.CompositeAnimation | null>(null);
    const onScrollLockRef = useRef(onScrollLock);
    onScrollLockRef.current = onScrollLock;
    const onSwipeOpenRef = useRef(onSwipeOpen);
    onSwipeOpenRef.current = onSwipeOpen;

    useImperativeHandle(ref, () => ({
      close: () => {
        animateTo(0);
        isOpen.current = false;
        setOpen(false);
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
        // Never claim on touch-down: an open row must still allow a vertical
        // drag to reach its FlatList. Horizontal intent is claimed on move.
        onStartShouldSetPanResponder: () => false,
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
          const base = isOpen.current ? -revealWidth : 0;
          const raw = base + dx;
          const clamped = Math.min(0, Math.max(-revealWidth, raw));
          translateX.setValue(clamped);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dx, dy, vx } = gestureState;
          const base = isOpen.current ? -revealWidth : 0;
          const newPos = Math.min(0, Math.max(-revealWidth, base + dx));
          onScrollLockRef.current?.(false);

          if (isOpen.current) {
            const isTap = Math.abs(dx) < 5 && Math.abs(dy) < 5;
            const shouldClose = isTap || newPos > -revealWidth + SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
            if (shouldClose) {
              animateTo(0);
              isOpen.current = false;
              setOpen(false);
            } else {
              animateTo(-revealWidth);
            }
          } else {
            const shouldOpen = newPos < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
            if (shouldOpen) {
              animateTo(-revealWidth);
              isOpen.current = true;
              setOpen(true);
              onSwipeOpenRef.current?.();
            } else {
              animateTo(0);
            }
          }
        },
        onPanResponderTerminate: () => {
          onScrollLockRef.current?.(false);
          animateTo(isOpen.current ? -revealWidth : 0);
        },
      })
    ).current;

    if (resolvedActions.length === 0) {
      return <View>{children}</View>;
    }

    return (
      <View
        style={[
          styles.container,
          overflowTop > 0 && { paddingTop: overflowTop, marginTop: -overflowTop },
        ]}
      >
        <View
          style={[
            styles.actionsContainer,
            {
              width: totalWidth,
              top: overflowTop,
              right: actionRightInset,
              bottom: actionBottomInset,
            },
          ]}
        >
          {resolvedActions.map((action, index) => (
            <ScalePressable
              key={index}
              style={[styles.actionButton, { width: BUTTON_WIDTH }]}
              onPress={action.onPress}
              disabled={action.disabled || action.busy}
              contentStyle={styles.actionButtonContent}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{
                disabled: Boolean(action.disabled || action.busy),
                busy: Boolean(action.busy),
              }}
            >
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.actionButtonSurface,
                  { backgroundColor: action.color },
                ]}
              />
              <Text style={styles.actionButtonText}>{action.label}</Text>
            </ScalePressable>
          ))}
        </View>
        <View
          style={[
            styles.contentClip,
            overflowTop > 0 && {
              marginTop: -overflowTop,
              paddingTop: overflowTop,
            },
          ]}
        >
          <Animated.View
            style={[styles.rowContent, { transform: [{ translateX }] }]}
            {...panResponder.panHandlers}
          >
            {children}
            {open ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  animateTo(0);
                  isOpen.current = false;
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="스와이프 메뉴 닫기"
              />
            ) : null}
          </Animated.View>
        </View>
      </View>
    );
  }
);

SwipeableRow.displayName = "SwipeableRow";

export default SwipeableRow;

const styles = StyleSheet.create({
  container: {
    overflow: "visible",
    position: "relative",
    flex: 1,
  },
  contentClip: {
    overflow: "hidden",
  },
  actionsContainer: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "stretch",
    gap: ACTION_GAP,
  },
  actionButton: {
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
  },
  actionButtonContent: {
    width: BUTTON_WIDTH,
    height: "100%",
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: ACTION_RADIUS,
    ...Shadows.card,
  },
  actionButtonSurface: {
    borderRadius: ACTION_RADIUS,
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
