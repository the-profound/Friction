import { useCallback, useEffect, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PanResponderGestureState,
} from "react-native";
import {
  findDateGroupAtOffset,
  getDateGroupPageDecision,
  resolveDateGroupAnchor,
  type DateGroupLayout,
} from "@/lib/dateGroupVerticalSnap";
import { Sizing } from "@/constants/tokens";

interface VerticalListRef {
  scrollToOffset: (params: { offset: number; animated: boolean }) => void;
}

interface WheelEventLike {
  deltaY: number;
  deltaMode?: number;
  preventDefault?: () => void;
}

interface UseDateGroupVerticalSnapOptions {
  groupKeys: readonly string[];
  /**
   * Include record IDs/counts here so a refresh that keeps the same date keys
   * still gets an anchor restoration after earlier groups change height.
   */
  groupSignature: string;
  listRef: React.RefObject<VerticalListRef | null>;
  enabled: boolean;
  estimatedGroupHeight?: number;
  /** Starts the shared press guard before a vertical page transition. */
  onPageGestureStart?: () => void;
  /** Moves back to the first date group when the owning tab is reselected. */
  resetKey?: string | number;
}

const FLING_VELOCITY = 0.5;
const WHEEL_SETTLE_DELAY_MS = 90;

/**
 * Owns the vertical date-group page contract.
 *
 * Native path: snapToInterval on the outer FlatList handles OS physics-based
 * snapping. This hook tracks the current index via onScroll and restores
 * anchors after key/reset changes using `currentIndex * groupHeight`.
 *
 * Web path: PanResponder and wheel/trackpad input resolve page decisions via
 * the same layout map (computed from estimatedGroupHeight — no measurement
 * needed now that group heights are uniform). scrollToOffset targets a
 * key-resolved offset exactly as before.
 *
 * This mirrors the pattern in DateGroupCarousel: native ScrollView
 * snapToInterval vs. web PanResponder + Animated.
 */
export function useDateGroupVerticalSnap({
  groupKeys,
  groupSignature,
  listRef,
  enabled,
  estimatedGroupHeight,
  onPageGestureStart,
  resetKey,
}: UseDateGroupVerticalSnapOptions) {
  const [viewportHeight, setViewportHeight] = useState(0);
  // Layout map computed purely from estimatedGroupHeight — no node measurement.
  const layoutsRef = useRef(new Map<string, DateGroupLayout>());
  const groupKeysRef = useRef<string[]>([...groupKeys]);
  const previousKeysRef = useRef<string[]>([]);
  const currentOffsetRef = useRef(0);
  const currentKeyRef = useRef<string | null>(groupKeys[0] ?? null);
  const currentIndexRef = useRef(0);
  const gestureStartKeyRef = useRef<string | null>(null);
  const pendingRestoreKeyRef = useRef<string | null>(null);
  const pendingRestoreAnimatedRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelDistanceRef = useRef(0);
  const resetKeyRef = useRef(resetKey);
  const finishGestureRef = useRef((
    _distanceY: number,
    _velocityY: number,
    _animated: boolean,
    _forceLock: boolean,
  ) => {});
  const beginGestureRef = useRef(() => {});

  groupKeysRef.current = [...groupKeys];

  const clearWheelTimer = useCallback(() => {
    if (wheelTimerRef.current !== null) {
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
  }, []);

  const rebuildLayouts = useCallback(() => {
    layoutsRef.current.clear();
    const groupH = estimatedGroupHeight ?? 0;
    if (groupH <= 0) return;
    groupKeysRef.current.forEach((key, index) => {
      layoutsRef.current.set(key, {
        dateKey: key,
        offset: index * groupH,
        height: groupH,
      });
    });
  }, [estimatedGroupHeight]);

  const restoreAnchor = useCallback(() => {
    const key = pendingRestoreKeyRef.current;
    if (!key || !enabled) return;
    pendingRestoreKeyRef.current = null;
    const shouldAnimate = pendingRestoreAnimatedRef.current;
    pendingRestoreAnimatedRef.current = false;

    if (Platform.OS !== "web") {
      // Native: index-based restore — snapToInterval owns the physics.
      const keys = groupKeysRef.current;
      const index = keys.indexOf(key);
      const safeIndex = index >= 0 ? index : 0;
      const groupH = estimatedGroupHeight ?? 0;
      const offset = safeIndex * groupH;
      currentIndexRef.current = safeIndex;
      currentKeyRef.current = key;
      currentOffsetRef.current = offset;
      listRef.current?.scrollToOffset({ offset, animated: shouldAnimate });
    } else {
      // Web: layout-map restore — PanResponder owns the gesture.
      const layout = layoutsRef.current.get(key);
      if (!layout) return;
      const offset = Math.max(0, layout.offset);
      const shouldActuallyAnimate = shouldAnimate && Math.abs(offset - currentOffsetRef.current) >= 1;
      currentKeyRef.current = key;
      currentOffsetRef.current = offset;
      listRef.current?.scrollToOffset({ offset, animated: shouldActuallyAnimate });
    }
  }, [enabled, estimatedGroupHeight, listRef]);

  const scheduleAnchorRestore = useCallback(() => {
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      restoreAnchor();
    });
  }, [restoreAnchor]);

  useEffect(() => {
    const nextKeys = [...groupKeys];
    const previousKeys = previousKeysRef.current;
    const previousKey = currentKeyRef.current;
    const shouldReset = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;

    rebuildLayouts();

    const nextAnchor = previousKeys.length > 0
      ? resolveDateGroupAnchor(previousKey, previousKeys, nextKeys, shouldReset)
      : nextKeys[0] ?? null;
    currentKeyRef.current = nextAnchor;
    pendingRestoreKeyRef.current = nextAnchor;
    pendingRestoreAnimatedRef.current = shouldReset && nextAnchor !== null;

    if (Platform.OS !== "web") {
      const index = nextAnchor ? nextKeys.indexOf(nextAnchor) : 0;
      const safeIndex = index >= 0 ? index : 0;
      currentIndexRef.current = safeIndex;
      currentOffsetRef.current = safeIndex * (estimatedGroupHeight ?? 0);
    } else {
      currentOffsetRef.current = layoutsRef.current.get(nextAnchor ?? "")?.offset ?? 0;
    }
    previousKeysRef.current = nextKeys;

    scheduleAnchorRestore();
  }, [
    enabled,
    estimatedGroupHeight,
    groupKeys,
    groupSignature,
    rebuildLayouts,
    resetKey,
    scheduleAnchorRestore,
  ]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0 && nextHeight !== viewportHeight) setViewportHeight(nextHeight);
  }, [viewportHeight]);

  const moveToDateKey = useCallback((
    dateKey: string | null,
    animated: boolean,
  ) => {
    if (!dateKey) return;
    const layout = layoutsRef.current.get(dateKey);
    if (!layout) return;
    const offset = Math.max(0, layout.offset);
    const shouldAnimate = animated && Math.abs(offset - currentOffsetRef.current) >= 1;
    currentKeyRef.current = dateKey;
    currentOffsetRef.current = offset;
    listRef.current?.scrollToOffset({ offset, animated: shouldAnimate });
  }, [listRef]);

  const finishPageGesture = useCallback((
    distanceY: number,
    velocityY: number,
    animated: boolean,
    forceLock: boolean,
  ) => {
    if (!enabled) return;
    onPageGestureStart?.();
    const currentKey = gestureStartKeyRef.current ?? currentKeyRef.current;
    const decision = getDateGroupPageDecision(
      currentKey,
      groupKeysRef.current,
      layoutsRef.current.size > 0 ? [...layoutsRef.current.values()] : [],
      distanceY,
      velocityY,
      Sizing.swipeThreshold,
      FLING_VELOCITY,
    );
    moveToDateKey(decision.dateKey, animated);
  }, [enabled, moveToDateKey, onPageGestureStart]);
  finishGestureRef.current = finishPageGesture;

  const beginPageGesture = useCallback(() => {
    if (!enabled) return;
    clearWheelTimer();
    wheelDistanceRef.current = 0;
    gestureStartKeyRef.current = currentKeyRef.current
      ?? findDateGroupAtOffset(currentOffsetRef.current, [...layoutsRef.current.values()])?.dateKey
      ?? groupKeysRef.current[0]
      ?? null;
    onPageGestureStart?.();
  }, [clearWheelTimer, enabled, onPageGestureStart]);
  beginGestureRef.current = beginPageGesture;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Platform.OS === "web"
        && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        && Math.abs(gesture.dy) > 6,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Platform.OS === "web"
        && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        && Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => beginGestureRef.current(),
      onPanResponderMove: () => {},
      onPanResponderRelease: (_, gesture: PanResponderGestureState) =>
        finishGestureRef.current(gesture.dy, gesture.vy, true, false),
      onPanResponderTerminate: (_, gesture: PanResponderGestureState) =>
        finishGestureRef.current(gesture.dy, gesture.vy, true, false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const onWheel = useCallback((event: WheelEventLike) => {
    if (!enabled) return;
    event.preventDefault?.();
    const rawDelta = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    if (rawDelta === 0) return;
    const multiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(1, viewportHeight)
        : 1;
    // The web wheel path was inverted relative to the pointer/touch gesture.
    // Keep native drag direction unchanged and reverse only this web input.
    wheelDistanceRef.current -= rawDelta * multiplier;
    clearWheelTimer();
    wheelTimerRef.current = setTimeout(() => {
      wheelTimerRef.current = null;
      const distance = wheelDistanceRef.current;
      wheelDistanceRef.current = 0;
      if (Math.abs(distance) < 1) return;
      beginPageGesture();
      finishGestureRef.current(distance, 0, true, false);
    }, WHEEL_SETTLE_DELAY_MS);
  }, [beginPageGesture, clearWheelTimer, enabled, viewportHeight]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    if (Platform.OS !== "web") {
      // Native: snapToInterval drives snapping; only track the current index.
      const groupH = estimatedGroupHeight ?? 0;
      const index = groupH > 0 ? Math.round(offset / groupH) : 0;
      currentIndexRef.current = index;
      currentKeyRef.current = groupKeysRef.current[index] ?? null;
    } else {
      currentOffsetRef.current = offset;
      const current = findDateGroupAtOffset(offset, [...layoutsRef.current.values()]);
      if (current) currentKeyRef.current = current.dateKey;
    }
  }, [estimatedGroupHeight]);

  const onScrollBeginDrag = useCallback(() => {
    if (!enabled || Platform.OS === "web") return;
    gestureStartKeyRef.current = currentKeyRef.current;
    onPageGestureStart?.();
  }, [enabled, onPageGestureStart]);

  useEffect(() => () => {
    clearWheelTimer();
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
  }, [clearWheelTimer]);

  return {
    onLayout,
    onScroll,
    onScrollBeginDrag,
    onWheel,
    panHandlers: panResponder.panHandlers,
  };
}
