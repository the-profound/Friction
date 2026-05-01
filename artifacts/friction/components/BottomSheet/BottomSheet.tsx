import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

  const getSnapY = useCallback(
    (idx: number) => SCREEN_H * (1 - snapPoints[Math.min(idx, snapPoints.length - 1)]),
    [SCREEN_H, snapPoints],
  );

  const minTranslateY = insets.top + MIN_TOP_GAP;

  useEffect(() => {
    if (visible) {
      currentSnap.current = 0;
      keyboardOffsetRef.current = 0;
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

  useEffect(() => {
    if (!keyboardAware || !visible) return;

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      const kbHeight = e.endCoordinates.height;
      const base = getSnapY(currentSnap.current);
      // Cap upward lift so the sheet's top never exceeds (safeArea top + small gap).
      // The remaining content below the keyboard line is handled by the consumer's
      // internal ScrollView, avoiding a "full-screen takeover" feel.
      const target = Math.max(base - kbHeight, minTranslateY);
      // Effective lift after capping; remember it so drag gestures stay aligned.
      keyboardOffsetRef.current = base - target;
      Animated.spring(translateY, {
        toValue: target,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardOffsetRef.current = 0;
      Animated.spring(translateY, {
        toValue: getSnapY(currentSnap.current),
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardAware, visible, getSnapY, minTranslateY]);

  const close = useCallback(() => {
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
    ]).start(() => onClose());
  }, [onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enableDragDown && dismissable,
      onMoveShouldSetPanResponder: (_, g) => enableDragDown && dismissable && Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const base = getSnapY(currentSnap.current) - keyboardOffsetRef.current;
        const next = Math.max(base + g.dy, getSnapY(snapPoints.length - 1));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.5) {
          if (currentSnap.current === 0) {
            close();
          } else {
            currentSnap.current = Math.max(0, currentSnap.current - 1);
            const target = getSnapY(currentSnap.current) - keyboardOffsetRef.current;
            Animated.spring(translateY, {
              toValue: Math.max(target, 0),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else if (g.dy < -100 || g.vy < -0.5) {
          if (currentSnap.current < snapPoints.length - 1) {
            currentSnap.current += 1;
            const target = getSnapY(currentSnap.current) - keyboardOffsetRef.current;
            Animated.spring(translateY, {
              toValue: Math.max(target, 0),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else {
          const target = getSnapY(currentSnap.current) - keyboardOffsetRef.current;
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
