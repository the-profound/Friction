import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  Dimensions,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Colors, Typography, ZIndex, Spacing } from "../../constants/tokens";

const { height: SCREEN_H } = Dimensions.get("window");
const HANDLE_HEIGHT = 28;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  titleStyle?: TextStyle;
  snapPoints?: number[];
  enableDragDown?: boolean;
  dismissable?: boolean;
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
}: BottomSheetProps) {
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const currentSnap = useRef(0);

  const getSnapY = useCallback(
    (idx: number) => SCREEN_H * (1 - snapPoints[Math.min(idx, snapPoints.length - 1)]),
    [snapPoints],
  );

  useEffect(() => {
    if (visible) {
      currentSnap.current = 0;
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

  const close = useCallback(() => {
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
        const base = getSnapY(currentSnap.current);
        const next = Math.max(base + g.dy, getSnapY(snapPoints.length - 1));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.5) {
          if (currentSnap.current === 0) {
            close();
          } else {
            currentSnap.current = Math.max(0, currentSnap.current - 1);
            Animated.spring(translateY, {
              toValue: getSnapY(currentSnap.current),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else if (g.dy < -100 || g.vy < -0.5) {
          if (currentSnap.current < snapPoints.length - 1) {
            currentSnap.current += 1;
            Animated.spring(translateY, {
              toValue: getSnapY(currentSnap.current),
              useNativeDriver: true,
              damping: 20,
              stiffness: 200,
            }).start();
          }
        } else {
          Animated.spring(translateY, {
            toValue: getSnapY(currentSnap.current),
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
        <Animated.View
          style={[styles.overlay, { opacity: overlayOpacity }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissable ? close : undefined} />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
            {title && <Text style={[styles.title, titleStyle]}>{title}</Text>}
          </View>
          <View
            style={[
              styles.content,
              { maxHeight: SCREEN_H * Math.max(...snapPoints) - HANDLE_HEIGHT },
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
    height: SCREEN_H,
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
  title: {
    marginTop: 8,
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  content: {
    flex: 1,
    overflow: "hidden",
    paddingHorizontal: Spacing.screenPx,
  },
});
