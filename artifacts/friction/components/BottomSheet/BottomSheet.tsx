import React, { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  Keyboard,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardAnimation } from "react-native-keyboard-controller";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, ZIndex, Spacing } from "../../constants/tokens";

const HANDLE_HEIGHT = 28;
const MIN_TOP_GAP = 24;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  titleStyle?: TextStyle;
  snapPoints?: number[];
  enableDragDown?: boolean;
  dismissable?: boolean;
  keyboardAware?: boolean;
  closeButton?: boolean;
}

interface KeyboardSyncProps {
  translateY: Animated.Value;
  currentSnapRef: MutableRefObject<number>;
  keyboardOffsetRef: MutableRefObject<number>;
  closingRef: MutableRefObject<boolean>;
  getSnapY: (idx: number) => number;
  minTranslateY: number;
}

// Mounted only when the sheet is visible and keyboardAware so that
// useKeyboardAnimation's side effect (Android adjustResize mode) is scoped to
// the sheet's lifetime and does not leak into the rest of the app.
function KeyboardSync({
  translateY,
  currentSnapRef,
  keyboardOffsetRef,
  closingRef,
  getSnapY,
  minTranslateY,
}: KeyboardSyncProps) {
  const { height: keyboardHeightAnim } = useKeyboardAnimation();

  useEffect(() => {
    const id = keyboardHeightAnim.addListener(({ value }) => {
      if (closingRef.current) return;
      // height is exposed as Animated.multiply(rawHeight, -1), so negate it.
      const kbHeight = Math.max(0, -value);
      const base = getSnapY(currentSnapRef.current);
      const target = Math.max(base - kbHeight, minTranslateY);
      keyboardOffsetRef.current = base - target;
      translateY.setValue(target);
    });
    return () => keyboardHeightAnim.removeListener(id);
  }, [
    keyboardHeightAnim,
    getSnapY,
    minTranslateY,
    translateY,
    currentSnapRef,
    keyboardOffsetRef,
    closingRef,
  ]);

  return null;
}

export default function BottomSheet({
  visible,
  onClose,
  children,
  title,
  titleStyle,
  snapPoints = [0.4, 0.8],
  enableDragDown = true,
  dismissable = true,
  keyboardAware = false,
  closeButton = false,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_H } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const currentSnap = useRef(0);
  const keyboardOffsetRef = useRef(0);
  const closingRef = useRef(false);

  const getSnapY = useCallback(
    (idx: number) => SCREEN_H * (1 - snapPoints[Math.min(idx, snapPoints.length - 1)]),
    [SCREEN_H, snapPoints],
  );

  const minTranslateY = insets.top + MIN_TOP_GAP;

  // Mutable refs so PanResponder (created once) always reads fresh values.
  const getSnapYRef = useRef(getSnapY);
  const snapCountRef = useRef(snapPoints.length);
  // closeRef is populated after close() is defined below.
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => { getSnapYRef.current = getSnapY; }, [getSnapY]);
  useEffect(() => { snapCountRef.current = snapPoints.length; }, [snapPoints]);

  // Animate to initial snap on open.
  useEffect(() => {
    if (visible) {
      currentSnap.current = 0;
      keyboardOffsetRef.current = 0;
      closingRef.current = false;
      translateY.setValue(SCREEN_H);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: getSnapY(0),
          useNativeDriver: true,
          damping: 20,
          stiffness: 200,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  // Re-snap to first snap point when snap points semantically change while the
  // sheet is already open (e.g. code-step → preview-step transition).
  // Use a string key so inline array literals don't trigger spurious re-snaps
  // on every parent re-render (e.g. while the user is typing).
  const snapPointsKey = snapPoints.join("|");
  const prevSnapPointsKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevSnapPointsKey.current === null) {
      prevSnapPointsKey.current = snapPointsKey;
      return;
    }
    if (prevSnapPointsKey.current === snapPointsKey) return;
    prevSnapPointsKey.current = snapPointsKey;
    if (!visible) return;
    currentSnap.current = 0;
    keyboardOffsetRef.current = 0;
    Animated.spring(translateY, {
      toValue: getSnapY(0),
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [snapPointsKey]);

  const close = useCallback(() => {
    closingRef.current = true;
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: SCREEN_H,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      keyboardOffsetRef.current = 0;
      onClose();
    });
  }, [onClose]);

  useEffect(() => { closeRef.current = close; }, [close]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enableDragDown && dismissable,
      onMoveShouldSetPanResponder: (_, g) => enableDragDown && dismissable && Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const base = getSnapYRef.current(currentSnap.current) - keyboardOffsetRef.current;
        const next = Math.max(base + g.dy, getSnapYRef.current(snapCountRef.current - 1));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.5) {
          if (currentSnap.current === 0) {
            closeRef.current();
          } else {
            currentSnap.current = Math.max(0, currentSnap.current - 1);
            const target = getSnapYRef.current(currentSnap.current) - keyboardOffsetRef.current;
            Animated.spring(translateY, {
              toValue: Math.max(target, 0),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else if (g.dy < -100 || g.vy < -0.5) {
          if (currentSnap.current < snapCountRef.current - 1) {
            currentSnap.current += 1;
            const target = getSnapYRef.current(currentSnap.current) - keyboardOffsetRef.current;
            Animated.spring(translateY, {
              toValue: Math.max(target, 0),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else {
          const target = getSnapYRef.current(currentSnap.current) - keyboardOffsetRef.current;
          Animated.spring(translateY, {
            toValue: Math.max(target, 0),
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      {keyboardAware && (
        <KeyboardSync
          translateY={translateY}
          currentSnapRef={currentSnap}
          keyboardOffsetRef={keyboardOffsetRef}
          closingRef={closingRef}
          getSnapY={getSnapY}
          minTranslateY={minTranslateY}
        />
      )}
      <View style={styles.container}>
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissable ? close : undefined} />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { height: SCREEN_H, transform: [{ translateY }] }]}
          pointerEvents="box-none"
        >
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
            {(title || closeButton) && (
              <View style={styles.titleRow}>
                {/* 왼쪽 균형용 spacer (closeButton 너비와 동일) */}
                {closeButton ? <View style={styles.titleSpacer} /> : null}
                {title && <Text style={[styles.title, titleStyle]}>{title}</Text>}
                {closeButton && (
                  <Pressable onPress={close} style={styles.closeButton} hitSlop={16}>
                    <Feather name="x" size={20} color={Colors.zinc500} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
          <View
            style={[
              styles.content,
              {
                maxHeight: SCREEN_H * Math.max(...snapPoints) - HANDLE_HEIGHT,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    zIndex: ZIndex.modal,
    overflow: "hidden",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  handleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
    minHeight: HANDLE_HEIGHT,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc300,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingHorizontal: Spacing.screenPx,
    alignSelf: "stretch",
  },
  titleSpacer: {
    width: 28,
    height: 28,
  },
  title: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
    flex: 1,
    textAlign: "center",
  },
  closeButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
  },
});
