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
  Platform,
  useWindowDimensions,
  type TextStyle,
  type KeyboardEvent,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, ZIndex, Spacing } from "../../constants/tokens";

const HANDLE_HEIGHT = 28;
const MIN_TOP_GAP = 24;
const MIN_SCREEN_H = 300;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  title?: string;
  titleStyle?: TextStyle;
  snapPoints?: number[];
  enableDragDown?: boolean;
  dismissable?: boolean;
  keyboardAware?: boolean;
  closeButton?: boolean;
  /**
   * 시트의 실제 translateY를 외부 미리보기와 직접 공유한다. 같은 native
   * animated value에서 파생하므로 열기·드래그·닫기 프레임이 어긋나지 않는다.
   */
  translateYAnim?: Animated.Value;
  /**
   * Custom element rendered at the left of the title row (e.g. a back
   * button for a multi-step sheet). Mutually exclusive in practice with
   * `closeButton`; when neither `closeButton` nor `headerLeft` is set, the
   * title row has no side elements at all.
   */
  headerLeft?: React.ReactNode;
}

interface KeyboardSyncProps {
  translateY: Animated.Value;
  currentSnapRef: MutableRefObject<number>;
  keyboardOffsetRef: MutableRefObject<number>;
  closingRef: MutableRefObject<boolean>;
  getSnapY: (idx: number) => number;
  minTranslateY: number;
}

function KeyboardSync({
  translateY,
  currentSnapRef,
  keyboardOffsetRef,
  closingRef,
  getSnapY,
  minTranslateY,
}: KeyboardSyncProps) {
  useEffect(() => {
    const onShow = (e: KeyboardEvent) => {
      if (closingRef.current) return;
      const kbHeight = e.endCoordinates.height;
      if (!kbHeight || kbHeight <= 0) return;
      const base = getSnapY(currentSnapRef.current);
      const target = Math.max(base - kbHeight, minTranslateY);
      keyboardOffsetRef.current = base - target;
      const duration = Platform.OS === "ios" ? (e.duration || 250) : 250;
      Animated.timing(translateY, {
        toValue: target,
        duration,
        useNativeDriver: true,
      }).start();
    };

    const onHide = () => {
      if (closingRef.current) return;
      keyboardOffsetRef.current = 0;
      const base = getSnapY(currentSnapRef.current);
      Animated.timing(translateY, {
        toValue: base,
        duration: 250,
        useNativeDriver: true,
      }).start();
    };

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [
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
  overlay,
  title,
  titleStyle,
  snapPoints = [0.4, 0.8],
  enableDragDown = true,
  dismissable = true,
  keyboardAware = false,
  closeButton = false,
  translateYAnim,
  headerLeft,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_H } = useWindowDimensions();
  const safeH = Math.max(SCREEN_H, MIN_SCREEN_H);
  const internalTranslateY = useRef(new Animated.Value(safeH)).current;
  const translateY = translateYAnim ?? internalTranslateY;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const currentSnap = useRef(0);
  const keyboardOffsetRef = useRef(0);
  const closingRef = useRef(false);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const getSnapY = useCallback(
    (idx: number) => safeH * (1 - snapPoints[Math.min(idx, snapPoints.length - 1)]),
    [safeH, snapPoints],
  );

  const minTranslateY = insets.top + MIN_TOP_GAP;

  const getSnapYRef = useRef(getSnapY);
  const snapCountRef = useRef(snapPoints.length);
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => { getSnapYRef.current = getSnapY; }, [getSnapY]);
  useEffect(() => { snapCountRef.current = snapPoints.length; }, [snapPoints]);

  useEffect(() => {
    if (visible) {
      currentSnap.current = 0;
      keyboardOffsetRef.current = 0;
      closingRef.current = false;
      translateY.setValue(safeH);
      overlayOpacity.setValue(0);

      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }

      const anim = Animated.parallel([
        Animated.spring(translateY, {
          toValue: getSnapY(0),
          useNativeDriver: true,
          damping: 30,
          stiffness: 200,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]);
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) animRef.current = null;
      });
    }
  }, [visible]);

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
    if (closingRef.current) return;
    currentSnap.current = 0;
    keyboardOffsetRef.current = 0;

    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }

    const anim = Animated.spring(translateY, {
      toValue: getSnapY(0),
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) animRef.current = null;
    });
  }, [snapPointsKey]);

  const close = useCallback(() => {
    closingRef.current = true;
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
    Keyboard.dismiss();
    const anim = Animated.parallel([
      Animated.spring(translateY, {
        toValue: safeH,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]);
    animRef.current = anim;
    anim.start(({ finished }) => {
      animRef.current = null;
      if (finished) {
        keyboardOffsetRef.current = 0;
        onClose();
      }
    });
  }, [onClose, safeH]);

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
              damping: 30,
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
              damping: 30,
              stiffness: 200,
            }).start();
          }
        } else {
          const target = getSnapYRef.current(currentSnap.current) - keyboardOffsetRef.current;
          Animated.spring(translateY, {
            toValue: Math.max(target, 0),
            useNativeDriver: true,
            damping: 30,
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
          style={[styles.sheet, { height: safeH, transform: [{ translateY }] }]}
          pointerEvents="box-none"
        >
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
            {(title || closeButton || headerLeft) && (
              <View style={styles.titleRow}>
                {headerLeft
                  ? headerLeft
                  : closeButton
                    ? <View style={styles.titleSpacer} />
                    : null}
                {title ? <Text style={[styles.title, titleStyle]}>{title}</Text> : null}
                {closeButton ? (
                  <ScalePressable
                    onPress={close}
                    style={styles.closeButton}
                    contentStyle={styles.closeButtonContent}
                    hitSlop={16}
                  >
                    <Feather name="x" size={20} color={Colors.zinc500} />
                  </ScalePressable>
                ) : headerLeft ? (
                  <View style={styles.titleSpacer} />
                ) : null}
              </View>
            )}
          </View>
          <View
            style={[
              styles.content,
              {
                maxHeight: safeH * Math.max(...snapPoints) - HANDLE_HEIGHT,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            {children}
          </View>
        </Animated.View>
        {overlay}
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
    ...StyleSheet.absoluteFill,
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
  },
  closeButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenPx,
  },
});
